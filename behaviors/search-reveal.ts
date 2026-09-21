/**
 * 列表页共享编排：顶部搜索栏「跟手下拉 · 松手吸附 · 自动收起」
 *
 * 与 behaviors/swipe-select.ts 同一套写法：纯 TS 对象字面量 + 页面选项里展开，
 * 不用 Behavior()（页面统一用 Page<Data, Custom>() 泛型写法，Behavior 的合并运行时才发生，
 * 类型系统看不见）。这里用**对象字面量 + ThisType**：页面把它摊进自己的页面选项字面量即可，
 * 既保留 this 的完整类型，又不用改 defineSwipeSelectPage 的签名。
 *
 * 位移模型（2026-09-21 第二轮定稿，对齐微信聊天列表顶部搜索框）：
 * 搜索栏平时停在内容**上方一个槽位高度**处（绝对定位、脱离文档流），而**整个内容容器
 * `.pull`** 用 transform 下移 `searchPullOffset` 把它带进视口 —— 所以观感是
 * "搜索框从上方滑入、内容整体下移"，而不是"容器高度从 0 撑开"（后者会把搜索框压扁）。
 * 手指贴顶下拉时位移逐帧跟手；松手按甩动速度 + 拉出量吸附到全开或回弹到 0。
 *
 * ⚠️ 跟手期间 transition 必须是 none（与位移一起拼在内联 style 里），否则位移被 0.34s
 * 曲线拖住、看着"慢半拍才跟上"。松手时同一次 setData 里换成带过冲的曲线 → 落位带弹簧感。
 * 这套"拖动中 none / 松手后过渡"的机制与 Vant swipe-cell 的跟手左滑完全一致
 * （它也是把 transform 与 transition 拼进同一个 wrapperStyle）。
 *
 * ⚠️ 收起必须靠**裁切**（2026-09-21 真机反馈"进页搜索栏就存在、闲置也不隐藏"）：
 * 本项目是自定义导航栏（app.json 的 navigationStyle: custom，页面里的 <navigation-bar> 是
 * **流内**节点、不是 fixed），所以 .page 的上方不是视口外、而正是**导航栏那一条** ——
 * 搜索栏绝对定位到 .pull 上方一个槽位高时正好落在里面，一直可见，位移归零也隐藏不掉。
 * 所以两个列表页的 .page 上必须带 `overflow: hidden`（裁切线 = .page 顶边 = .pull 的顶边），
 * 顶部留白相应下移到 .pull 的 padding-top —— 详见 app.wxss 里 .search-slot 那一段的说明。
 *
 * 宿主页面的约定（缺了不会报错，但行为会不对）：
 * - data 里有 `keyword`：非空视为"正在使用"，不自动收起
 * - data 里有 `selecting`（由 swipe-select 提供）：多选态强制收起
 * - 模板结构（`.pull` 必须包住搜索栏与全部内容）：
 *     <view class="pull" style="{{ searchPullStyle }}">
 *       <view class="search-slot">…van-search…</view>
 *       …其它内容…
 *     </view>
 *   （.pull 是 relative 容器，.search-slot 绝对定位到它上方，样式都在 app.wxss）
 * - onPageScroll 调 `onPageScrollSearch(e.scrollTop)`；onShow 调 `resetSearchReveal()`
 * - 页面根节点挂 `capture-bind:touchstart/touchmove/touchend/touchcancel="onSearchTouch*"`
 *   ⚠️ 必须是 **capture-bind**：van-swipe-cell 拖动中会在自己节点上 catchtouchmove
 *   阻断冒泡，冒泡阶段的监听收不到"手指落在卡片上"的那部分事件（贴顶下拉正好全在卡片上）
 * - onUnload 调 `clearSearchTimer()`
 *
 * 判定全在 utils/search-reveal.ts（纯函数、有单测），这里只管编排与副作用。
 */
import { rpxToPx } from '../utils/rpx';
import {
  PULL_SETTLE_EASING,
  PULL_SETTLE_MS,
  SEARCH_IDLE_HIDE_MS,
  SEARCH_PULL_TOP_TOLERANCE_PX,
  SEARCH_SLOT_HEIGHT_RPX,
  pullOffsetFromDrag,
  pullSnapTarget,
  searchScrollIntent,
} from '../utils/search-reveal';

