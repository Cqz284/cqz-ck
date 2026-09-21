/**
 * 顶部搜索栏「跟手下拉 · 松手吸附 · 自动收起」的测试
 *
 * 两层：
 * 1) utils/search-reveal.ts —— 纯判定（跟手位移映射、吸附目标、方向），无副作用
 * 2) behaviors/search-reveal.ts —— 编排（setData、空闲定时器、手势采样）
 *
 * 钉住的口径（2026-09-21 定稿，对齐微信聊天列表顶部搜索框）：
 * - 手指下拉多少、内容就下移多少（1:1，只差一个固定的激活死区）
 * - 拉过槽位高度后进入阻尼段；松手按「甩动速度优先，其次拉出量」吸附到全开或回弹
 * - 往下翻立即收起；露出后无操作 5s 也收起
 * - 有输入 / 聚焦中不收（别把生效中的筛选藏起来）
 * - 多选态一律收起（搜索与多选是两套操作）
 * - 进页 / 切回一律回到隐藏态，且**任何内容长度都按同一套规则**：旧版那条"内容短到不能滚动
 *   就常驻露出"的例外已删除（对应真机反馈"进页搜索栏就存在、闲置也不隐藏"），理由见最后一组测试
 */
import {
  PULL_ACTIVATE_PX,
  PULL_MAX_RATIO,
  PULL_OVERSHOOT_DAMPING,
  PULL_SNAP_RATIO,
  PULL_SNAP_VELOCITY,
  SEARCH_DIRECTION_EPS,
  SEARCH_IDLE_HIDE_MS,
  SEARCH_PULL_TOP_TOLERANCE_PX,
  SEARCH_REVEAL_TOP_PX,
  pullOffsetFromDrag,
  pullSnapTarget,
  searchScrollIntent,
} from '../../utils/search-reveal';
import { searchRevealData, searchRevealMixin } from '../../behaviors/search-reveal';

/** 槽位高度的 px 值：96rpx × 375/750 = 48px（jest.setup.js 的窗口宽固定 375） */
const SLOT = 48;
/** 手指走多少才会让内容完整下移一个槽位高（含激活死区） */
const FULL_PULL = SLOT + PULL_ACTIVATE_PX;

describe('search-reveal · searchScrollIntent', () => {
  const base = { prevTop: 0, top: 0, shown: false, blocked: false };

  test('下拉（scrollTop 变小）且贴近顶部 → 露出', () => {
    expect(searchScrollIntent({ ...base, prevTop: 80, top: 40 })).toBe('show');
    // 一直拉到顶也算（顶到 0 时 delta 最大）
    expect(searchScrollIntent({ ...base, prevTop: 60, top: 0 })).toBe('show');
  });

  test('下拉但离顶部很远 → 不动：中部上滑时撑开会把内容整体下移', () => {
    expect(searchScrollIntent({ ...base, prevTop: 800, top: 700 })).toBe('none');
    expect(searchScrollIntent({ ...base, prevTop: SEARCH_REVEAL_TOP_PX + 100, top: SEARCH_REVEAL_TOP_PX + 20 })).toBe(
      'none'
    );
    // 刚好在阈值内则露出
    expect(searchScrollIntent({ ...base, prevTop: 300, top: SEARCH_REVEAL_TOP_PX - 1 })).toBe('show');
  });

  test('往下翻（scrollTop 变大）→ 收起；本来就没露出则无事发生', () => {
    expect(searchScrollIntent({ ...base, prevTop: 0, top: 120, shown: true })).toBe('hide');
    expect(searchScrollIntent({ ...base, prevTop: 0, top: 120, shown: false })).toBe('none');
  });

  test('位移小于阈值 → 不动（滚动期间的微小抖动不该让栏子闪）', () => {
    expect(
      searchScrollIntent({ ...base, prevTop: 100, top: 100 + SEARCH_DIRECTION_EPS - 1, shown: true })
    ).toBe('none');
  });

  test('多选态 → 一律收起（已收起则无事发生）', () => {
    expect(searchScrollIntent({ ...base, prevTop: 80, top: 20, shown: true, blocked: true })).toBe('hide');
    expect(searchScrollIntent({ ...base, prevTop: 80, top: 20, shown: false, blocked: true })).toBe('none');
  });

  test('异常入参（NaN / 负数）按 0 处理，不抛错', () => {
    expect(() => searchScrollIntent({ ...base, prevTop: NaN, top: NaN })).not.toThrow();
    expect(searchScrollIntent({ ...base, prevTop: -50, top: -80 })).toBe('none');
  });
});

