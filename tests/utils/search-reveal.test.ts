/**
 * 顶部搜索栏「下拉露出 / 自动收起」的测试
 *
 * 两层：
 * 1) utils/search-reveal.ts —— 纯判定（方向、靠近顶部、能否滚动），无副作用
 * 2) behaviors/search-reveal.ts —— 编排（setData、空闲定时器、强制收回）
 *
 * 钉住的口径（2026-09-21 用户定稿）：
 * - 下拉露出只在贴近顶部时生效（列表中部上滑时撑开会把内容整体下移，看着像"自己跳"）
 * - 往下翻立即收起；露出后无操作 5s 也收起
 * - 有输入 / 聚焦中不收（别把生效中的筛选藏起来）
 * - 多选态一律收起（搜索与多选是两套操作）
 * - 内容短到不能滚动时搜索栏常驻（否则用户永远做不出"下拉"这个动作）
 */
import {
  SEARCH_DIRECTION_EPS,
  SEARCH_IDLE_HIDE_MS,
  SEARCH_PULL_TOP_TOLERANCE_PX,
  SEARCH_PULL_TRIGGER_PX,
  SEARCH_REVEAL_TOP_PX,
  searchFitsViewport,
  searchScrollIntent,
  topPullIntent,
} from '../../utils/search-reveal';
import { searchRevealData, searchRevealMixin } from '../../behaviors/search-reveal';

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