/** 共享 data 字段（页面 data 接口 extends 它，并在 data 字面量里展开 searchRevealData()） */
export interface SearchRevealData {
  /**
   * 搜索栏是否露出（**目标态**）
   *
   * 跟手期间它与真实位移会短暂不一致（手指刚拉出一点、还没吸附），所以跟手中的判定
   * 一律看 `searchPullOffset`，它只表达"露出的意图"，供模板条件与既有逻辑使用。
   */
  searchShown: boolean;
  /** `.pull` 的内联样式：transform（当前位移）+ transition（跟手时为 none） */
  searchPullStyle: string;
}

/** 共享实例字段（滚动位置、手势采样、定时器、聚焦态），由 mixin 在页面选项里声明 */
export interface SearchRevealFields {
  /** 上一次的 scrollTop（px），方向判定用 */
  searchLastTop: number;
  /** 空闲自动收起的定时器 */
  searchIdleTimer: ReturnType<typeof setTimeout> | null;
  /** 输入框是否聚焦（聚焦中不自动收起，否则用户打字打到一半栏子会跑掉） */
  searchFocused: boolean;
  /** 当前实际位移（px）：data.searchPullStyle 的真值来源，跟手期间逐帧更新 */
  searchPullOffset: number;
  /** 跟手手势的起点 clientY（px）；null = 这一路输入未接管 */
  searchTouchY: number | null;
  /** 最近一次 touchmove 的 clientY（px），算甩动速度用 */
  searchPullLastY: number;
  /** 最近一次 touchmove 的时间戳（ms），算甩动速度用 */
  searchPullLastT: number;
  /** 最近一次算出的纵向速度（px/ms，向下为正） */
  searchPullVelocity: number;
}

/** 触摸事件的最小形状（只用到第一根手指的 clientY 与事件时间戳） */
export interface SearchTouchEvent {
  touches?: Array<{ clientY?: number }> | null;
  timeStamp?: number;
}

export interface SearchRevealMethods {
  /** 页面滚动时调用（onPageScroll）：按方向露出 / 收起 */
  onPageScrollSearch(scrollTop: number): void;
  /** 触摸开始（capture-bind:touchstart）：清掉上一段手势的残留采样 */
  onSearchTouchStart(): void;
  /** 触摸移动（capture-bind:touchmove）：贴顶后接管，位移 1:1 跟手 */
  onSearchTouchMove(e: SearchTouchEvent): void;
  /** 触摸结束 / 取消：按甩动速度与拉出量吸附到全开或回弹 */
  onSearchTouchEnd(): void;
  /** 露出搜索栏（幂等；顺带起"无操作自动收起"的计时） */
  showSearch(): void;
  /** 按"是否正在使用"决定是否收起（滚动向下、空闲超时走这里） */
  hideSearch(): void;
  /** 强制收起（忽略"正在使用"，用于多选态 / 切页复位） */
  hideSearchIfShown(): void;
  /** 输入框获得焦点（暂停自动收起） */
  onSearchFocus(): void;
  /** 输入框失焦（无内容则重新计时） */
  onSearchBlur(): void;
  /** 关键词变化后同步：非空保持露出，清空则重新计时 */
  syncSearchKeyword(keyword: string): void;
  /** 页面显示时复位（回到隐藏态；带关键词回来则保持露出） */
  resetSearchReveal(): void;
  /** 取消空闲计时器（onUnload 调用） */
  clearSearchTimer(): void;
}

/** mixin 方法内部使用的 self 视图 */
interface SearchRevealSelf extends SearchRevealFields, SearchRevealMethods, SearchRevealInternal {
  data: SearchRevealData & { keyword?: string; selecting?: boolean };
  setData(patch: Partial<SearchRevealData>): void;
}

/** mixin 内部方法（页面不必知道，但字面量里得有，否则 tsc 判为多余属性） */
interface SearchRevealInternal {
  /** 起"无操作自动收起"的计时 */
  armSearchTimer(): void;
  /** 把位移与展开态一次性应用到位（露出的唯一出口） */
  applyPullOffset(offset: number, shown: boolean): void;
}

/** 摊进页面选项的完整 mixin 形状 */
export interface SearchRevealMixin extends SearchRevealFields, SearchRevealMethods, SearchRevealInternal {}

/** 共享 data 的初始值 */
export function searchRevealData(): SearchRevealData {
  return { searchShown: false, searchPullStyle: pullStyleOf(0, false) };
}

/** 搜索栏槽位高度的 px 值（与 app.wxss 的 --search-slot-h 同源） */
function slotHeightPx(): number {
  return rpxToPx(SEARCH_SLOT_HEIGHT_RPX);
}

