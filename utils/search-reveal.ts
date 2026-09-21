/**
 * 顶部搜索栏「下拉露出 / 自动收起」的纯计算部分
 *
 * 为什么不用原生下拉刷新（enablePullDownRefresh）拿"到顶后继续下拉"的位移：
 * 那会连微信自带的转圈 loading 和整页下拉位移一起带上，与本项目"轻、静"的观感冲突。
 * 纯 onPageScroll 拿不到负的 scrollTop，但**方向**够用：手指下拉（scrollTop 变小）即露出，
 * 往下翻（scrollTop 变大）即收起 —— 与微信读书 / 淘宝那类列表页的实际观感一致。
 *
 * 本文件只做判定（无副作用、可单测）；setData / 定时器编排在 behaviors/search-reveal.ts。
 */

/**
 * 露出 / 收起的动画时长（ms）
 *
 * 必须与 `app.wxss` 里 `.search-slot` 的 transition 时长一致：
 * 容器高度从 0 到设计高度就是这一段，JS 侧只负责翻状态。
 */
export const SEARCH_REVEAL_MS = 240;

/**
 * 搜索栏容器的设计高度（rpx）
 *
 * van-search 的自然高度 ≈ 44px（上下 padding 各 10px + 内容 24px），取 96rpx（=48px）
 * 略留一点呼吸，同时让 `.search-slot` 的 height 有**确定值**可过渡——
 * 不这么做就得测量真实高度，而元素在 height: 0 时量不出来（拿到 0）。
 */
export const SEARCH_SLOT_HEIGHT_RPX = 96;

/** 露出后无操作自动收起的等待（ms）；正在输入或输入框聚焦时不收 */
export const SEARCH_IDLE_HIDE_MS = 5000;

/**
 * 「下拉露出」只在距顶部这么近时生效（px）
 *
 * 列表中部上滑时若把搜索栏撑开，下方内容会整体下移 48px，叠在手指位移上看着像"内容自己跳"。
 * 只在贴近顶部时露出，视觉上就是"拉到顶，抽屉拉开"。
 */
export const SEARCH_REVEAL_TOP_PX = 150;

/** 方向判定阈值（px）：小于它的位移当抖动，不翻转显隐 */
export const SEARCH_DIRECTION_EPS = 8;

/**
 * "能滚动"的判定余量（px）
 *
 * 内容只比视口高几个像素时，滚动范围还不到方向阈值（SEARCH_DIRECTION_EPS），
 * 用户根本做不出一次"下拉"→ 搜索栏会永远拉不出来。所以高出这点以内也算"不能滚动"。
 */
export const SEARCH_FIT_SLACK_PX = 24;

/** 滚动一次之后的显隐意图 */
export type SearchRevealIntent = 'show' | 'hide' | 'none';

/** 方向判定的入参 */
export interface ScrollIntentOptions {
  /** 上一次的 scrollTop（px） */
  prevTop: number;
  /** 本次的 scrollTop（px） */
  top: number;
  /** 当前是否已露出 */
  shown: boolean;
  /** 当前是否处于"搜索无意义"的状态（多选态） */
  blocked: boolean;
  /** 距顶部多少 px 以内才允许露出，默认 SEARCH_REVEAL_TOP_PX */
  nearTopPx?: number;
}

/**
 * 由两次 scrollTop 推出该露出还是收起
 *
 * 规则（用户定稿 2026-09-21）：
 * - 多选态：一律收起（搜索与多选是两套操作，不同时在场）
 * - 下拉（top 变小）：仅贴近顶部时露出
 * - 下翻（top 变大）：收起
 * - 位移小于阈值：不动（滚动期间的微小抖动不该让栏子闪）
 *
 * @param o 判定入参
 * @returns 该做的动作
 */
export function searchScrollIntent(o: ScrollIntentOptions): SearchRevealIntent {
  const top = Number.isFinite(o.top) ? Math.max(0, o.top) : 0;
  const prev = Number.isFinite(o.prevTop) ? Math.max(0, o.prevTop) : 0;
  if (o.blocked) return o.shown ? 'hide' : 'none';

  const delta = top - prev;
  if (Math.abs(delta) < SEARCH_DIRECTION_EPS) return 'none';

  if (delta < 0) {
    const nearTop = typeof o.nearTopPx === 'number' ? o.nearTopPx : SEARCH_REVEAL_TOP_PX;
    return top <= nearTop ? 'show' : 'none';
  }
  return o.shown ? 'hide' : 'none';
}

