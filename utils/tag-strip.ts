/**
 * 循环标签条的纯几何计算
 *
 * 渲染模型（页面层负责，这里只提供数学）：
 * - 轨道 = 标签环的 3 份拷贝首尾相接，环周长 C = Σ宽 + N×间距；
 * - "相位" p：轨道坐标系中当前对准容器中线的横坐标，translateX = 容器半宽 - p；
 * - 环序在拖拽中不变，p 对 C 取模即可无限循环，3 份拷贝保证取模前后画面无缝。
 *
 * 所有函数均为纯函数，无 wx 依赖，可直接单测。
 */

/** 单份环的布局：各标签中心相对本份起点的坐标 + 环周长 */
export interface StripLayout {
  /** centers[i] = 第 i 项中心相对本份拷贝起点的 x 坐标 */
  centers: number[]
  /** 环周长：宽度总和 + 每项一个间距（含末项与下一份拷贝之间的间距） */
  circumference: number
}

/**
 * 由各项宽度与固定间距构建单份环布局
 * @param widths 各项实测宽度（px，顺序即环序）
 * @param gap 相邻项间距（px）
 * @returns 布局；widths 为空时返回零周长布局
 */
export function buildLayout(widths: readonly number[], gap: number): StripLayout {
  const centers: number[] = [];
  let x = 0;
  for (const w of widths) {
    centers.push(x + w / 2);
    x += w + gap;
  }
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * widths.length;
  return { centers, circumference: total };
}

/**
 * 把任意相位折回安全区间 [C/2, 3C/2)。
 * 该区间内可见窗口（±容器半宽）始终落在 3 份拷贝的覆盖范围内，画面无缝。
 * @param p 任意相位
 * @param circumference 环周长
 * @returns 折回后的相位
 */
export function wrapPhase(p: number, circumference: number): number {
  const c = circumference;
  if (c <= 0) return p;
  const lo = c / 2;
  return ((((p - lo) % c) + c) % c) + lo;
}

/**
 * 把差值折到 (-C/2, C/2]，即环上两点间的最短有向距离
 * @param d 任意差值
 * @param circumference 环周长
 * @returns 最短差值
 */
export function wrapDelta(d: number, circumference: number): number {
  const c = circumference;
  if (c <= 0) return d;
  const half = c / 2;
  let r = ((d % c) + c) % c;
  if (r > half) r -= c;
  return r;
}

/**
 * 找到距离目标相位最近的一项（自动考虑跨拷贝取模）
 * @param centers 单份环内各项中心（buildLayout 产出）
 * @param baseOffset 中间份拷贝在轨道坐标系中的起点偏移（= C）
 * @param pos 目标相位（可为任意值，含惯性外推）
 * @param circumference 环周长
 * @returns index：项的环内下标；delta：从 pos 到该项中心的最近位移
 */
export function nearestCenter(
  centers: readonly number[],
  baseOffset: number,
  pos: number,
  circumference: number
): { index: number; delta: number } {
  let index = 0;
  let delta = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const d = wrapDelta(baseOffset + centers[i] - pos, circumference);
    if (Math.abs(d) < Math.abs(delta)) {
      index = i;
      delta = d;
    }
  }
  return { index, delta };
}

/**
 * 从当前相位到"第 target 项居中"的最近目标相位（用于点选居中）
 * @param current 当前相位
 * @param targetCenter 该项在中间份拷贝中的中心坐标（baseOffset + centers[target]）
 * @param circumference 环周长
 * @returns 目标相位（与 current 同量纲，已选最近方向）
 */
export function phaseToCenter(current: number, targetCenter: number, circumference: number): number {
  return current + wrapDelta(targetCenter - current, circumference);
}

/**
 * 环上旋转切片：把第 k 项转到开头（不可变，返回新数组）
 * @param arr 源数组
 * @param k 旋转量（可为任意整数，自动取模）
 * @returns 旋转后的新数组
 */
export function rotateToStart<T>(arr: readonly T[], k: number): T[] {
  const n = arr.length;
  if (n === 0) return [];
  const s = ((k % n) + n) % n;
  return [...arr.slice(s), ...arr.slice(0, s)];
}

/**
 * 规划一次相位动画的起止点
 *
 * 背景：轨道只渲染 3 份拷贝（覆盖 [0, 3C]），相位 p 一旦越界，可见窗口就会滑出
 * 渲染范围，屏幕上出现空白——快速连续同向滑动时最容易触发。
 *
 * 处理策略（顺序很重要）：
 * 1. **就近等价目标**：目标直接取用可能让位移接近一整圈，表现为"只挪一格却绕了快一整圈"；
 *    先换算成离当前相位最近的等价相位，位移即最短。
 * 2. **能不平移就不平移**：若起点与终点都已落在渲染安全区内，直接返回 `shift: false`，
 *    此时动画扫过的距离就是真实位移。
 * 3. **必须平移时**：把起点终点**作为一对整体平移**相同个数的环周长，使两者中点回到
 *    中间份拷贝（1.5C）。平移对环同余、位移不变，但调用方**必须先做一次无过渡的静默落位**
 *    再启动过渡——否则 CSS 会在旧位移与新位移之间线性插值，白扫一个环周长，
 *    观感上就是"异常滚回"。
 *
 * @param current 当前渲染相位（动画中途传入插值结果亦可）
 * @param target 目标相位（任意量纲）
 * @param circumference 环周长
 * @param safeMin 渲染安全区下界（通常为 容器宽 / 2），默认 0 表示只做就近换算
 * @returns from/to 为规划后的起止相位；shift 表示是否发生了整体平移
 */
export function planTween(
  current: number,
  target: number,
  circumference: number,
  safeMin = 0
): { from: number; to: number; shift: boolean } {
  const c = circumference;
  if (c <= 0) return { from: current, to: target, shift: false };

  const to = target + Math.round((current - target) / c) * c;

  const lo = Math.max(0, safeMin);
  const hi = 3 * c - lo;
  if (current >= lo && current <= hi && to >= lo && to <= hi) {
    return { from: current, to, shift: false };
  }

  const mid = (current + to) / 2;
  const k = Math.round((c * 1.5 - mid) / c);
  return { from: current + k * c, to: to + k * c, shift: true };
}

/**
 * 计算惯性外推的相位位移（已夹取上限）
 *
 * 为什么必须夹住：外推距离一旦接近半个环周长，"离外推点最近的项"在环上会翻到
 * 手指的**反方向**，表现为快速滑动时"甩出去又弹回来"。按"最多 N 项"与
 * "最多若干比例周长"双重夹取后，落点必然位于滑动方向上。
 *
 * 符号约定：velocity 取自 clientX（正 = 手指向右），相位 p 与之反向，
 * 因此返回值为 `-velocity × durationMs`（负 = 相位减小 = 轨道右移）。
 *
 * @param velocity 末速（px/ms，clientX 方向）
 * @param durationMs 外推时长（ms）
 * @param pitch 平均项距（px，含间距）
 * @param circumference 环周长（px）
 * @param maxItems 最多外推的项数
 * @param maxRatio 外推距离相对环周长的上限比例
 * @returns 相位位移（px，含符号）
 */
export function flingShift(
  velocity: number,
  durationMs: number,
  pitch: number,
  circumference: number,
  maxItems: number,
  maxRatio: number
): number {
  const limit = Math.min(pitch * maxItems, circumference * maxRatio);
  const raw = -velocity * durationMs;
  return Math.max(-limit, Math.min(limit, raw));
}