/**
 * 拼 `.pull` 的内联样式
 *
 * 位移与过渡必须**同一次**写进去。拆成两个 data 字段（或两次 setData）时，"关掉过渡"与
 * "改位移"可能落在不同帧 —— 结果是跟手的第一段被过渡吃掉，看着慢半拍才跟上。
 * 这跟 Vant swipe-cell 把 transform 与 transition 拼进同一个 wrapperStyle 是同一个道理。
 *
 * @param offset 内容下移距离（px）
 * @param dragging 是否正在跟手（true = 不加过渡，位移即时生效）
 */
function pullStyleOf(offset: number, dragging: boolean): string {
  const transition = dragging ? 'none' : `transform ${PULL_SETTLE_MS}ms ${PULL_SETTLE_EASING}`;
  return `transform: translate3d(0, ${offset}px, 0); transition: ${transition};`;
}

/** 取第一根手指的 clientY；拿不到返回 null */
function touchClientY(e: SearchTouchEvent): number | null {
  const y = e && e.touches && e.touches[0] ? e.touches[0].clientY : undefined;
  return typeof y === 'number' && Number.isFinite(y) ? y : null;
}

/** 取事件时间戳（ms）；小程序一定带 timeStamp，兜底用 Date.now() */
function touchTime(e: SearchTouchEvent): number {
  const t = e && typeof e.timeStamp === 'number' ? e.timeStamp : 0;
  return t > 0 ? t : Date.now();
}

/**
 * 摊进页面选项字面量即可获得全套行为：
 *
 *   defineSwipeSelectPage<...>(config, {
 *     ...searchRevealMixin,
 *     data: { ...searchRevealData(), ... },
 *     onPageScroll(e) { this.closeSwipesOnScroll(); this.onPageScrollSearch(e.scrollTop); },
 *   })
 */
