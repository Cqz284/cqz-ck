/**
 * 列表页共享编排：顶部搜索栏「下拉露出 / 自动收起」
 *
 * 与 behaviors/swipe-select.ts 同一套写法：纯 TS 工厂/对象字面量 + 页面选项里展开，
 * 不用 Behavior()（页面统一用 Page<Data, Custom>() 泛型写法，Behavior 的合并运行时才发生，
 * 类型系统看不见）。这里用**对象字面量 + ThisType**：页面把它摊进自己的页面选项字面量即可，
 * 既保留 this 的完整类型，又不用改 defineSwipeSelectPage 的签名。
 *
 * 宿主页面的约定（缺了不会报错，但行为会不对）：
 * - data 里有 `keyword`：非空视为"正在使用"，不自动收起
 * - data 里有 `selecting`（由 swipe-select 提供）：多选态强制收起
 * - 模板用 `<view class="search-slot {{ searchShown ? 'search-slot--on' : '' }}">` 包住 van-search
 *   （样式在 app.wxss，高度由 --search-slot-h 决定）
 * - onPageScroll 调 `onPageScrollSearch(e.scrollTop)`；onShow 调 `resetSearchReveal()`
 * - 页面根节点挂 `capture-bind:touchstart/touchmove/touchend/touchcancel="onSearchTouch*"`
 *   ⚠️ 必须是 **capture-bind**：van-swipe-cell 拖动中会在自己节点上 catchtouchmove
 *   阻断冒泡，冒泡阶段的监听收不到"手指落在卡片上"的那部分事件（贴顶下拉正好全在卡片上）
 * - refresh 之后调 `checkSearchRevealFit()`（内容短到不能滚动时要让搜索栏常驻）
 * - onUnload 调 `clearSearchTimer()`
 *
 * 显隐的判定全在 utils/search-reveal.ts（纯函数、有单测），这里只管编排与副作用。
 */
import { rpxToPx } from '../utils/rpx';
import {
  SEARCH_IDLE_HIDE_MS,
  SEARCH_SLOT_HEIGHT_RPX,
  searchFitsViewport,
  searchScrollIntent,
  topPullIntent,
} from '../utils/search-reveal';

/** 共享 data 字段（页面 data 接口 extends 它，并在 data 字面量里展开 searchRevealData()） */
export interface SearchRevealData {
  /** 搜索栏是否露出；false 时容器高度为 0（不占位、不可点） */
  searchShown: boolean;
}

/** 共享实例字段（滚动位置、定时器、聚焦态），由 mixin 在页面选项里声明 */
export interface SearchRevealFields {
  /** 上一次的 scrollTop（px），方向判定用 */
  searchLastTop: number;
  /** 空闲自动收起的定时器 */
  searchIdleTimer: ReturnType<typeof setTimeout> | null;
  /** 输入框是否聚焦（聚焦中不自动收起，否则用户打字打到一半栏子会跑掉） */
  searchFocused: boolean;
  /** 内容短到不能滚动（此时搜索栏常驻：不能滚动就永远做不出"下拉"这个动作） */
  searchUnscrollable: boolean;
  /** 贴顶下拉手势的起点 clientY（px）；null = 这一路输入未激活 */
  searchTouchY: number | null;
}

/** 触摸事件的最小形状（只用到第一根手指的 clientY） */
export interface SearchTouchEvent {
  touches?: Array<{ clientY?: number }> | null;
}

export interface SearchRevealMethods {
  /** 页面滚动时调用（onPageScroll）：按方向露出 / 收起 */
  onPageScrollSearch(scrollTop: number): void;
  /** 触摸开始（capture-bind:touchstart）：贴顶下拉那一路记起点 */
  onSearchTouchStart(e: SearchTouchEvent): void;
  /** 触摸移动（capture-bind:touchmove）：贴顶且下移够远就露出 */
  onSearchTouchMove(e: SearchTouchEvent): void;
  /** 触摸结束 / 取消：清掉手势起点 */
  onSearchTouchEnd(): void;
  /** 露出搜索栏（幂等；顺带起"无操作自动收起"的计时） */
  showSearch(): void;
  /** 按"是否正在使用"决定是否收起（滚动向下、空闲超时走这里） */
  hideSearch(): void;
  /** 强制收起（忽略"正在使用"与"不可滚动"，用于多选态 / 切页复位） */
  hideSearchIfShown(): void;
  /** 输入框获得焦点（暂停自动收起） */
  onSearchFocus(): void;
  /** 输入框失焦（无内容则重新计时） */
  onSearchBlur(): void;
  /** 关键词变化后同步：非空保持露出，清空则重新计时 */
  syncSearchKeyword(keyword: string): void;
  /** 页面显示时复位（回到隐藏态；带关键词回来则保持露出） */
  resetSearchReveal(): void;
  /** 内容短到不能滚动时让搜索栏常驻（refresh 之后调用） */
  checkSearchRevealFit(): void;
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
}