describe('search-reveal · pullOffsetFromDrag（跟手位移映射）', () => {
  test('激活死区内 / 往回退 → 位移恒为 0（横向滑动的纵向漂移不该让整页抖）', () => {
    expect(pullOffsetFromDrag({ dy: 0, slotHeight: SLOT })).toBe(0);
    expect(pullOffsetFromDrag({ dy: PULL_ACTIVATE_PX, slotHeight: SLOT })).toBe(0);
    expect(pullOffsetFromDrag({ dy: 3, slotHeight: SLOT })).toBe(0);
    expect(pullOffsetFromDrag({ dy: -80, slotHeight: SLOT })).toBe(0);
  });

  test('越过死区后 1:1 跟手：手指走多少内容就下移多少（只差那个固定偏移）', () => {
    expect(pullOffsetFromDrag({ dy: PULL_ACTIVATE_PX + 10, slotHeight: SLOT })).toBe(10);
    expect(pullOffsetFromDrag({ dy: FULL_PULL, slotHeight: SLOT })).toBe(SLOT);
  });

  test('拉过槽位高度进入阻尼段：超出部分只按 35% 计入', () => {
    expect(pullOffsetFromDrag({ dy: FULL_PULL + 40, slotHeight: SLOT })).toBeCloseTo(
      SLOT + 40 * PULL_OVERSHOOT_DAMPING,
      6
    );
  });

  test('阻尼段封顶：拉得再远也不超过槽高的 PULL_MAX_RATIO 倍', () => {
    expect(pullOffsetFromDrag({ dy: 10000, slotHeight: SLOT })).toBeCloseTo(SLOT * PULL_MAX_RATIO, 6);
  });

  test('槽位高度拿不到（0）时不做位移，也不抛错', () => {
    expect(pullOffsetFromDrag({ dy: 100, slotHeight: 0 })).toBe(0);
    expect(pullOffsetFromDrag({ dy: NaN, slotHeight: NaN })).toBe(0);
  });
});

describe('search-reveal · pullSnapTarget（松手吸附）', () => {
  test('位移过门槛 → 全开；没过 → 回弹', () => {
    expect(pullSnapTarget({ offset: SLOT * PULL_SNAP_RATIO, velocity: 0, slotHeight: SLOT })).toBe('open');
    expect(pullSnapTarget({ offset: SLOT * PULL_SNAP_RATIO - 1, velocity: 0, slotHeight: SLOT })).toBe('close');
  });

  test('速度优先：位移不够但向下甩得够快也算要开', () => {
    expect(pullSnapTarget({ offset: 2, velocity: PULL_SNAP_VELOCITY, slotHeight: SLOT })).toBe('open');
  });

  test('速度优先：位移够但向上甩 → 回弹（甩动比"拉到哪"更能表达意图）', () => {
    expect(pullSnapTarget({ offset: SLOT, velocity: -PULL_SNAP_VELOCITY, slotHeight: SLOT })).toBe('close');
  });

  test('没甩到位（速度在阈值内）时看位移，不看符号', () => {
    expect(pullSnapTarget({ offset: SLOT, velocity: -PULL_SNAP_VELOCITY / 2, slotHeight: SLOT })).toBe('open');
  });

  test('槽位高度拿不到（0）/ 异常入参 → 回弹，不抛错', () => {
    expect(pullSnapTarget({ offset: 100, velocity: 0, slotHeight: 0 })).toBe('close');
    expect(() => pullSnapTarget({ offset: NaN, velocity: NaN, slotHeight: NaN })).not.toThrow();
    expect(pullSnapTarget({ offset: NaN, velocity: NaN, slotHeight: SLOT })).toBe('close');
  });
});

/** 测试用宿主：mixin + 页面里那两个数据字段（keyword / selecting） */
function makeHost(init: { keyword?: string; selecting?: boolean } = {}) {
  const data = Object.assign(searchRevealData(), {
    keyword: init.keyword ?? '',
    selecting: init.selecting ?? false,
  });
  const setDataLog: Array<Record<string, unknown>> = [];
  const host = Object.assign({}, searchRevealMixin, {
    data,
    setData(patch: Record<string, unknown>) {
      setDataLog.push(patch);
      Object.assign(data, patch);
    },
  });
  return { host, data, setDataLog };
}

