/**
 * 列表页共享编排（behaviors/swipe-select）的状态机测试
 *
 * 这里集中了项目历史上最容易回归的滑删陷阱，全部钉成用例：
 * - 右滑进多选（顺带选中该条）、多选态左滑退出
 * - Vant 收回去不发事件 → touchend / click 两处补清位置记录
 * - 退出多选要等 Vant 0.6s 收起过渡走完才清 exitMap（否则闪红）
 * - 删除：收起动画结束才落库，且 refresh 与清理收起态在同一次 setData
 * - 撤销：原样写回
 */
import { createSwipeSelectMixin, swipeSelectData, SWIPE_ROW_RESET_MS } from '../../behaviors/swipe-select';
import { COLLAPSE_DURATION_MS } from '../../utils/motion';
import { measureHeights } from '../../utils/motion';
import { resetHints } from '../../utils/hint';

// measureHeights 依赖 wx.createSelectorQuery（jest.setup 未 mock），
// 这里替换成可编程的桩：不影响 COLLAPSE_DURATION_MS 等常量的真实值。
jest.mock('../../utils/motion', () => {
  const actual = jest.requireActual('../../utils/motion');
  return { ...actual, measureHeights: jest.fn() };
});

const measureMock = measureHeights as unknown as jest.Mock;

/** 测试用页面实例：mixin + 两个页面钩子（visibleIds / refresh）的最小实现 */
function makeInstance(ids: string[] = ['a', 'b', 'c']) {
  const removedLog: string[][] = [];
  const restoredLog: string[][] = [];
  const data = swipeSelectData();
  const setDataLog: Array<Record<string, unknown>> = [];

  const inst = Object.assign(
    createSwipeSelectMixin<string>({
      enterHintKey: 'test-enter',
      enterHintText: '右滑可多选',
      exitHintKey: 'test-exit',
      exitHintText: '左滑退出',
      noPickToast: '先选择要删除的记录',
      undoText: (n) => `已删除 ${n} 条`,
      removeItems: (toRemove) => {
        removedLog.push(toRemove.slice());
        return toRemove.slice();
      },
      restoreItems: (items) => {
        restoredLog.push(items.slice());
      },
    }),
    {
      visibleIds() {
        return ids;
      },
      refresh(extra?: Record<string, unknown>) {
        if (extra) Object.assign(data, extra);
      },
    }
  );

  // 把实例字段绑上：mixin 方法内部通过 this 访问 data / setData / selectComponent
  const self = inst as unknown as {
    data: typeof data;
    setData(patch: Record<string, unknown>, cb?: () => void): void;
    selectComponent(selector: string): unknown;
  };
  self.data = data;
  self.setData = (patch, cb) => {
    Object.assign(data, patch);
    setDataLog.push(patch);
    if (cb) cb();
  };
  const offsets = new Map<string, number>();
  self.selectComponent = (selector: string) => {
    const id = selector.replace('#swipe-', '');
    if (!offsets.has(id)) return null;
    return { offset: offsets.get(id) };
  };

  return { inst, data, removedLog, restoredLog, setDataLog, offsets };
}