/** 摊进页面选项的完整 mixin 形状 */
export interface SearchRevealMixin extends SearchRevealFields, SearchRevealMethods, SearchRevealInternal {}

/** 共享 data 的初始值 */
export function searchRevealData(): SearchRevealData {
  return { searchShown: false };
}

/** 搜索栏占位高度的 px 值（与 .search-slot 的 --search-slot-h 同源） */
function slotHeightPx(): number {
  return rpxToPx(SEARCH_SLOT_HEIGHT_RPX);
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
  searchUnscrollable: false,
  searchTouchY: null,

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
   * 贴顶下拉：记手势起点
   *
   * 已经露出（或处于多选态）时这一路输入没有意义，直接不记起点 —— 之后每次 touchmove
   * 都会在第一行空转返回，省掉无谓的位移计算。
   */
  onSearchTouchStart(e: SearchTouchEvent) {
    const self = this;
    if (self.data.searchShown || self.data.selecting) {
      self.searchTouchY = null;
      return;
    }
    const y = e.touches && e.touches[0] ? e.touches[0].clientY : undefined;
    self.searchTouchY = typeof y === 'number' && Number.isFinite(y) ? y : null;
  },

  /**
   * 贴顶下拉：位移够了就露出
   *
   * `top` 用的是**现读**的 searchLastTop（不是 touchstart 时的快照）：用户从列表中部一路拉回
   * 顶部时，手指还没松开就已经贴顶了，只有现读才接得住这一段。
   * 判定为 show 后立刻清掉起点 —— 一次手势只露一次，露出后继续拖不再重复触发。
   */
  onSearchTouchMove(e: SearchTouchEvent) {
    const self = this;
    if (self.searchTouchY === null) return;
    const y = e.touches && e.touches[0] ? e.touches[0].clientY : undefined;
    if (typeof y !== 'number' || !Number.isFinite(y)) return;
    const intent = topPullIntent({
      dy: y - self.searchTouchY,
      top: self.searchLastTop,
      shown: !!self.data.searchShown,
      blocked: !!self.data.selecting,
    });
    if (intent !== 'show') return;
    self.searchTouchY = null;
    self.showSearch();
  },

  /** 手指离开 / 手势被系统打断：清掉起点，下一次触摸重新记 */
  onSearchTouchEnd() {
    this.searchTouchY = null;
  },

  showSearch() {
    const self = this;
    // 多选态下搜索没有意义（勾选与筛选不同时在场）
    if (self.data.selecting) return;
    if (!self.data.searchShown) self.setData({ searchShown: true });
    // 露出即开始计时：用户没接着用就自己收回去
    self.armSearchTimer();
  },

  hideSearch() {
    const self = this;
    // 内容短到不能滚动：必须常驻，否则用户再也做不出"下拉"来把它拉出来
    if (self.searchUnscrollable) return;
    // 正在使用（有输入 / 聚焦中）：不动它，免得把生效中的筛选藏起来
    if (self.data.keyword || self.searchFocused) return;
    self.hideSearchIfShown();
  },

  hideSearchIfShown() {
    const self = this;
    self.clearSearchTimer();
    if (!self.data.searchShown) return;
    self.setData({ searchShown: false });
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
      if (!self.data.searchShown) self.setData({ searchShown: true });
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

  checkSearchRevealFit() {
    const self = this;
    const query = typeof wx !== 'undefined' && typeof wx.createSelectorQuery === 'function'
      ? wx.createSelectorQuery()
      : null;
    if (!query) return;
    query
      .selectViewport()
      .scrollOffset((res) => {
        const info = res as { scrollHeight?: number } | null;
        const contentHeight = info && typeof info.scrollHeight === 'number' ? info.scrollHeight : 0;
        let windowHeight = 0;
        try {
          if (typeof wx !== 'undefined' && typeof wx.getWindowInfo === 'function') {
            windowHeight = wx.getWindowInfo().windowHeight || 0;
          }
        } catch {
          windowHeight = 0;
        }
        const fit = searchFitsViewport(contentHeight, windowHeight, slotHeightPx(), !!self.data.searchShown);
        // 只在结论翻转时动一次：测量本身会随栏子尺寸变化，边界上反复翻会看着发抖
        if (fit === self.searchUnscrollable) return;
        self.searchUnscrollable = fit;
        if (fit) self.setData({ searchShown: true });
        else self.hideSearch();
      })
      .exec();
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