describe('search-reveal · searchFitsViewport', () => {
  const WINDOW_H = 667;
  const SLOT = 48;

  test('减掉搜索栏自身占位再比较：撑开/收起不会来回翻', () => {
    // 内容 700px（含已撑开的 48）→ 基础内容 652 < 667 → 判定"不能滚动"
    expect(searchFitsViewport(700, WINDOW_H, SLOT, true)).toBe(true);
    // 去掉搜索栏后同样的 700（说明现在没撑开）→ 700 > 667 → 能滚动
    expect(searchFitsViewport(700, WINDOW_H, SLOT, false)).toBe(false);
    // 关键：不能出现"撑开 → 能滚动 → 收起 → 又不能滚动"的振荡
    const shownFit = searchFitsViewport(700, WINDOW_H, SLOT, true);
    const hiddenFit = searchFitsViewport(700 - SLOT, WINDOW_H, SLOT, false);
    expect(shownFit).toBe(hiddenFit);
  });

  test('量不到高度（0）时不改判定', () => {
    expect(searchFitsViewport(0, WINDOW_H, SLOT, false)).toBe(false);
    expect(searchFitsViewport(700, 0, SLOT, false)).toBe(false);
  });

  test('只比视口高一点点也算"不能滚动"：那点滚动范围做不出一次下拉', () => {
    // 680 > 667，但只高 13px（< 方向阈值 8 + 余量），用户滚一下就到头、根本触发不了露出
    expect(searchFitsViewport(680, WINDOW_H, SLOT, false)).toBe(true);
    // 高出余量之外才算能滚动
    expect(searchFitsViewport(WINDOW_H + 25, WINDOW_H, SLOT, false)).toBe(false);
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

describe('search-reveal · 编排', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('下拉到顶露出；露出后无操作 5s 自动收回', () => {
    const { host } = makeHost();
    expect(host.data.searchShown).toBe(false);
    host.onPageScrollSearch(0); // 首帧：lastTop 从 0 开始，无位移
    host.onPageScrollSearch(200);
    host.data.searchShown = false; // 往下翻过，回到"收起"
    host.searchLastTop = 200;
    host.onPageScrollSearch(0); // 拉回顶部
    expect(host.data.searchShown).toBe(true);

    jest.advanceTimersByTime(SEARCH_IDLE_HIDE_MS - 1);
    expect(host.data.searchShown).toBe(true);
    jest.advanceTimersByTime(1);
    expect(host.data.searchShown).toBe(false);
  });

  test('往下翻立即收起', () => {
    const { host } = makeHost();
    host.showSearch();
    expect(host.data.searchShown).toBe(true);
    host.onPageScrollSearch(0);
    host.onPageScrollSearch(300);
    expect(host.data.searchShown).toBe(false);
  });

  test('有输入 / 聚焦中都不自动收起（别把生效中的筛选藏起来）', () => {
    const { host, data } = makeHost({ keyword: '早餐' });
    host.showSearch();
    host.onPageScrollSearch(0);
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

    // 多选态下再下拉也不露出
    host.searchLastTop = 200;
    host.onPageScrollSearch(0);
    expect(data.searchShown).toBe(false);
  });

  test('页面显示时复位：回到隐藏态；带关键词回来则保持露出', () => {
    const a = makeHost();
    a.host.showSearch();
    a.host.resetSearchReveal();
    expect(a.data.searchShown).toBe(false);
    expect(a.host.searchLastTop).toBe(0);

    const b = makeHost({ keyword: '餐饮' });
    b.host.showSearch();
    b.host.resetSearchReveal();
    expect(b.data.searchShown).toBe(true);
  });

  test('内容短到不能滚动 → 常驻露出；变长后退回"可收起"并计时', () => {
    const { host, data } = makeHost();
    // 内容 600 < 可视 667（无搜索栏占位）→ 不能滚动
    (globalThis as unknown as { wx: { createSelectorQuery: () => unknown } }).wx.createSelectorQuery = () => ({
      selectViewport() {
        return this;
      },
      scrollOffset(cb: (r: { scrollHeight: number }) => void) {
        cb({ scrollHeight: 600 });
        return this;
      },
      exec() {
        return this;
      },
    });
    host.checkSearchRevealFit();
    expect(host.searchUnscrollable).toBe(true);
    expect(data.searchShown).toBe(true);

    // 常驻期间：空闲超时 / 往下翻都不该把它收掉（收掉就再也拉不出来）
    host.onPageScrollSearch(0);
    host.onPageScrollSearch(400);
    jest.advanceTimersByTime(SEARCH_IDLE_HIDE_MS * 2);
    expect(data.searchShown).toBe(true);

    // 内容变长（能滚动）→ 交回给"下拉露出"的规则，并立刻收起 + 计时
    (globalThis as unknown as { wx: { createSelectorQuery: () => unknown } }).wx.createSelectorQuery = () => ({
      selectViewport() {
        return this;
      },
      scrollOffset(cb: (r: { scrollHeight: number }) => void) {
        cb({ scrollHeight: 3000 });
        return this;
      },
      exec() {
        return this;
      },
    });
    host.checkSearchRevealFit();
    expect(host.searchUnscrollable).toBe(false);
    expect(data.searchShown).toBe(false);
  });
});

describe('search-reveal · topPullIntent（贴顶下拉补位）', () => {
  const base = { dy: 0, top: 0, shown: false, blocked: false };

  test('贴顶且下移达到阈值 → 露出', () => {
    expect(topPullIntent({ ...base, dy: SEARCH_PULL_TRIGGER_PX })).toBe('show');
    expect(topPullIntent({ ...base, dy: 120 })).toBe('show');
  });

  test('下移不够阈值 → 不动（横向滑动的纵向分量不该误开搜索栏）', () => {
    expect(topPullIntent({ ...base, dy: SEARCH_PULL_TRIGGER_PX - 1 })).toBe('none');
    expect(topPullIntent({ ...base, dy: 10 })).toBe('none');
  });

  test('不在顶部 → 不动（中部下拉归 searchScrollIntent 管，两路不抢同一段手势）', () => {
    expect(topPullIntent({ ...base, dy: 120, top: 400 })).toBe('none');
    // 容差内仍算贴顶：onPageScroll 的回报有延迟，刚归零时可能还差一两像素
    expect(topPullIntent({ ...base, dy: 120, top: SEARCH_PULL_TOP_TOLERANCE_PX })).toBe('show');
    expect(topPullIntent({ ...base, dy: 120, top: SEARCH_PULL_TOP_TOLERANCE_PX + 1 })).toBe('none');
  });

  test('已露出 / 多选态 → 不动', () => {
    expect(topPullIntent({ ...base, dy: 120, shown: true })).toBe('none');
    expect(topPullIntent({ ...base, dy: 120, blocked: true })).toBe('none');
  });

  test('异常入参（NaN / 负数）按 0 处理，不抛错', () => {
    expect(() => topPullIntent({ ...base, dy: NaN, top: NaN })).not.toThrow();
    expect(topPullIntent({ ...base, dy: -60 })).toBe('none');
  });
});

describe('search-reveal · 贴顶下拉编排', () => {
  test('进页就停在顶部：手指下拉（scrollTop 恒为 0）也能把搜索栏拉出来', () => {
    const { host, data } = makeHost();
    // 页面本来就在顶部：scrollTop 0 → 0，从方向上什么也看不出来（这就是修复前的症状）
    host.onPageScrollSearch(0);
    expect(data.searchShown).toBe(false);

    host.onSearchTouchStart({ touches: [{ clientY: 300 }] });
    host.onSearchTouchMove({ touches: [{ clientY: 300 + SEARCH_PULL_TRIGGER_PX }] });
    expect(data.searchShown).toBe(true);
  });

  test('一次手势只露一次：露出后继续拖不再产生 setData', () => {
    const { host, data, setDataLog } = makeHost();
    host.onSearchTouchStart({ touches: [{ clientY: 300 }] });
    host.onSearchTouchMove({ touches: [{ clientY: 400 }] });
    expect(data.searchShown).toBe(true);
    const calls = setDataLog.length;

    // 起点已被清掉，后续 move 全部空转
    host.onSearchTouchMove({ touches: [{ clientY: 500 }] });
    host.onSearchTouchMove({ touches: [{ clientY: 600 }] });
    expect(setDataLog.length).toBe(calls);
  });

  test('横向滑动不误触；手指离开后起点清掉', () => {
    const { host, data } = makeHost();
    host.onSearchTouchStart({ touches: [{ clientY: 300 }] });
    host.onSearchTouchMove({ touches: [{ clientY: 310 }] }); // 左滑删除：纵向只挪 10px
    expect(data.searchShown).toBe(false);

    host.onSearchTouchEnd();
    expect(host.searchTouchY).toBeNull();
    // 起点清了之后，残留的 move 不该再算进上一次手势
    host.onSearchTouchMove({ touches: [{ clientY: 600 }] });
    expect(data.searchShown).toBe(false);
  });

  test('中部下拉不开；手指没松开就滚回顶部，同一段手势仍能接住（top 现读）', () => {
    const { host, data } = makeHost();
    host.searchLastTop = 500;
    host.onSearchTouchStart({ touches: [{ clientY: 300 }] });
    host.onSearchTouchMove({ touches: [{ clientY: 400 }] });
    expect(data.searchShown).toBe(false);

    host.searchLastTop = 0;
    host.onSearchTouchMove({ touches: [{ clientY: 400 }] });
    expect(data.searchShown).toBe(true);
  });

  test('已露出 / 多选态：touchstart 不记起点，move 也不露出', () => {
    const a = makeHost();
    a.host.showSearch();
    a.host.searchTouchY = 999; // 模拟上一段手势的残留
    a.host.onSearchTouchStart({ touches: [{ clientY: 300 }] });
    expect(a.host.searchTouchY).toBeNull();

    const b = makeHost({ selecting: true });
    b.host.searchTouchY = 999;
    b.host.onSearchTouchStart({ touches: [{ clientY: 300 }] });
    expect(b.host.searchTouchY).toBeNull();
    b.host.onSearchTouchMove({ touches: [{ clientY: 999 }] });
    expect(b.data.searchShown).toBe(false);
  });

  test('异常事件（缺 touches / 坐标非数字）不抛错，也不激活手势', () => {
    const { host } = makeHost();
    expect(() => host.onSearchTouchStart({})).not.toThrow();
    expect(() => host.onSearchTouchStart({ touches: [] })).not.toThrow();
    expect(() => host.onSearchTouchMove({ touches: [{ clientY: NaN }] })).not.toThrow();
    expect(host.searchTouchY).toBeNull();
  });
});