/**
 * 内容是否短到不能滚动
 *
 * 不能滚动 = 用户永远做不出"下拉"这个动作 → 搜索栏必须常驻，否则再也拉不出来。
 * 比较时**减掉搜索栏自身占的高度**（`shown` 时它已经撑开了），
 * 否则会出现"撑开 → 变得能滚动 → 收起 → 又不能滚动"的死循环。
 *
 * @param contentHeight 内容总高（px，含当前已撑开的搜索栏）
 * @param windowHeight 可视区高（px）
 * @param slotHeight 搜索栏占位高度（px）
 * @param shown 搜索栏当前是否露出
 * @returns 是否不能滚动
 */
export function searchFitsViewport(
  contentHeight: number,
  windowHeight: number,
  slotHeight: number,
  shown: boolean
): boolean {
  if (!(contentHeight > 0) || !(windowHeight > 0)) return false;
  const base = contentHeight - (shown ? slotHeight : 0);
  return base <= windowHeight + SEARCH_FIT_SLACK_PX;
}

/* ===== 贴顶下拉（触摸补位） =====
   背景（2026-09-21 用户反馈"进页直接下拉没反应，得先上滑再拉"）：
   页面已经在顶部时 scrollTop 就是 0，而小程序拿不到负值 —— onPageScroll 观测不到
   "到顶后继续拖"那一段位移，searchScrollIntent 的 delta 恒为 0 → 永远判 none。
   补法是再挂一路**触摸位移**：只有贴顶时才判定，中部照旧归 searchScrollIntent 管。

   ⚠️ 页面必须用 capture-bind 挂在根节点上：van-swipe-cell 在拖动中会 catchtouchmove
   阻断冒泡，绑冒泡阶段的监听收不到"手指落在卡片上"的那部分事件（见 behaviors 注释）。 */

/**
 * 贴顶下拉的触发距离（px）
 *
 * 取 28 ≈ 一次有意下拉的起步量。横向滑动（左滑删除 / 右滑多选）的纵向分量远达不到，
 * 所以不会在滑删时误开搜索栏。
 */
export const SEARCH_PULL_TRIGGER_PX = 28;

/**
 * 「贴顶」的判定容差（px）
 *
 * onPageScroll 的回报有延迟，滚动刚归零时记录的 scrollTop 可能还差一两像素，
 * 留一点容差，免得刚好错过一次下拉。
 */
export const SEARCH_PULL_TOP_TOLERANCE_PX = 2;

/** 贴顶下拉的判定入参 */
export interface TopPullOptions {
  /** 本次手势自起点起累计的纵向位移（px，向下为正） */
  dy: number;
  /** 当前 scrollTop（px） */
  top: number;
  /** 搜索栏当前是否已露出 */
  shown: boolean;
  /** 当前是否处于"搜索无意义"的状态（多选态） */
  blocked: boolean;
}

/**
 * 由触摸位移推出贴顶下拉是否该露出搜索栏
 *
 * 规则：
 * - 多选态：不动（搜索与多选不同时在场）
 * - 已露出：不动（一次手势只露一次，露出后继续拖不再重复触发）
 * - 不在顶部：不动（中部下拉归 searchScrollIntent 管，免得两路抢同一段手势）
 * - 贴顶且下移达到 SEARCH_PULL_TRIGGER_PX：露出
 *
 * @param o 判定入参
 * @returns 该做的动作
 */
export function topPullIntent(o: TopPullOptions): SearchRevealIntent {
  if (o.blocked || o.shown) return 'none';
  const top = Number.isFinite(o.top) ? Math.max(0, o.top) : 0;
  if (top > SEARCH_PULL_TOP_TOLERANCE_PX) return 'none';
  const dy = Number.isFinite(o.dy) ? o.dy : 0;
  return dy >= SEARCH_PULL_TRIGGER_PX ? 'show' : 'none';
}