beforeEach(() => {
  jest.useFakeTimers();
  measureMock.mockReset();
  resetHints();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('swipe-select · 进入 / 退出多选', () => {
  test('右滑（open left）进入多选，并顺带选中该条', () => {
    const { inst, data } = makeInstance();
    (inst as { onSwipeOpen(e: unknown): void }).onSwipeOpen({
      detail: { position: 'left', name: 'a' },
    });
    expect(data.selecting).toBe(true);
    expect(data.pickMap).toEqual({ a: true });
    expect(data.pickedCount).toBe(1);
    // 进入多选后位置记录清空：左槽宽度归零已把这一行收回
    expect(data.openSideMap).toEqual({});
  });

  test('多选态下左滑（open right）退出多选；exitMap 等 620ms 收起过渡走完再清', () => {
    const { inst, data } = makeInstance();
    const self = inst as unknown as { onSwipeOpen(e: unknown): void; exitSelect(): void };
    self.onSwipeOpen({ detail: { position: 'left', name: 'a' } });
    self.onSwipeOpen({ detail: { position: 'right', name: 'a' } });

    expect(data.selecting).toBe(false);
    expect(data.pickMap).toEqual({});
    // 刚退出的行在收起动画期间继续显示中性色的「退出」块
    expect(data.exitMap).toEqual({ a: true });

    jest.advanceTimersByTime(619);
    expect(data.exitMap).toEqual({ a: true });
    jest.advanceTimersByTime(1);
    expect(data.exitMap).toEqual({});
  });

  test('未进入多选时左滑（open right）只是记录位置，不翻转任何状态', () => {
    const { inst, data } = makeInstance();
    (inst as unknown as { onSwipeOpen(e: unknown): void }).onSwipeOpen({
      detail: { position: 'right', name: 'b' },
    });
    expect(data.selecting).toBe(false);
    expect(data.openSideMap).toEqual({ b: 'right' });
  });

  test('多选态下右滑被兜底忽略（Vant 状态错位时不得再次进入多选）', () => {
    const { inst, data } = makeInstance();
    const self = inst as unknown as { onSwipeOpen(e: unknown): void; enterSelect(id?: string): void };
    self.onSwipeOpen({ detail: { position: 'left', name: 'a' } });
    self.onSwipeOpen({ detail: { position: 'left', name: 'b' } });
    // 仍只选中最初那条
    expect(data.pickMap).toEqual({ a: true });
  });
});

describe('swipe-select · 滑开位置记录的补清', () => {
  test('touchend 时行还开着（offset 非 0）→ 保留记录', () => {
    const { inst, data, offsets } = makeInstance();
    offsets.set('b', 72);
    const self = inst as unknown as { onSwipeOpen(e: unknown): void; onCellTouchEnd(e: unknown): void };
    self.onSwipeOpen({ detail: { position: 'right', name: 'b' } });
    self.onCellTouchEnd({ currentTarget: { dataset: { name: 'b' } } });
    expect(data.openSideMap).toEqual({ b: 'right' });
  });

  test('touchend 时行已收起（offset 0 / 实例不在）→ 清掉记录，否则另一侧再也滑不出来', () => {
    const { inst, data } = makeInstance();
    const self = inst as unknown as { onSwipeOpen(e: unknown): void; onCellTouchEnd(e: unknown): void };
    self.onSwipeOpen({ detail: { position: 'right', name: 'b' } });
    // selectComponent 返回 null（已删除或没被记过 offset）
    self.onCellTouchEnd({ currentTarget: { dataset: { name: 'b' } } });
    expect(data.openSideMap).toEqual({});
  });

  test('click（点内容收起）同样补清记录', () => {
    const { inst, data } = makeInstance();
    const self = inst as unknown as { onSwipeOpen(e: unknown): void; onCellTap(e: unknown): void };
    self.onSwipeOpen({ detail: { position: 'right', name: 'b' } });
    self.onCellTap({ currentTarget: { dataset: { name: 'b' } } });
    expect(data.openSideMap).toEqual({});
  });

  test('closeAllSwipes 清空位置记录', () => {
    const { inst, data } = makeInstance();
    const self = inst as unknown as { onSwipeOpen(e: unknown): void; closeAllSwipes(): void };
    self.onSwipeOpen({ detail: { position: 'right', name: 'a' } });
    self.closeAllSwipes();
    expect(data.openSideMap).toEqual({});
  });
});

describe('swipe-select · 脏记录导致"看起来收起却滑不动"', () => {
  test('多选态下 Vant 状态错位触发 open(left)：必须清记录，不能把该行右槽宽度永久归零', () => {
    const { inst, data } = makeInstance();
    const self = inst as unknown as { onSwipeOpen(e: unknown): void };
    self.onSwipeOpen({ detail: { position: 'left', name: 'a' } }); // 正常进多选
    self.onSwipeOpen({ detail: { position: 'left', name: 'b' } }); // 错位事件（多选态下又滑了右）
    expect(data.selecting).toBe(true);
    // 残留 'left' 会让该行 right-width 恒为 0 → 左滑（删除）再也滑不出来
    expect(data.openSideMap).toEqual({});
  });

  test('closeAllSwipes 在 openedSwipes 已空时也要清位置记录（早退不留脏数据）', () => {
    const { inst, data } = makeInstance();
    const self = inst as unknown as { openedSwipes: string[]; closeAllSwipes(): void };
    // 构造"记录在、id 列表空"的残留态 —— 正是跨页后可能出现的不一致
    data.openSideMap = { b: 'right' };
    self.openedSwipes = [];
    self.closeAllSwipes();
    expect(data.openSideMap).toEqual({});
  });

  test('resetSwipes：终止型收口（清记录 + 宽度归零），当帧不还原', () => {
    // ⚠️ 这条用例钉的是 2026-09-20 才定位到的成因：曾经这里是"归零一帧再还原"，
    // 两次 setData 落在同一渲染批次时，Vant 的 swipeMove(0) 会被宽度 observer 的
    // swipeMove(newWidth) 覆盖，行反而停在半开位 —— 现象是"能看到一小部分删除块往回缩，
    // 该行再也滑不动，直到滑别的行才被 Vant 的 onDrag 顺手收回"。
    // 所以现在 resetSwipes 只归零、不还原；恢复交给下一帧的 restoreSwipeWidth()。
    const { inst, data, setDataLog } = makeInstance();
    const self = inst as unknown as { openedSwipes: string[]; resetSwipes(): void };
    data.openSideMap = { a: 'left' };
    data.exitMap = { a: true };
    self.openedSwipes = ['a'];
    self.resetSwipes();

    expect(self.openedSwipes).toEqual([]);
    expect(data.openSideMap).toEqual({});
    expect(data.exitMap).toEqual({});
    expect(data.swipeReset).toBe(true);
    // 只置位、不还原：整页收口的还原由页面在 onShow 的下一帧调 restoreSwipeWidth()
    expect(setDataLog.filter((p) => p.swipeReset === false)).toHaveLength(0);
  });

  test('restoreSwipeWidth 把宽度还回去；没归零时是空操作（幂等）', () => {
    const { inst, data } = makeInstance();
    const self = inst as unknown as { resetSwipes(): void; restoreSwipeWidth(): void };

    // 没归零过 → 不动（多调几次也不会把宽度弄错）
    self.restoreSwipeWidth();
    expect(data.swipeReset).toBe(false);

    self.resetSwipes();
    expect(data.swipeReset).toBe(true);
    self.restoreSwipeWidth();
    expect(data.swipeReset).toBe(false);
    // 再调一次仍然稳定
    self.restoreSwipeWidth();
    expect(data.swipeReset).toBe(false);
  });
});

describe('swipe-select · 快速切页后的"滑不动"（2026-09-20 定位到真因）', () => {
  test('两个列表页：onShow/onHide 走终止型收口，宽度由下一帧 restoreSwipeWidth 还原', () => {
    // 真因是 setData 批次竞争（见 resetSwipes 注释），所以这里钉住的是**调用契约**：
    // 切页时收口 → 下一帧还原，两步必须都在，且顺序不能反。
    // 断言只取"真正的语句行"（去掉注释），否则解释性注释里提到旧 API 就会误判。
    const fs = require('fs') as typeof import('fs');
    // 只留真正的语句行：注释里提到旧 API（closeAllSwipes）不该影响断言
    const codeOnly = (s: string): string =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ['pages/ledger/list/index.ts', 'pages/notes/list/index.ts'].forEach((rel) => {
      const src = codeOnly(fs.readFileSync(rel, 'utf8'));
      const show = src.slice(src.indexOf('onShow()'), src.indexOf('onHide()'));
      // onHide 的结尾用 `refresh(extra: Partial<`（方法实现的签名）定位：
      // 'refresh(' 与 'refresh(extra' 都会先命中文件更前面的类型声明，切出空串
      const hide = src.slice(src.indexOf('onHide()'), src.indexOf('refresh(extra: Partial<'));
      expect(show).toContain('this.resetSwipes();');
      expect(show).toContain('wx.nextTick(() => this.restoreSwipeWidth());');
      // 还原必须在收口之后
      expect(show.indexOf('restoreSwipeWidth')).toBeGreaterThan(show.indexOf('resetSwipes'));
      // onHide 也要收口：否则切走时留着展开态，回来才收会在返回瞬间闪一下
      expect(hide).toContain('this.resetSwipes();');
      // 旧的"靠 closeAllSwipes 收页"已经不该再出现（实例查不到会静默失败）
      expect(show).not.toContain('closeAllSwipes');
      expect(hide).not.toContain('closeAllSwipes');
    });
  });

  test('swipeReset 归零那一帧：模板里两槽宽度确实会变成 0（收口的驱动方式）', () => {
    // resetSwipes 不依赖实例查找，全靠 width 归零让 Vant 的 observer 调 swipeMove(0)。
    // 这里用模板源码钉住"归零确实作用在 left-width / right-width 上"。
    const fs = require('fs') as typeof import('fs');
    ['pages/ledger/list/index.wxml', 'pages/notes/list/index.wxml'].forEach((rel) => {
      const src = fs.readFileSync(rel, 'utf8');
      expect(src).toContain('left-width="{{ swipeReset ||');
      expect(src).toContain('right-width="{{ swipeReset ||');
    });
  });

  test('resetSwipes：openedSwipes 为空也会按实例树收干净', () => {
    const data = swipeSelectData();
    const closed: string[] = [];
    const inst = Object.assign(
      createSwipeSelectMixin<string>({
        enterHintKey: 'k',
        enterHintText: 't',
        exitHintKey: 'k2',
        exitHintText: 't2',
        noPickToast: 'x',
        undoText: (n) => `${n}`,
        removeItems: () => [],
        restoreItems: () => {},
      }),
      { visibleIds: () => [], refresh: () => {} }
    );
    const self = inst as unknown as {
      data: typeof data;
      setData(p: Record<string, unknown>, cb?: () => void): void;
      resetSwipes(): void;
      closeAllSwipes(): void;
    };
    self.data = data;
    self.setData = (p, cb) => {
      Object.assign(data, p);
      if (cb) cb();
    };

    // 造一棵"页面里挂着一个开着 offset 的 swipe-cell"的实例树
    const page = { $$: { offset: 0, __wxElement: { childNodes: [{ name: 'swipe', offset: 72, close: () => closed.push('swipe') }] } } };
    (globalThis as { getCurrentPages?: () => unknown[] }).getCurrentPages = () => [page];

    // 记录被清过（跨页后正是这个状态），只有实例树还记得那一行还开着
    self.closeAllSwipes();
    expect(closed).toEqual(['swipe']);

    closed.length = 0;
    self.resetSwipes();
    expect(closed).toEqual(['swipe']);

    delete (globalThis as { getCurrentPages?: () => unknown[] }).getCurrentPages;
  });

  test('touchend 补清走数据驱动（forceCloseRow），实例查不到也不会留下脏状态', () => {
    const { inst, data } = makeInstance();
    const self = inst as unknown as { openedSwipes: string[]; onSwipeOpen(e: unknown): void; onCellTouchEnd(e: unknown): void };
    self.onSwipeOpen({ detail: { position: 'right', name: 'b' } });
    self.openedSwipes = ['b'];
    // 实例查不到（offset 未登记）→ 必须清记录，并且用宽度归零把 Vant 那边也拽回来
    self.onCellTouchEnd({ currentTarget: { dataset: { name: 'b' } } });
    expect(data.openSideMap).toEqual({});
    expect(data.swipeReset).toBe(true);
    // 单行路径必须自己还原（它不能像整页收口那样把宽度一直留在 0）
    jest.advanceTimersByTime(SWIPE_ROW_RESET_MS);
    expect(data.swipeReset).toBe(false);
  });
});

describe('swipe-select · 勾选', () => {
  test('onPick 切换单条；全选条件 = 选中数等于可见数', () => {
    const { inst, data } = makeInstance(['a', 'b', 'c']);
    const self = inst as unknown as {
      onPick(e: { detail?: { id: string } }): void;
      onPickAll(): void;
    };
    self.onPick({ detail: { id: 'a' } });
    self.onPick({ detail: { id: 'b' } });
    expect(data.pickedCount).toBe(2);
    expect(data.allPicked).toBe(false);
    self.onPick({ detail: { id: 'c' } });
    expect(data.allPicked).toBe(true);
    // 再点一次 a 取消 → 不再是全选
    self.onPick({ detail: { id: 'a' } });
    expect(data.allPicked).toBe(false);
  });

  test('onPickAll：未全选时全选，已全选时清空', () => {
    const { inst, data } = makeInstance(['a', 'b']);
    const self = inst as unknown as { onPickAll(): void };
    self.onPickAll();
    expect(data.pickMap).toEqual({ a: true, b: true });
    self.onPickAll();
    expect(data.pickMap).toEqual({});
  });

  test('clearPick 退出多选并清空选中', () => {
    const { inst, data } = makeInstance();
    const self = inst as unknown as { onPickAll(): void; clearPick(): void };
    self.onPickAll();
    self.clearPick();
    expect(data.selecting).toBe(false);
    expect(data.pickMap).toEqual({});
    expect(data.pickedCount).toBe(0);
  });
});

describe('swipe-select · 删除与撤销', () => {
  test('删除流程：量高 → 钉住 → 收起 → 落库，refresh 与清收起态同帧完成', () => {
    jest.useFakeTimers();
    const { inst, data, removedLog } = makeInstance(['a', 'b']);
    measureMock.mockImplementation((_ctx: unknown, _sel: string, cb: (h: number[]) => void) =>
      cb([40, 40])
    );
    inst.deleteRecords(['a', 'b']);

    // 动画结束前不落库
    expect(removedLog).toHaveLength(0);
    jest.advanceTimersByTime(COLLAPSE_DURATION_MS);

    expect(removedLog).toEqual([['a', 'b']]);
    // 收起态与多选态在同一次 refresh extra 里清掉（否则行会先复原一帧，列表闪一下）
    expect(data.pinnedMap).toEqual({});
    expect(data.shrinkingMap).toEqual({});
    expect(data.selecting).toBe(false);
    // 撤销条出现
    expect(data.undoVisible).toBe(true);
    expect(data.undoText).toBe('已删除 2 条');
    jest.useRealTimers();
  });

  test('撤销：恢复暂存并隐藏撤销条', () => {
    jest.useFakeTimers();
    const { inst, data, restoredLog, removedLog } = makeInstance(['a']);
    measureMock.mockImplementation((_ctx: unknown, _sel: string, cb: (h: number[]) => void) =>
      cb([40])
    );
    inst.deleteRecords(['a']);
    jest.advanceTimersByTime(COLLAPSE_DURATION_MS);
    expect(data.undoVisible).toBe(true);

    inst.onUndo();
    expect(restoredLog).toEqual([['a']]);
    expect(data.undoVisible).toBe(false);
    expect(removedLog).toEqual([['a']]);
    jest.useRealTimers();
  });

  test('一条都没选就点删除 → 提示，不进入删除流程', () => {
    const { inst, removedLog } = makeInstance();
    inst.onDeletePicked();
    expect(removedLog).toHaveLength(0);
  });

  test('落库返回空数组（没什么可删）时不出撤销条', () => {
    jest.useFakeTimers();
    measureMock.mockImplementation((_ctx: unknown, _sel: string, cb: (h: number[]) => void) =>
      cb([40])
    );

    const data = swipeSelectData();
    const bare = Object.assign(
      createSwipeSelectMixin<string>({
        enterHintKey: 'k',
        enterHintText: 't',
        exitHintKey: 'k2',
        exitHintText: 't2',
        noPickToast: 'x',
        undoText: (n) => `${n}`,
        removeItems: () => [],
        restoreItems: () => {},
      }),
      {
        visibleIds: () => ['a'],
        refresh: () => {},
      }
    );
    const self = bare as unknown as {
      data: typeof data;
      setData(p: Record<string, unknown>, cb?: () => void): void;
      selectComponent(s: string): unknown;
      deleteRecords(ids: string[]): void;
    };
    self.data = data;
    self.setData = (p, cb) => {
      Object.assign(data, p);
      if (cb) cb();
    };
    self.selectComponent = () => null;

    self.deleteRecords(['a']);
    jest.advanceTimersByTime(COLLAPSE_DURATION_MS);
    expect(data.undoVisible).toBe(false);
    jest.useRealTimers();
  });
});

describe('swipe-select · 手势提示', () => {
  test('列表为空时不提示；有内容时首次提示', () => {
    const empty = makeInstance([]);
    (empty.inst as unknown as { hintSwipe(): void }).hintSwipe();
    // 无内容：不弹（用 wx.showToast 的调用次数验证会与其它提示混淆，这里只验证不抛错、
    // 且 pickedOrder 等状态未被误改）
    expect(empty.data.selecting).toBe(false);

    const one = makeInstance(['a']);
    expect(() => (one.inst as unknown as { hintSwipe(): void }).hintSwipe()).not.toThrow();
  });
});
