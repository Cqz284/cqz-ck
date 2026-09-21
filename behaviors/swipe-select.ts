/**
 * 列表页共享的「滑动多选 + 批量删除 + 撤销」编排
 *
 * 为什么是 mixin 工厂而不是 Behavior()：
 * 本项目页面统一用 Page<Data, Custom>() 泛型写法，tsc 要求选项字面量实现 Custom 的全部成员；
 * Behavior 的合并发生在运行时，类型系统看不见。这里用纯 TS 工厂把共享编排合进页面选项
 * （页面里 Object.assign(mixin, { 页面差异部分 })），运行时语义与 Behavior 完全一致
 * （data 合并、方法合并、this 直达），但类型检查全程在线。
 *
 * 页面差异通过两处表达：
 * - config（静态）：文案与落库钩子（removeItems / restoreItems）
 * - 页面自己实现：visibleIds()（记账页是分组嵌套、记事页是平铺）与 refresh(extra?)
 *
 * ⚠️ 这里集中了历史上踩过的所有滑删陷阱，改之前先读注释：
 * - van-swipe-cell 的 left/right-width 单位是 px：必须用 utils/rpx.ts 的 swipeActionWidth()
 * - Vant 滑开只发 open 事件，收回去不发任何通知 → touchend / click 两处补清位置记录
 * - 退出多选要等 Vant 0.6s 收起过渡走完才能换掉右槽内容 → exitMap + SWIPE_CLOSE_MS
 * - 删除的收起动画结束回调里不许清 pinnedMap/shrinkingMap → 由 done 的一次 setData 一并清
 */
import { haptic } from '../utils/haptics';
import { hintOnce } from '../utils/hint';
import { COLLAPSE_DURATION_MS, measureHeights } from '../utils/motion';
import type { MeasureContext } from '../utils/motion';
import { swipeActionWidth } from '../utils/rpx';

/**
 * van-swipe-cell 收起过渡的时长（ms）
 *
 * Vant 在 swipeMove 里写死了 `.6s cubic-bezier(...)`，这里取 620ms 留点余量。
 * 退出多选必须等它走完再清掉 exitMap，否则右槽当场换成红色的删除块，收起动画里会闪一片红。
 */
export const SWIPE_CLOSE_MS = 620;

/**
 * 单行强制收回的还原等待（ms）
 *
 * 这是**单行**补清路径（forceCloseRow）用的短还原：只针对"刚抬起手指、行其实已收回
 * 但没收到 click"的情形，且必须早于用户下一次触屏（拖拽会立刻打断过渡），取一帧多一点即可。
 *
 * ⚠️ 别把这个值用到其它"归零 → 还原"的写法里：归零与还原挤在同一渲染批次时，
 * Vant 的 `swipeMove(0)` 会被宽度 observer 的 `swipeMove(newWidth)` 覆盖，
 * 行会停在半开位（2026-09-20 的"快速切页后滑不动"就是它；切页收口已于 2026-09-21 整个移除）。
 */
export const SWIPE_ROW_RESET_MS = 120;

/** van-swipe-cell 实例上我们用到的那部分（Vant 未导出类型，按结构描述即可） */
interface SwipeCellLike {
  close?: () => void;
  /** 内部维护的当前位移（px）；setData 是异步的，这个字段才是同步真值 */
  offset?: number;
}

/**
 * 收集整页所有已滑开的单元格实例
 *
 * 走组件内部挂在实例上的 `offset`（同步真值）而不是 `selectComponent('#swipe-<id>')`：
 * 后者要求 id 合法、且该行还在 DOM 里 —— 失效时是**静默**的，正是"滑不动"这类问题的温床。
 * 用 `$$` 前缀拿到页面组件树，DFS 找带数值 offset 且不为 0 的节点即可。
 *
 * 兜底窗口：拿不到当前页时退化为只按 openedSwipes 记录收。
 * 定时器里调用的 `this` 是 Page 实例，不会被回收，所以不会读到上一个页面的残留。
 *
 * @returns 需要收回的实例（已按 offset 方向去重，可能为空数组）
 */
