/**
 * 动效工具：数字滚动、节点测量（配合"删除时整行收起"的动画）
 *
 * 纯计算部分（easeOutCubic / tweenValue）单独导出，便于单测；
 * 计时部分只依赖 setTimeout，不依赖 wx，可在 node 环境跑。
 */

/** 可被 wx.createSelectorQuery().in() 接受的宿主实例（页面 / 自定义组件） */
export type MeasureContext =
  | WechatMiniprogram.Page.TrivialInstance
  | WechatMiniprogram.Component.TrivialInstance;

/** 数字滚动默认时长（毫秒） */
export const COUNT_UP_DURATION = 420;

/** 数字滚动帧数：固定帧数而非固定步长，避免 setData 过密 */
export const COUNT_UP_FRAMES = 24;

/** 删除时整行收起的时长（毫秒），需与 app.wxss 中 .row-collapse 的 transition 一致 */
export const COLLAPSE_DURATION_MS = 280;

/**
 * easeOutCubic 缓动：起步快、收尾稳
 * @param t 归一化进度（0~1，越界会被夹紧）
 * @returns 缓动后的进度
 */
export function easeOutCubic(t: number): number {
  const p = t < 0 ? 0 : t > 1 ? 1 : t;
  const inv = 1 - p;
  return 1 - inv * inv * inv;
}

/**
 * 取某一进度下的中间值（四舍五入到整数：金额单位为分，不适合出现小数）
 * @param from 起始值
 * @param to 目标值
 * @param progress 进度 0~1
 * @returns 中间值
 */
export function tweenValue(from: number, to: number, progress: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return to;
  return Math.round(from + (to - from) * easeOutCubic(progress));
}

/**
 * 播放数字滚动动画
 *
 * 返回取消函数：页面卸载或下一次刷新前必须调用，否则旧动画会继续 setData 覆盖新值。
 *
 * @param from 起始值
 * @param to 目标值
 * @param onFrame 每帧回调（收到当前中间值）
 * @param duration 时长（毫秒）
 * @returns 取消函数
 */
export function countUp(
  from: number,
  to: number,
  onFrame: (value: number) => void,
  duration: number = COUNT_UP_DURATION
): () => void {
  // 首屏（无旧值）或值未变化时直接落位，不做无意义的滚动
  if (from === to || !Number.isFinite(from) || !Number.isFinite(to) || duration <= 0) {
    onFrame(to);
    return () => {};
  }

  const start = Date.now();
  const interval = duration / COUNT_UP_FRAMES;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  let frame = 0;

  const step = () => {
    timer = null;
    if (cancelled) return;
    frame += 1;
    // 到帧数上限时强制落位，避免计时抖动导致最后几帧丢失
    const progress = frame >= COUNT_UP_FRAMES ? 1 : (Date.now() - start) / duration;
    onFrame(tweenValue(from, to, progress));
    if (progress < 1) timer = setTimeout(step, interval);
  };

  timer = setTimeout(step, interval);

  return () => {
    cancelled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/**
 * 批量测量节点高度（顺序与 DOM 顺序一致）
 *
 * 用途：批量删除时一次把所有待收起行的高度都量出来，避免 N 次查询往返。
 *
 * @param ctx 页面 / 自定义组件实例（this）
 * @param selector 选择器（如 '.row-picked' / '#cell-abc'）
 * @param cb 回调，参数为各节点高度（px），顺序与 DOM 顺序一致
 */
export function measureHeights(
  ctx: MeasureContext,
  selector: string,
  cb: (heights: number[]) => void
): void {
  wx.createSelectorQuery()
    .in(ctx)
    .selectAll(selector)
    .boundingClientRect()
    .exec((res) => {
      const rects = res && res[0] ? (res[0] as Array<{ height?: number }>) : null;
      if (!Array.isArray(rects)) {
        cb([]);
        return;
      }
      cb(rects.map((r) => (r && typeof r.height === 'number' ? r.height : 0)));
    });
}

/** 结余滚动器：管理"从上次展示值滚到新值"的状态与取消 */
export interface BalanceRoller {
  /** 滚到目标值（首屏 / 值未变时直接落位） */
  roll(target: number): void;
  /** 取消进行中的滚动（页面卸载前必须调用，否则旧动画会继续 setData 覆盖新值） */
  cancel(): void;
}

/**
 * 创建一个结余数字滚动器
 *
 * 首页与记账列表的结余数字共用同一套滚动口径：
 * 从上次展示的值滚到新值；首屏或值未变时直接落位，不做无意义的滚动。
 * apply 只管渲染（页面负责 setData 与金额格式化），状态与取消逻辑都收在这里。
 *
 * @param apply 每帧回调（收到当前中间值，单位分）
 * @returns BalanceRoller
 */
export function createBalanceRoller(apply: (value: number) => void): BalanceRoller {
  let cancel: (() => void) | null = null;
  /** 当前已展示的值（分）；null = 首屏，直接落位 */
  let shown: number | null = null;

  return {
    roll(target: number) {
      cancel?.();
      cancel = null;

      if (shown === null || shown === target) {
        shown = target;
        apply(target);
        return;
      }

      const from = shown;
      shown = target;
      cancel = countUp(from, target, apply);
    },
    cancel() {
      cancel?.();
      cancel = null;
    },
  };
}