export const searchRevealMixin: SearchRevealMixin & ThisType<SearchRevealSelf> = {
  searchLastTop: 0,
  searchIdleTimer: null,
  searchFocused: false,
  searchPullOffset: 0,
  searchTouchY: null,
  searchPullLastY: 0,
  searchPullLastT: 0,
  searchPullVelocity: 0,

  onPageScrollSearch(scrollTop: number) {
    const self = this;
    const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
    const intent = searchScrollIntent({
      prevTop: self.searchLastTop,
      top,
      shown: !!self.data.searchShown,
      blocked: !!self.data.selecting,
    });
    self.searchLastTop = top;
    if (intent === 'show') self.showSearch();
    else if (intent === 'hide') self.hideSearch();
  },

  /**
   * 触摸开始：只清残留，不决定是否接管
   *
   * 接管判定故意放在 touchmove 里惰性做 —— 要接的不只是"起手就贴顶"的手势，还有
   * "从列表中部一路拉回顶部"的手势。后者的起点在页面中部，dy 里混着一大段页面滚动，
   * 只有等页面真的贴顶了才把它当跟手位移起算，位移才不会突变。
   */
  onSearchTouchStart() {
    const self = this;
    self.searchTouchY = null;
    self.searchPullLastY = 0;
    self.searchPullLastT = 0;
    self.searchPullVelocity = 0;
  },

  /**
   * 触摸移动：贴顶后接管，位移 1:1 跟手
   *
   * 进入接管只有一个判据 —— **此刻贴顶且手指在往下走**，两种时机共用它：
   * - 起手就在顶部：第一次有效的 move 即接管
   * - 从列表中部的下拉：页面滚回顶部那一帧的 move 接管，位移从那里重新起算
   */
  onSearchTouchMove(e: SearchTouchEvent) {
    const self = this;
    // 已露出 / 多选态：没有"再跟手拉出来"这回事
    if (self.data.searchShown || self.data.selecting) {
      self.searchTouchY = null;
      return;
    }
    const y = touchClientY(e);
    if (y === null) return;

    // 甩动速度：用相邻两次采样算，touchend 时读最近一次的值
    const t = touchTime(e);
    if (self.searchPullLastT > 0 && t > self.searchPullLastT) {
      self.searchPullVelocity = (y - self.searchPullLastY) / (t - self.searchPullLastT);
    }
    self.searchPullLastY = y;
    self.searchPullLastT = t;

    if (self.searchTouchY === null) {
      if (self.searchLastTop > SEARCH_PULL_TOP_TOLERANCE_PX) return;
      if (self.searchPullVelocity < 0) return; // 正在上滑，不是"下拉露出"
      self.searchTouchY = y;
      // 起步这一帧就把过渡关掉（位移保持当前值）：否则第一段位移会被 0.34s 曲线吃掉
      self.setData({ searchPullStyle: pullStyleOf(self.searchPullOffset, true) });
      return;
    }

    const offset = pullOffsetFromDrag({ dy: y - self.searchTouchY, slotHeight: slotHeightPx() });
    if (offset === self.searchPullOffset) return; // 手指停住时每帧都会进来，别空转 setData
    self.searchPullOffset = offset;
    self.setData({ searchPullStyle: pullStyleOf(offset, true) });
  },

  /**
   * 触摸结束 / 取消：按速度与拉出量吸附
   *
   * 速度优先 —— 甩动比"拉到哪"更能表达意图；都没甩再看拉出量过没过门槛。
   *
   * 回弹这一支**刻意不走 hideSearch**：它会被"正在使用"拦下，那样位移就停在半路
   * （手指已经松开、内容却卡在中间）。回弹只表达"这段手势没拉够"，与"有关键词"无关 ——
   * 该不该跟手已经在入口拦下了（`searchShown` 为真时不接管手势）。
   */
  onSearchTouchEnd() {
    const self = this;
    const started = self.searchTouchY !== null;
    self.searchTouchY = null;
    if (!started) return;
    const slot = slotHeightPx();
    const target = pullSnapTarget({
      offset: self.searchPullOffset,
      velocity: self.searchPullVelocity,
      slotHeight: slot,
    });
    if (target === 'open') {
      self.showSearch();
      return;
    }
    self.applyPullOffset(0, false);
  },

  showSearch() {
    const self = this;
    // 多选态下搜索没有意义（勾选与筛选不同时在场）
    if (self.data.selecting) return;
    const slot = slotHeightPx();
    if (!self.data.searchShown || self.searchPullOffset !== slot) {
      self.applyPullOffset(slot, true);
    }
    // 露出即开始计时：用户没接着用就自己收回去
    self.armSearchTimer();
  },

  hideSearch() {
    const self = this;
    // 正在使用（有输入 / 聚焦中）：不动它，免得把生效中的筛选藏起来
    if (self.data.keyword || self.searchFocused) return;
    self.hideSearchIfShown();
  },

  hideSearchIfShown() {
    const self = this;
    self.clearSearchTimer();
    // 跟手到一半被外部叫停时 searchShown 还是 false，但位移非 0 —— 也要归零
    if (!self.data.searchShown && self.searchPullOffset === 0) return;
    self.applyPullOffset(0, false);
  },

  /**
   * 把位移与展开态一次性应用到位
   *
   * 露出的**唯一出口**：跟手吸附、滚动收回、空闲收起、切页复位全都汇到这里，
   * 位移与目标态因此不可能各写各的（"状态翻了但画面没动"就是那么来的）。
   * 顺带丢弃手势 —— 位移既然被外部接管，未完成的那段手势就不该再往画面里写值。
   */
  applyPullOffset(offset: number, shown: boolean) {
    const self = this;
    self.searchPullOffset = offset;
    self.searchTouchY = null;
    self.setData({ searchShown: shown, searchPullStyle: pullStyleOf(offset, false) });
  },

  onSearchFocus() {
    const self = this;
    self.searchFocused = true;
    // 聚焦中不自动收起（否则打字打到一半栏子会跑掉）
    self.clearSearchTimer();
  },

  onSearchBlur() {
    const self = this;
    self.searchFocused = false;
    // 有内容就保持露出，等清空后再走"空闲收起"
    if (self.data.keyword) return;
    self.armSearchTimer();
  },

  syncSearchKeyword(keyword: string) {
    const self = this;
    if (keyword) {
      self.clearSearchTimer();
      if (!self.data.searchShown) self.applyPullOffset(slotHeightPx(), true);
      return;
    }
    self.armSearchTimer();
  },

  resetSearchReveal() {
    const self = this;
    self.searchLastTop = 0;
    self.searchFocused = false;
    self.clearSearchTimer();
    // 带着关键词切页往返：保持露出（藏起来会让用户不知道列表被筛过）
    if (self.data.keyword) return;
    self.hideSearchIfShown();
  },

  clearSearchTimer() {
    const self = this;
    if (!self.searchIdleTimer) return;
    clearTimeout(self.searchIdleTimer);
    self.searchIdleTimer = null;
  },

  /**
   * 起"无操作自动收起"的计时
   *
   * 定时器回调里 this 不是页面实例，所以闭包先取 self；调 hideSearch 而不是直接 setData，
   * 让它自己再判断一次"是否正在使用"。
   */
  armSearchTimer() {
    const self = this;
    self.clearSearchTimer();
    self.searchIdleTimer = setTimeout(() => {
      self.searchIdleTimer = null;
      self.hideSearch();
    }, SEARCH_IDLE_HIDE_MS);
  },
};