function collectOpenCells(): SwipeCellLike[] {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const page = pages[pages.length - 1] as unknown as { $$?: unknown } | undefined;
  const root = page && page.$$;
  if (!root) return [];
  const found: SwipeCellLike[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const n = node as {
      offset?: unknown;
      parent?: unknown;
      __wxElement?: { parentNode?: unknown; childNodes?: unknown[] };
    };
    if (typeof n.offset === 'number' && n.offset !== 0) found.push(n as SwipeCellLike);
    // 页面级组件树没有 parent 字段，只有 __wxElement 上的 parentNode / childNodes
    if (!(typeof n.parent !== 'undefined' || n.__wxElement)) return;
    const childNodes = n.__wxElement?.childNodes;
    if (Array.isArray(childNodes)) childNodes.forEach(walk);
  };
  try {
    walk(root);
  } catch {
    // 组件树结构随基础库版本变化：遍历失败就只按记录收，不因此中断收口
  }
  return found;
}

/** 共享编排覆盖的 data 字段（页面 data 接口 extends 它） */
export interface SwipeSelectData {
  /** 是否处于多选模式 */
  selecting: boolean;
  /**
   * 每行当前滑开的那一侧：id -> 'left'（右滑露出的多选）/ 'right'（左滑露出的删除或退出）
   *
   * 存在的意义是**阻止"反向滑动顺手翻到另一侧"**：已滑开删除的行再往右滑，应当只是收回去，
   * 而不是把「多选」也露出来。做法是模板里把该行另一侧的 width 置 0，
   * Vant 只能把 offset 收回 0（它判定开合时会看另一侧的 width）。
   */
  openSideMap: Record<string, 'left' | 'right'>;
  /**
   * 刚退出多选、还在收起动画里的行
   *
   * 退出要"立刻生效"（不能拖灵敏），但右槽不能当场换成红色删除块——Vant 的收起是 0.6s 过渡。
   * 这些行在动画期间继续显示中性色的「退出」块，动画结束再清掉。
   */
  exitMap: Record<string, boolean>;
  /** 选中状态：id -> true（用 map 便于模板 O(1) 查询，也便于按路径更新） */
  pickMap: Record<string, boolean>;
  /** 已选条数 */
  pickedCount: number;
  /** 是否已全选（当前可见项） */
  allPicked: boolean;
  /** 已钉住高度的行：id -> px（收起动画的起点，批量删除时一次钉多行） */
  pinnedMap: Record<string, number>;
  /** 正在收起的行 */
  shrinkingMap: Record<string, boolean>;
  /** 撤销条是否展示 */
  undoVisible: boolean;
  /** 撤销条文案 */
  undoText: string;
  /**
   * 强制收回标志（单行补清 forceCloseRow 置一帧 true，滚动收口也会顺手还原残留）
   *
   * 置 true 时**两槽宽度都归零**，Vant 的 leftWidth / rightWidth observer 会对任何
   * offset ≠ 0 的单元格调用 swipeMove(0) —— 这是不依赖 `selectComponent` 实例查找的
   * 关闭路径。仅靠 close() 时，实例查不到会静默失败（`inst?.close?.()`），
   * 而 Vant 内部的 offset 会一直卡在滑开位：那一行看起来是收起的，却怎么滑都不动。
   */
  swipeReset: boolean;
  /**
   * 滑开距离（px）
   * 必须喂 rpxToPx 换算后的值给 van-swipe-cell：它的 left-width / right-width 单位是 px，
   * 而操作块宽度是 144rpx，直接写 144 会让滑开距离加倍、块外侧空出一条（见 utils/rpx.ts）
   */
  swipeWidth: number;
}