/** 把一段手势走到"已接管且手指走了 dy"的下一步状态；返回 host */
function dragTo(host: ReturnType<typeof makeHost>['host'], dy: number, dt = 400) {
  host.onSearchTouchStart();
  host.onSearchTouchMove({ touches: [{ clientY: 300 }], timeStamp: 1000 });
  host.onSearchTouchMove({ touches: [{ clientY: 300 + dy }], timeStamp: 1000 + dt });
}

describe('search-reveal · 编排', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('初始态是"收起"：位移 0、目标态 false', () => {
    const { host, data } = makeHost();
    expect(data.searchShown).toBe(false);
    expect(host.searchPullOffset).toBe(0);
    expect(data.searchPullStyle).toContain('translate3d(0, 0px, 0)');
  });

  test('贴顶下拉拉到顶露出；露出后无操作 5s 自动收回', () => {
    const { host, data } = makeHost();
    host.onPageScrollSearch(0); // 首帧：lastTop 从 0 开始，无位移
    host.onPageScrollSearch(400); // 往下翻
    host.searchLastTop = 400;
    host.onPageScrollSearch(0); // 拉回顶部
    expect(data.searchShown).toBe(true);
    expect(host.searchPullOffset).toBe(SLOT);

    jest.advanceTimersByTime(SEARCH_IDLE_HIDE_MS - 1);
    expect(data.searchShown).toBe(true);
    jest.advanceTimersByTime(1);
    expect(data.searchShown).toBe(false);
    expect(host.searchPullOffset).toBe(0);
  });

  test('往下翻立即收起', () => {
    const { host, data } = makeHost();
    host.showSearch();
    expect(data.searchShown).toBe(true);
    host.onPageScrollSearch(300);
    expect(data.searchShown).toBe(false);
  });

  test('跟手：手指拉多少位移就多少（只差激活死区），且过渡关闭（否则看着慢半拍）', () => {
    const { host, data } = makeHost();
    dragTo(host, 0, 16); // 第一帧只接管，不产生位移
    expect(host.searchTouchY).toBe(300);
    expect(host.searchPullOffset).toBe(0);

    host.onSearchTouchMove({ touches: [{ clientY: 320 }], timeStamp: 1032 }); // 手指走 20
    expect(host.searchPullOffset).toBe(20 - PULL_ACTIVATE_PX);
    expect(data.searchPullStyle).toContain(`translate3d(0, ${20 - PULL_ACTIVATE_PX}px, 0)`);
    expect(data.searchPullStyle).toContain('transition: none');
    // 跟手中「露出的目标态」还没定：定型的是松手吸附那一下
    expect(data.searchShown).toBe(false);
  });

  test('死区内的漂移：跟手已接管但不产生位移（横向滑删不误抖）', () => {
    const { host, data } = makeHost();
    dragTo(host, 0, 16);
    host.onSearchTouchMove({ touches: [{ clientY: 304 }], timeStamp: 1032 }); // 只漂了 4px
    expect(host.searchPullOffset).toBe(0);
    host.onSearchTouchEnd();
    expect(data.searchShown).toBe(false);
    expect(host.searchPullOffset).toBe(0);
  });

  test('手指停住时不空转 setData（每帧都会进来）', () => {
    const { host, setDataLog } = makeHost();
    dragTo(host, 0, 16);
    host.onSearchTouchMove({ touches: [{ clientY: 330 }], timeStamp: 1032 });
    const n = setDataLog.length;
    host.onSearchTouchMove({ touches: [{ clientY: 330 }], timeStamp: 1048 });
    expect(setDataLog.length).toBe(n);
  });

  test('松手：拉出量过门槛 → 吸附到全开（并恢复过渡曲线）', () => {
    const { host, data } = makeHost();
    dragTo(host, 60, 16); // 位移 54 > 48×0.4
    host.onSearchTouchEnd();
    expect(data.searchShown).toBe(true);
    expect(host.searchPullOffset).toBe(SLOT);
    expect(data.searchPullStyle).toContain('translate3d(0, 48px, 0)');
    expect(data.searchPullStyle).not.toContain('transition: none');
  });

  test('松手：拉得不够就回弹到 0', () => {
    const { host, data } = makeHost();
    dragTo(host, 10); // 慢速（400ms 挪 10px）→ 速度不足以触发吸附，位移也只 4px
    host.onSearchTouchEnd();
    expect(data.searchShown).toBe(false);
    expect(host.searchPullOffset).toBe(0);
    expect(data.searchPullStyle).toContain('translate3d(0, 0px, 0)');
  });

  test('松手：位移很小但向下甩得够快 → 也算要开', () => {
    const { host, data } = makeHost();
    host.onSearchTouchStart();
    host.onSearchTouchMove({ touches: [{ clientY: 300 }], timeStamp: 1000 });
    host.onSearchTouchMove({ touches: [{ clientY: 308 }], timeStamp: 1010 }); // 0.8 px/ms
    host.onSearchTouchEnd();
    expect(data.searchShown).toBe(true);
  });

  test('松手：拉到位但向上甩 → 回弹', () => {
    const { host, data } = makeHost();
    host.onSearchTouchStart();
    host.onSearchTouchMove({ touches: [{ clientY: 300 }], timeStamp: 1000 });
    host.onSearchTouchMove({ touches: [{ clientY: 360 }], timeStamp: 1100 });
    host.onSearchTouchMove({ touches: [{ clientY: 340 }], timeStamp: 1120 }); // 上甩 -1 px/ms
    host.onSearchTouchEnd();
    expect(data.searchShown).toBe(false);
    expect(host.searchPullOffset).toBe(0);
  });

  test('松手不足量 → 回弹：不因"正在使用"把位移卡在半路', () => {
    const { host, data } = makeHost({ keyword: '餐饮' });
    dragTo(host, 10);
    expect(host.searchPullOffset).toBe(10 - PULL_ACTIVATE_PX);
    host.onSearchTouchEnd();
    // 回弹是"这段手势没拉够"，与"有关键词"无关：位移归零、过渡恢复
    expect(host.searchPullOffset).toBe(0);
    expect(data.searchShown).toBe(false);
    expect(data.searchPullStyle).not.toContain('transition: none');
  });

  test('跟手到一半被外部接管：位移归位、残留手势被丢弃', () => {
    const { host } = makeHost();
    dragTo(host, 30, 16);
    expect(host.searchPullOffset).toBe(30 - PULL_ACTIVATE_PX);
    host.showSearch(); // 外部（滚动 / 吸附）接管
    expect(host.searchTouchY).toBeNull();
    expect(host.searchPullOffset).toBe(SLOT);
    // 残留的 move 不该再写值
    host.onSearchTouchMove({ touches: [{ clientY: 500 }], timeStamp: 1100 });
    expect(host.searchPullOffset).toBe(SLOT);
  });

  test('已露出 → 不再进入跟手（没有"再拉出来"这回事）', () => {
    const { host, data, setDataLog } = makeHost();
    host.showSearch();
    const n = setDataLog.length;
    host.onSearchTouchStart();
    host.onSearchTouchMove({ touches: [{ clientY: 600 }], timeStamp: 1000 });
    expect(host.searchTouchY).toBeNull();
    expect(setDataLog.length).toBe(n);
    expect(data.searchShown).toBe(true);
  });

  test('多选态 → 不接管手势，也不露出', () => {
    const { host, data } = makeHost({ selecting: true });
    dragTo(host, 200, 16);
    expect(host.searchTouchY).toBeNull();
    expect(host.searchPullOffset).toBe(0);
    expect(data.searchShown).toBe(false);
  });

  test('中部下拉不接管；手指没松开就滚回顶部，同一段手势仍能接住（top 现读）', () => {
    const { host } = makeHost();
    host.searchLastTop = 500;
    host.onSearchTouchStart();
    host.onSearchTouchMove({ touches: [{ clientY: 300 }], timeStamp: 1000 });
    expect(host.searchTouchY).toBeNull(); // 中部：不接管

    host.searchLastTop = 0; // 同一段手势里页面回到顶部
    host.onSearchTouchMove({ touches: [{ clientY: 300 }], timeStamp: 1016 });
    expect(host.searchTouchY).toBe(300); // 从这一帧起算
    host.onSearchTouchMove({ touches: [{ clientY: 348 }], timeStamp: 1032 });
    expect(host.searchPullOffset).toBe(SLOT - PULL_ACTIVATE_PX);
  });

  test('贴顶容差：滚动刚归零时还差一两像素也算贴顶', () => {
    const { host } = makeHost();
    host.searchLastTop = SEARCH_PULL_TOP_TOLERANCE_PX;
    host.onSearchTouchStart();
    host.onSearchTouchMove({ touches: [{ clientY: 300 }], timeStamp: 1000 });
    expect(host.searchTouchY).toBe(300);

    const b = makeHost();
    b.host.searchLastTop = SEARCH_PULL_TOP_TOLERANCE_PX + 1;
    b.host.onSearchTouchStart();
    b.host.onSearchTouchMove({ touches: [{ clientY: 300 }], timeStamp: 1000 });
    expect(b.host.searchTouchY).toBeNull();
  });

  test('异常事件（缺 touches / 坐标非数字）不抛错，也不激活手势', () => {
    const { host } = makeHost();
    expect(() => host.onSearchTouchStart()).not.toThrow();
    expect(() => host.onSearchTouchMove({})).not.toThrow();
    expect(() => host.onSearchTouchMove({ touches: [] })).not.toThrow();
    expect(() => host.onSearchTouchMove({ touches: [{ clientY: NaN }] })).not.toThrow();
    expect(() => host.onSearchTouchEnd()).not.toThrow();
    expect(host.searchTouchY).toBeNull();
  });

  test('有输入 / 聚焦中都不自动收起（别把生效中的筛选藏起来）', () => {
    const { host, data } = makeHost({ keyword: '早餐' });
    host.showSearch();
    host.onPageScrollSearch(400); // 往下翻
    expect(data.searchShown).toBe(true);

    jest.advanceTimersByTime(SEARCH_IDLE_HIDE_MS * 2);
    expect(data.searchShown).toBe(true);

    // 聚焦中：即使空白也不收
    data.keyword = '';
    host.onSearchFocus();
    host.hideSearch();
    expect(data.searchShown).toBe(true);

    // 失焦后开始计时，超时才收
    host.onSearchBlur();
    jest.advanceTimersByTime(SEARCH_IDLE_HIDE_MS);
    expect(data.searchShown).toBe(false);
  });

  test('清空关键词后重新计时（清空那一刻不立刻收）', () => {
    const { host, data } = makeHost({ keyword: 'x' });
    host.showSearch();
    // 页面里的顺序：先 setData({keyword})，防抖提交时再 syncSearchKeyword
    data.keyword = '';
    host.syncSearchKeyword('');
    expect(data.searchShown).toBe(true);
    jest.advanceTimersByTime(SEARCH_IDLE_HIDE_MS);
    expect(data.searchShown).toBe(false);
  });

  test('多选态：露出被拦下，已露出则强行收起', () => {
    const { host, data } = makeHost();
    host.showSearch();
    data.selecting = true;
    host.hideSearchIfShown(); // swipe-select 的 enterSelect 走这里
    expect(data.searchShown).toBe(false);
    expect(host.searchPullOffset).toBe(0);

    // 多选态下再下拉也不露出
    host.searchLastTop = 400;
    host.onPageScrollSearch(0);
    expect(data.searchShown).toBe(false);
  });

  test('页面显示时复位：回到隐藏态；带关键词回来则保持露出', () => {
    const a = makeHost();
    a.host.showSearch();
    a.host.resetSearchReveal();
    expect(a.data.searchShown).toBe(false);
    expect(a.host.searchPullOffset).toBe(0);
    expect(a.host.searchLastTop).toBe(0);

    const b = makeHost({ keyword: '餐饮' });
    b.host.showSearch();
    b.host.resetSearchReveal();
    expect(b.data.searchShown).toBe(true);
  });

  test('任何内容长度都按同一套规则：进页即隐藏，下拉仍能露出、超时照样收起', () => {
    // 旧版有条"内容短到不能滚动就常驻露出"的例外（那时露出靠 onPageScroll 的方向判定 ——
    // 不能滚动 = 永远做不出"下拉"）。跟手版的下拉走触摸事件，短列表照样拉得出来 → 例外已删除：
    // 留着它，搜索栏会在短列表上一直挂着、连空闲也不收，就是用户报的"进页就存在、闲置也不隐藏"。
    const { host, data } = makeHost();
    expect(data.searchShown).toBe(false);
    expect(host.searchPullOffset).toBe(0);

    // 短列表：onPageScroll 不会触发（scrollTop 恒 0），贴顶下拉照样能把它拉出来
    dragTo(host, 60, 16);
    host.onSearchTouchEnd();
    expect(data.searchShown).toBe(true);
    expect(host.searchPullOffset).toBe(SLOT);

    // 露出后无操作，照样自动收起（不再有"常驻"这回事）
    jest.advanceTimersByTime(SEARCH_IDLE_HIDE_MS);
    expect(data.searchShown).toBe(false);
    expect(host.searchPullOffset).toBe(0);
  });
});
