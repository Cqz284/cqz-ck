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
 * 松手吸附 / 自动收起的动画时长（ms）
 *
 * 由 JS 拼进 `.pull` 的内联 transition（跟手期间是 none），所以这里是**唯一**的时长来源，
 * 不必再去 app.wxss 里对齐第二份常量（旧的 SEARCH_REVEAL_MS 就是为 CSS 高度过渡准备的那一份）。
 */
export const PULL_SETTLE_MS = 340;

/**
 * 吸附动画的缓动曲线
 *
 * 末段轻微过冲（控制点 y = 1.18 > 1）→ 落位时"弹一下"，就是 iOS 橡皮筋那种手感。
 * 换成不过冲的 ease-out 会显得收尾很生硬，跟手之后的落位尤其明显。
 */
export const PULL_SETTLE_EASING = 'cubic-bezier(0.22, 1.18, 0.36, 1)';

/**
 * 搜索栏槽位高度（rpx）
 *
 * van-search 的自然高度 ≈ 44px（上下 padding 各 10px + 内容 24px），取 96rpx（=48px）略留呼吸。
 * 它是"位移多少算完全露出"的基准：`.pull` 下移它就正好把搜索栏带进视口顶；
 * 也是 JS 判断"内容够不够滚动"与"拉出量够不够吸附"的长度单位。
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

/* ===== 贴顶下拉：跟手位移 + 松手吸附 =====
   背景（2026-09-21 用户反馈"进页直接下拉没反应，得先上滑再拉"）：
   页面已经在顶部时 scrollTop 就是 0，而小程序拿不到负值 —— onPageScroll 观测不到
   "到顶后继续拖"那一段位移，searchScrollIntent 的 delta 恒为 0 → 永远判 none。
   补法是再挂一路**触摸位移**：只有贴顶时才接管，中部照旧归 searchScrollIntent 管。

   观感对齐微信聊天列表顶部搜索框（2026-09-21 第二轮定稿）：
   - 跟手：手指下拉多少、内容就下移多少（1:1），搜索框从上方滑入，不做整体弹出
   - 拉过槽位高度后进入阻尼段（超出部分只按 35% 计入），给一点余量而不是顶死
   - 松手：按**甩动速度 + 距离比例**吸附到全开或回弹到 0

   ⚠️ 页面必须用 capture-bind 挂在根节点上：van-swipe-cell 在拖动中会 catchtouchmove
   阻断冒泡，绑冒泡阶段的监听收不到"手指落在卡片上"的那部分事件（见 behaviors 注释）。 */

/**
 * 「贴顶」的判定容差（px）
 *
 * onPageScroll 的回报有延迟，滚动刚归零时记录的 scrollTop 可能还差一两像素，
 * 留一点容差，免得刚好错过一次下拉。
 */
export const SEARCH_PULL_TOP_TOLERANCE_PX = 2;

/**
 * 跟手的激活阈值（px）
 *
 * 手指下移超过它，搜索栏才开始跟手。为什么需要这一小段死区：
 * 横向滑动（左滑删除 / 右滑多选）总带几像素纵向漂移，若 1:1 直接跟，
 * 整页会跟着抖一下。越过阈值后仍是严格 1:1，只是整体差一个固定常数（感知不到）。
 */
export const PULL_ACTIVATE_PX = 6;

/**
 * 拉过槽位高度后的阻尼系数
 *
 * 1:1 跟手只发生在 dy ≤ slotHeight 那一段。再往下拉只按 35% 计入位移 ——
 * 手感是"拉到底还有一点余量"，而不是硬邦邦地顶死（iOS 橡皮筋就是这个套路）。
 */
export const PULL_OVERSHOOT_DAMPING = 0.35;

/**
 * 位移上限（相对槽位高度的倍数）
 *
 * 防止阻尼段被一路拉出半屏：超过这个值后手指继续走、画面不再动。
 */
export const PULL_MAX_RATIO = 1.6;

/**
 * 松手吸附的距离门槛（相对槽位高度的比例）
 *
 * 拉出量超过槽高的 40% 就吸附到全开，否则回弹。取 0.4 而非 0.5：
 * 跟手阶段已经给了充分的视觉反馈，门槛偏低一点，手感更"愿意开"。
 */
export const PULL_SNAP_RATIO = 0.4;

/**
 * 松手吸附的速度门槛（px/ms）
 *
 * 拉出量不够但甩得够快时也认账：向下甩 ≥ 0.3px/ms 直接全开，向上甩则回弹。
 * 0.3 ≈ 300px/s，是一次有意的快速甩动，日常轻微抖动到不了这个数。
 */
export const PULL_SNAP_VELOCITY = 0.3;

/** 跟手位移的入参 */
export interface PullOffsetOptions {
  /** 本次手势自起点起累计的纵向位移（px，向下为正） */
  dy: number;
  /** 搜索栏槽位高度（px） */
  slotHeight: number;
}

/**
 * 由手指位移算出内容该下移多少
 *
 * 四段（dy 是手指自起点起的累计位移，内部先扣掉 PULL_ACTIVATE_PX 的激活死区）：
 * - `dy ≤ 死区`：0（横向滑动带的纵向漂移不该让整页抖）
 * - `死区 < dy ≤ slotHeight`：1:1 跟手，搜索框位置严格跟手
 * - `dy > slotHeight`：超出部分按 PULL_OVERSHOOT_DAMPING 折减，封顶 PULL_MAX_RATIO
 *
 * @param o 判定入参
 * @returns 位移（px，≥ 0）
 */
export function pullOffsetFromDrag(o: PullOffsetOptions): number {
  const slot = Number.isFinite(o.slotHeight) && o.slotHeight > 0 ? o.slotHeight : 0;
  if (!slot) return 0;
  const raw = Number.isFinite(o.dy) ? o.dy : 0;
  const dy = raw - PULL_ACTIVATE_PX;
  if (dy <= 0) return 0;
  if (dy <= slot) return dy;
  const damped = slot + (dy - slot) * PULL_OVERSHOOT_DAMPING;
  return Math.min(damped, slot * PULL_MAX_RATIO);
}

/** 松手吸附的入参 */
export interface PullSnapOptions {
  /** 松手瞬间的下移距离（px） */
  offset: number;
  /** 松手瞬间的纵向速度（px/ms，向下为正）；拿不到时传 0 */
  velocity: number;
  /** 搜索栏槽位高度（px） */
  slotHeight: number;
}

/**
 * 松手后吸附到哪一端
 *
 * 顺序（速度优先 —— 甩动是比"拉到哪"更明确的意图）：
 * 1. 向下甩 ≥ PULL_SNAP_VELOCITY → 全开
 * 2. 向上甩 ≤ -PULL_SNAP_VELOCITY → 收起
 * 3. 都没甩：位移 ≥ slotHeight × PULL_SNAP_RATIO → 全开，否则收起
 *
 * @param o 判定入参
 * @returns 'open' 吸附到全开 / 'close' 回弹到收起
 */
export function pullSnapTarget(o: PullSnapOptions): 'open' | 'close' {
  const slot = Number.isFinite(o.slotHeight) && o.slotHeight > 0 ? o.slotHeight : 0;
  if (!slot) return 'close';
  const offset = Number.isFinite(o.offset) ? Math.max(0, o.offset) : 0;
  const velocity = Number.isFinite(o.velocity) ? o.velocity : 0;
  if (velocity >= PULL_SNAP_VELOCITY) return 'open';
  if (velocity <= -PULL_SNAP_VELOCITY) return 'close';
  return offset >= slot * PULL_SNAP_RATIO ? 'open' : 'close';
}