/** 共享编排提供的实例字段与方法（页面 Custom 接口 extends 它） */
export interface SwipeSelectMethods {
  /** 收起动画结束后的清理定时器（onUnload 中清理） */
  removeTimer: ReturnType<typeof setTimeout> | null;
  /** 「退出多选」的延迟定时器：等滑开的行收完再清 exitMap（onUnload / onHide 清理） */
  exitTimer: ReturnType<typeof setTimeout> | null;
  /**
   * 单行强制收回的还原定时器（见 forceCloseRow）
   *
   * ⚠️ 只服务于"单行补清"这一条路径，且必须**还原**（否则整页滑不出来）。
   * 别把这个"归零 → 还原"的写法推广到其它场景：两次 setData 挤在同一批次时，
   * Vant 的 swipeMove(0) 会被宽度 observer 的 swipeMove(newWidth) 覆盖，
   * 行会停在半开位（"快速切页后滑不动"的成因；切页收口因此已于 2026-09-21 移除）。
   */
  rowResetTimer: ReturnType<typeof setTimeout> | null;
  /** 当前选中项 id，按列表展示顺序（与批量测量的返回顺序一一对应） */
  pickedOrder: string[];
  /** 已滑开的行 id（滚动收口 / 退出多选时统一收回） */
  openedSwipes: string[];
  /** 暂存的被删项（用于撤销） */
  stash: unknown[];
  /** 重算选中态派生数据（条数 / 是否全选 / 顺序） */
  syncPick(): void;
  /** 退出多选并清空选中 */
  clearPick(): void;
  /** 收回指定行（该行已不在列表时静默跳过） */
  closeSwipe(id: string): void;
  /** 收回所有已滑开的行 */
  closeAllSwipes(): void;
  /**
   * 强制收回某一行：清记录 + 两槽宽度归零一帧（touchend 后确实已收起但没收到 click 时用）
   *
   * 与 closeSwipe 的区别：不依赖实例查找，实例查不到也能把卡住的行拽回来。
   */
  forceCloseRow(id: string): void;
  /**
   * 页面滚动时收回所有滑开的行（onPageScroll 里调用）
   *
   * 切页不收口（滑开状态跨页保留，用户定稿："就不动它"），滚动是主要的收口时机。
   */
  closeSwipesOnScroll(): void;
  onCellTouchEnd(e: { currentTarget: { dataset: { name?: string } } }): void;
  onCellTap(e: { currentTarget: { dataset: { name?: string } } }): void;
  /** 清掉某一行的"滑开侧"记录 */
  clearOpenSide(id: string): void;
  onSwipeOpen(e: { detail: { position: 'left' | 'right'; name: string } }): void;
  onEnterSelect(e: { currentTarget: { dataset: { id: string } } }): void;
  /** 进入多选：把触发的那一条一并选上 */
  enterSelect(id?: string): void;
  /** 退出多选（多选态左滑触发） */
  exitSelect(): void;
  /** 清掉"退出多选"的延迟定时器与中性色块（切页 / 卸载时调用） */
  clearExitTimer(): void;
  /** 首次看到有内容的列表时教一次入口手势（同一会话只提示一次） */
  hintSwipe(): void;
  onPick(e: { detail?: { id: string }; currentTarget?: { dataset?: { id?: string } } }): void;
  /** 全选 / 取消全选（范围 = 当前可见项） */
  onPickAll(): void;
  /** 批量删除选中项 */
  onDeletePicked(): void;
  /** 左滑删除单条（与批量删除同一条代码路径） */
  onDelete(e: { currentTarget: { dataset: { id: string } } }): void;
  /** 删除若干条：整行收起 → 落库 → 底部给撤销 */
  deleteRecords(ids: string[]): void;
  /** 撤销删除：原样写回（保留 id 与创建时间） */
  onUndo(): void;
  /** 撤销超时：丢弃暂存 */
  onUndoExpire(): void;
  /** 播放「整行收起」动画后再执行删除 */
  collapseRemove(ids: string[], done: () => void): void;
}

/** 页面必须自己实现的钩子（页面差异所在） */
export interface SwipeSelectHooks {
  /** 当前列表可见项 id（按展示顺序：分组顺序 → 组内顺序） */
  visibleIds(): string[];
  /**
   * 刷新列表数据
   * @param extra 需要与刷新合并进**同一次 setData** 的字段（分两次写会露出中间帧）
   */
  refresh(extra?: Partial<SwipeSelectData>): void;
}

/** 页面差异配置 */
export interface SwipeSelectConfig<T> {
  /** 首次看到有内容的列表时教一次入口手势（key 用于会话内去重） */
  enterHintKey: string;
  enterHintText: string;
  /** 退出靠"左滑"，不教一下不容易发现 */
  exitHintKey: string;
  exitHintText: string;
  /** 一条都没选就点删除时的提示 */
  noPickToast: string;
  /** 撤销条文案 */
  undoText(count: number): string;
  /** 真正落库：返回被删项（撤销用），顺序与 ids 一致 */
  removeItems(ids: string[]): T[];
  /** 撤销删除：原样写回（保留 id 与创建时间） */
  restoreItems(items: T[]): void;
}

/**
 * 挂载共享编排的页面选项类型
 *
 * 与 WechatMiniprogram.Page.Options 的唯一差别：
 * 共享成员（SwipeSelectMethods）在页面字面量里是**可选**的（运行时由 mixin 补上），
 * 但在 **this 上齐全**（页面方法里 this.syncPick() / this.setData() 照常用）。
 *
 * ⚠️ 不要在页面里直接写 Object.assign(mixin, 页面字面量) 再传给 Page()：
 * Object.assign 是泛型调用，页面字面量拿不到 Page() 提供的上下文 this 类型，
 * 页面方法里的 this.setData / this.clearPick 会全部报错。合并必须经由 defineSwipeSelectPage。
 */
export type SwipeSelectPageOptions<
  TData extends WechatMiniprogram.Page.DataOption,
  TCustom extends SwipeSelectHooks & WechatMiniprogram.Page.CustomOption
> = (TCustom &
  Partial<SwipeSelectMethods> &
  Partial<WechatMiniprogram.Page.Data<TData>> &
  Partial<WechatMiniprogram.Page.ILifetime> & {
    options?: WechatMiniprogram.Component.ComponentOptions;
  }) &
  ThisType<WechatMiniprogram.Page.Instance<TData, TCustom & SwipeSelectMethods>>;

/**
 * 创建「滑动多选 + 批量删除 + 撤销」页面选项的标准入口
 *
 * 用法（页面里）：
 *   Page<Data, Custom>(
 *     defineSwipeSelectPage<ItemType, Data, Omit<Custom, keyof SwipeSelectMethods>>(
 *       { ...文案与落库钩子... },
 *       { ...页面差异部分：data / 生命周期 / 可见 id 与 refresh 钩子... }
 *     )
 *   );
 *
 * @param config 页面差异（文案 + 落库钩子）
 * @param page 页面差异部分（共享成员不必写，写了会覆盖共享实现）
 * @returns 完整的页面选项（含共享编排），直接传给 Page()
 */
export function defineSwipeSelectPage<
  T,
  TData extends WechatMiniprogram.Page.DataOption,
  TCustom extends SwipeSelectHooks & WechatMiniprogram.Page.CustomOption
>(
  config: SwipeSelectConfig<T>,
  page: SwipeSelectPageOptions<TData, TCustom>
): WechatMiniprogram.Page.Options<TData, TCustom & SwipeSelectMethods> {
  // 运行时合并：共享成员在前、页面差异在后（页面可按需覆盖共享方法）。
  // 类型上成立的前提：page 的 TCustom 已 Omit 掉共享成员，合并结果正好是完整的 Options。
  return Object.assign(createSwipeSelectMixin<T>(config), page) as WechatMiniprogram.Page.Options<
    TData,
    TCustom & SwipeSelectMethods
  >;
}

/** mixin 方法内部使用的 self 视图：页面 this 的共享部分 */
interface SwipeSelectSelf<T> {
  data: SwipeSelectData;
  setData(patch: Partial<SwipeSelectData>, callback?: () => void): void;
  selectComponent(selector: string): unknown;
  removeTimer: ReturnType<typeof setTimeout> | null;
  exitTimer: ReturnType<typeof setTimeout> | null;
  rowResetTimer: ReturnType<typeof setTimeout> | null;
  pickedOrder: string[];
  openedSwipes: string[];
  stash: T[];
  visibleIds(): string[];
  refresh(extra?: Partial<SwipeSelectData>): void;
}

/**
 * 共享 data 的初始值
 * 页面在自己的 data 字面量里展开它（...swipeSelectData()），再补自己的字段。
 * @returns SwipeSelectData
 */
export function swipeSelectData(): SwipeSelectData {
  return {
    selecting: false,
    openSideMap: {},
    exitMap: {},
    pickMap: {},
    pickedCount: 0,
    allPicked: false,
    pinnedMap: {},
    shrinkingMap: {},
    undoVisible: false,
    undoText: '',
    swipeReset: false,
    swipeWidth: swipeActionWidth(),
  };
}

/**
 * 创建「滑动多选 + 批量删除 + 撤销」的共享编排
 *
 * 返回的对象与页面差异部分 Object.assign 后传给 Page()：
 * data 初始值请用 swipeSelectData()（这里不带 data 字段，避免两处各写一份）。
 *
 * @param config 页面差异（文案 + 落库钩子）
 * @returns SwipeSelectMethods
 */
export function createSwipeSelectMixin<T>(config: SwipeSelectConfig<T>): SwipeSelectMethods {
  return {
    removeTimer: null,
    exitTimer: null,
    rowResetTimer: null,
    pickedOrder: [],
    openedSwipes: [],
    stash: [],

    /** 重算选中态派生数据（条数 / 是否全选 / 顺序） */
    syncPick() {
      const self = this as unknown as SwipeSelectSelf<T>;
      const all = self.visibleIds();
      const order = all.filter((id) => self.data.pickMap[id]);
      self.pickedOrder = order;
      self.setData({
        pickedCount: order.length,
        allPicked: order.length > 0 && order.length === all.length,
      });
    },

    /** 退出多选并清空选中 */
    clearPick() {
      const self = this as unknown as SwipeSelectSelf<T>;
      self.pickedOrder = [];
      self.setData({ selecting: false, pickMap: {}, pickedCount: 0, allPicked: false });
    },

    /**
     * 收回指定行（该行已不在列表时静默跳过）
     * @param id 记录 id
     */
    closeSwipe(id: string) {
      const inst = (this as unknown as SwipeSelectSelf<T>).selectComponent('#swipe-' + id) as
        | SwipeCellLike
        | null;
      inst?.close?.();
    },

    /**
     * 收回所有已滑开的行
     *
     * 两条来源并用，缺一不可：
     * 1) 实例树扫描（collectOpenCells）—— 当前真正开着的是哪些，以组件内部 offset 为准；
     * 2) `openedSwipes` 记录 —— 实例树结构随基础库变化，扫不到时按记录再兜一层。
     *
     * ⚠️ 早期只按 id 记录 + `selectComponent('#swipe-<id>')` 收：id 选择器在部分基础库上
     * 不命中子组件（`selectComponent` 静默返回 null），于是"记录清了、行还开着"，
     * 那一行从此滑不动，且**看起来完全正常**。现在实例扫描是主力。
     */
    closeAllSwipes() {
      const self = this as unknown as SwipeSelectSelf<T>;
      const ids = self.openedSwipes;
      self.openedSwipes = [];
      const got = new Set<unknown>();
      collectOpenCells().forEach((inst) => {
        got.add(inst);
        inst.close?.();
      });
      ids.forEach((id) => {
        const inst = self.selectComponent('#swipe-' + id) as SwipeCellLike | null;
        if (!inst || got.has(inst)) return;
        got.add(inst);
        inst.close?.();
      });
      // 位置记录必须**无条件**清掉：早退不清会让一条脏记录跨页活下来，
      // 而 openSideMap 里残留的 'left' / 'right' 会把那一行另一侧的宽度永久钉在 0（再也滑不出来）
      if (Object.keys(self.data.openSideMap).length) self.setData({ openSideMap: {} });
    },

    /**
     * 页面滚动时收回所有滑开的行（onPageScroll 里调用）
     *
     * 切页不再收口：滑开状态跨页保留（2026-09-21 用户定稿，"切回来是什么样就是什么样，就不动它"），
     * 滚动因此成为主要的收口时机 —— 也是列表类应用的惯例：滚起来，露出的操作块就该收回去。
     *
     * 为什么这里用 closeAllSwipes 而不是"宽度归零"：此刻用户**正看着这一页**，
     * 归零一帧会让整列闪没；实例扫描 + close() 走 Vant 自己的 0.6s 过渡，视觉正常。
     * 实例扫描按组件内部 offset 找（同步真值），查不到的 id 再按 openedSwipes 记录兜一层。
     *
     * 守卫必须便宜：onPageScroll 滚动期间高频触发，什么都没开时只做两次对象判断就返回。
     */
    closeSwipesOnScroll() {
      const self = this as unknown as SwipeSelectSelf<T>;
      if (self.data.selecting) return;
      // 宽度若还停在归零帧（异常残留），顺手还原 —— 否则两槽宽度为 0，整页都滑不出来
      if (self.data.swipeReset) {
        self.setData({ swipeReset: false });
      }
      const hasOpen = self.openedSwipes.length > 0 || Object.keys(self.data.openSideMap).length > 0;
      if (!hasOpen) return;
      this.closeAllSwipes();
    },

    /**
     * 手指离开这一行
     *
     * Vant 只在"滑开"时发 open 事件，**收回去时不发任何通知**（内部 swipeMove(0)）。
     * 所以这里补一刀：只有离开时 offset 仍非 0（确实开着）才保留位置记录；
     * 否则说明这次手势其实是"滑回去收起"，记录必须清掉——不清的话该行另一侧会永远停在宽度 0、再也滑不出来。
     *
     * @param e 触摸事件；dataset.name 为记录 id
     */
    onCellTouchEnd(e: { currentTarget: { dataset: { name?: string } } }) {
      const self = this as unknown as SwipeSelectSelf<T>;
      const id = String(e.currentTarget?.dataset?.name ?? '');
      if (!id || !self.data.openSideMap[id]) return;
      const inst = self.selectComponent('#swipe-' + id) as { offset?: number } | null;
      // offset 非 0 = 还开着，保留记录；拿不到实例（已删除）也当作要清
      if (inst && inst.offset) return;
      // touch 事件在 swipe-cell 外层，而 onClick 是 catchtap：手指移出卡片后抬起不会触发 click，
      // 位置记录就永远留着 —— 该行另一侧宽度恒为 0、再也滑不出来。所以这里必须补清：
      // 用数据驱动（两槽宽度归零一帧）而不是只调 close()，实例查不到时也不会静默失效。
      this.forceCloseRow(id);
    },

    /**
     * 点了一下这一行（Vant 的 click 事件：点内容、点槽位都会发）
     *
     * 点内容会把滑开的行收回去，且发生在 touchend 之后，所以只能靠这个事件补清记录。
     *
     * @param e van-swipe-cell 的 click 事件；dataset.name 为记录 id
     */
    onCellTap(e: { currentTarget: { dataset: { name?: string } } }) {
      this.clearOpenSide(String(e.currentTarget?.dataset?.name ?? ''));
    },

    /**
     * 清掉某一行的"滑开侧"记录
     * @param id 记录 id
     */
    clearOpenSide(id: string) {
      const self = this as unknown as SwipeSelectSelf<T>;
      if (!id || !self.data.openSideMap[id]) return;
      const openSideMap = Object.assign({}, self.data.openSideMap);
      delete openSideMap[id];
      self.setData({ openSideMap });
    },

    /**
     * 强制收回某一行：清掉位置记录 + 把两槽宽度归零一帧
     *
     * 为什么不能只调 `close()`：实例也可能已经不存在（跨页 / 该行刚被删），
     * `inst?.close?.()` 会静默什么都不做；而记录若同时被清掉，
     * 这一行就卡在"看起来是收起的、其实 Vant 内部 offset 还在滑开位"——
     * 再滑一点位移就被 range 钳住，表现为"怎么滑都不动"。
     * 宽度归零一帧则是 Vant 自己会响应（observer → swipeMove(width)）的路径，不依赖实例查找。
     *
     * ⚠️ 这里必须**还原**（否则整页滑不出来），靠 `rowResetTimer` 等一帧多一点；
     * 又因为是**单行**路径、且用户此刻手指刚离开、下一次触屏会打断过渡，
     * 这里"归零 → 还原"挤在同一批次的风险极小（Vant 的 offset 此刻本来就是 0）。
     * 把这种"归零 → 还原"推广到切页收口曾导致"快速切页后滑不动"，别再走回头路。
     *
     * @param id 记录 id
     */
    forceCloseRow(id: string) {
      const self = this as unknown as SwipeSelectSelf<T>;
      this.clearOpenSide(id);
      if (self.data.swipeReset) return;
      self.setData({ swipeReset: true });
      if (self.rowResetTimer) clearTimeout(self.rowResetTimer);
      self.rowResetTimer = setTimeout(() => {
        self.rowResetTimer = null;
        self.setData({ swipeReset: false });
      }, SWIPE_ROW_RESET_MS);
    },

    /**
     * 滑开一块：右滑进入多选，多选态下左滑退出
     *
     * 用 open 事件而不是"滑开后点按钮"：滑动本身就是明确意图，
     * 再要求点一下等于把同一个动作拆成两步。
     *
     * @param e van-swipe-cell 的 open 事件；
     *   detail.position：'left' = 右滑露出的左槽，'right' = 左滑露出的右槽；detail.name 为记录 id
     */
    onSwipeOpen(e: { detail: { position: 'left' | 'right'; name: string } }) {
      const self = this as unknown as SwipeSelectSelf<T>;
      const position = e.detail?.position;
      const id = String(e.detail?.name ?? '');
      if (!id) return;
      if (!self.openedSwipes.includes(id)) self.openedSwipes.push(id);
      // 记下这一行滑开的是哪一侧：模板据此把另一侧 width 置 0，
      // 于是"反向滑动"只会把这一行收回去，不会顺手把另一侧的块也露出来
      self.setData({ openSideMap: { [id]: position } });

      if (position === 'left') {
        // 多选态下左槽宽度已归零，理论上不会走到这里；兜一层以防 Vant 状态错位。
        //
        // ⚠️ 直接 return 会留下一个致命脏记录：清 openSideMap 的活儿在 enterSelect 里，
        // 跳过它就等于把 'left' 永久写在这一行头上 → 该行右槽宽度恒为 0 →
        // 左滑（删除）从此再也滑不出来，且那一行**看起来还是收起的**，极难排查。
        if (self.data.selecting) {
          this.clearOpenSide(id);
          return;
        }
        this.enterSelect(id);
        return;
      }
      if (self.data.selecting) this.exitSelect();
    },

    /**
     * 左槽里的「多选」按钮（滑出来之后再点，与直接滑到底等价）
     * @param e 槽位内容的 tap 事件，dataset.id 为记录 id
     */
    onEnterSelect(e: { currentTarget: { dataset: { id: string } } }) {
      this.enterSelect(e.currentTarget.dataset.id);
    },

    /**
     * 进入多选：把触发的那一条一并选上
     * @param id 记录 id；不传则只进入多选、不选中任何一条
     */
    enterSelect(id?: string) {
      const self = this as unknown as SwipeSelectSelf<T>;
      haptic('medium');
      const pickMap: Record<string, boolean> = {};
      if (id) pickMap[id] = true;
      // 左槽宽度归零会把这一行收回，位置记录同步清掉
      self.setData(
        { selecting: true, pickMap, pickedCount: 0, allPicked: false, openSideMap: {} },
        () => this.syncPick()
      );
      // 退出靠"左滑"，不教一下不容易发现
      hintOnce(config.exitHintKey, config.exitHintText);
    },

    /**
     * 退出多选（多选态左滑触发）
     *
     * 立刻退出（要灵敏，不能等动画），但不能让右槽当场换成红色删除块——
     * Vant 的收起是 0.6s 过渡，那样整段动画都在闪红。
     * 所以把刚滑开的那一行记进 exitMap，让它在收起动画期间继续显示中性色的「退出」，动画结束再清。
     */
    exitSelect() {
      const self = this as unknown as SwipeSelectSelf<T>;
      haptic('light');
      const opened = self.openedSwipes.slice();
      this.closeAllSwipes();
      const exitMap: Record<string, boolean> = {};
      opened.forEach((id) => {
        exitMap[id] = true;
      });
      self.pickedOrder = [];
      this.clearExitTimer();
      // 一次写完：退出多选 + 清空勾选 + 保留中性色块
      self.setData({
        selecting: false,
        pickMap: {},
        pickedCount: 0,
        allPicked: false,
        openSideMap: {},
        exitMap,
      });
      self.exitTimer = setTimeout(() => {
        self.exitTimer = null;
        self.setData({ exitMap: {} });
      }, SWIPE_CLOSE_MS);
    },

    /** 清掉"退出多选"的延迟定时器与中性色块（切页 / 卸载时调用） */
    clearExitTimer() {
      const self = this as unknown as SwipeSelectSelf<T>;
      if (self.exitTimer) {
        clearTimeout(self.exitTimer);
        self.exitTimer = null;
      }
      if (Object.keys(self.data.exitMap).length) self.setData({ exitMap: {} });
    },

    /** 首次看到有内容的列表时教一次入口手势（同一会话只提示一次） */
    hintSwipe() {
      const self = this as unknown as SwipeSelectSelf<T>;
      if (self.data.selecting || !self.visibleIds().length) return;
      hintOnce(config.enterHintKey, config.enterHintText);
    },

    /**
     * 切换单条选中（卡片点击/长按与行首选择位共用）
     * @param e 事件：卡片传 detail.id，选择位传 dataset.id
     */
    onPick(e: { detail?: { id: string }; currentTarget?: { dataset?: { id?: string } } }) {
      const self = this as unknown as SwipeSelectSelf<T>;
      const id = e.detail?.id || e.currentTarget?.dataset?.id;
      if (!id) return;
      haptic('light');
      // 整体替换 map：路径式 setData 的类型更绕，这里量小、图个省心
      const pickMap = Object.assign({}, self.data.pickMap, { [id]: !self.data.pickMap[id] });
      self.setData({ pickMap }, () => this.syncPick());
    },

    /** 全选 / 取消全选（范围 = 当前可见项） */
    onPickAll() {
      const self = this as unknown as SwipeSelectSelf<T>;
      const ids = self.visibleIds();
      if (!ids.length) return;
      haptic('light');
      const pickMap: Record<string, boolean> = {};
      // 已全选 → 清空；否则全选
      if (!(self.data.pickedCount === ids.length && ids.length > 0)) {
        ids.forEach((id) => {
          pickMap[id] = true;
        });
      }
      self.setData({ pickMap }, () => this.syncPick());
    },

    /** 批量删除选中项 */
    onDeletePicked() {
      const self = this as unknown as SwipeSelectSelf<T>;
      if (!self.pickedOrder.length) {
        wx.showToast({ title: config.noPickToast, icon: 'none' });
        return;
      }
      this.deleteRecords(self.pickedOrder.slice());
    },

    /**
     * 左滑删除单条（与批量删除同一条代码路径：都是"收起 → 删除 → 给撤销机会"）
     * @param e 左滑删除按钮的 tap 事件
     */
    onDelete(e: { currentTarget: { dataset: { id: string } } }) {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      this.deleteRecords([id]);
    },

    /**
     * 删除若干条记录：整行收起 → 落库 → 底部给撤销
     * @param ids 记录 id 集合（顺序需与列表展示顺序一致，批量收起时按此顺序取高度）
     */
    deleteRecords(ids: string[]) {
      const self = this as unknown as SwipeSelectSelf<T>;
      if (!ids.length) return;
      haptic('heavy');
      this.collapseRemove(ids, () => {
        const removed = config.removeItems(ids);
        self.pickedOrder = [];
        // 一次 setData 里同时完成：移除该行 + 退出多选 + 清掉收起态。
        // 若"先复原收起态、下一帧才删数据"，该行会先长回来一帧，其余行跟着上下跳——就是用户看到的"闪一下"
        self.refresh({
          selecting: false,
          pickMap: {},
          pickedCount: 0,
          allPicked: false,
          openSideMap: {},
          pinnedMap: {},
          shrinkingMap: {},
        });
        if (!removed.length) return;
        self.stash = removed;
        self.setData({ undoVisible: true, undoText: config.undoText(removed.length) });
      });
    },

    /** 撤销删除：原样写回（保留 id 与创建时间） */
    onUndo() {
      const self = this as unknown as SwipeSelectSelf<T>;
      haptic('medium');
      const stash = self.stash;
      self.stash = [];
      self.setData({ undoVisible: false }, () => {
        config.restoreItems(stash);
        self.refresh();
        wx.showToast({ title: '已恢复', icon: 'none' });
      });
    },

    /** 撤销超时：丢弃暂存 */
    onUndoExpire() {
      const self = this as unknown as SwipeSelectSelf<T>;
      self.stash = [];
      self.setData({ undoVisible: false });
    },

    /**
     * 播放「整行收起」动画后再执行删除
     *
     * CSS 无法从 auto 过渡到 0，因此必须分两帧：
     * 1) 把所有待删行的实测高度写成内联 max-height（外观不变，但过渡有了数值起点）
     * 2) 下一帧再加收起类（max-height → 0），过渡才会真正跑起来
     *
     * @param ids 待删除的记录 id（顺序 = 列表展示顺序）
     * @param done 动画结束后的回调：此时才真正删数据，并负责把 pinnedMap / shrinkingMap
     *   清干净（并进同一次 setData —— 单独清会让行先复原一帧，列表闪一下）
     */
    collapseRemove(ids: string[], done: () => void) {
      const self = this as unknown as SwipeSelectSelf<T>;
      if (!ids.length) {
        done();
        return;
      }
      // 单条用 id 选择器；多条用选中标记类，返回顺序即 DOM 顺序（= ids 顺序）
      const selector = ids.length === 1 ? '#cell-' + ids[0] : '.row-picked';
      measureHeights(this as unknown as MeasureContext, selector, (heights) => {
        const pinnedMap: Record<string, number> = {};
        ids.forEach((id, i) => {
          pinnedMap[id] = heights[i] ?? 0;
        });
        self.setData({ pinnedMap }, () => {
          wx.nextTick(() => {
            const shrinkingMap: Record<string, boolean> = {};
            ids.forEach((id) => {
              shrinkingMap[id] = true;
            });
            self.setData({ shrinkingMap });
            self.removeTimer = setTimeout(() => {
              self.removeTimer = null;
              // 只回调，**不在这里清 pinnedMap / shrinkingMap**：
              // 此刻该行还在数据里，一旦清掉收起态它就会复原成满高（下一帧才随删除消失），列表会闪。
              // 清理交给 done 的那一次 setData 一并完成（见 deleteRecords 的 refresh extra）。
              done();
            }, COLLAPSE_DURATION_MS);
          });
        });
      });
    },
  };
}
