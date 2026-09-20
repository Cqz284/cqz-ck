/**
 * 环形图（饼图）纯计算：分片聚合、角度换算、命中判定
 *
 * 设计取舍：不引第三方图表库。小程序的 canvas 2d 原生够用，
 * 而图表库（ECharts 等）体积在 300KB+，为了一个环形图不值当。
 * 这里只放**纯函数**，画布绘制在页面里，便于单测。
 */

/** 分类配色（8 色，明暗两种主题下都有足够对比度） */
export const PIE_COLORS: readonly string[] = [
  '#34be8c',
  '#f0a24a',
  '#5b8def',
  '#ee6c5c',
  '#a374d5',
  '#3fbfc6',
  '#e07ba8',
  '#94a15e',
];

/** 「其他」分片的固定配色（灰调，表示聚合项） */
export const OTHER_COLOR = '#9a948d';

/** 默认最多单独展示的分类数，超出的合并为「其他」 */
export const DEFAULT_MAX_SLICES = 6;

/** 起始角度：12 点方向（canvas 的 0 弧度在 3 点方向，故 -90°） */
const START_ANGLE = -Math.PI / 2;

/** 待聚合的原始项 */
export interface PieInput {
  /** 分类名 */
  label: string;
  /** 数值（分为单位，保证整数聚合无误差） */
  value: number;
}

/** 计算后的分片 */
export interface PieSlice {
  /** 分类名 */
  label: string;
  /** 数值（分） */
  value: number;
  /** 占比 0~1 */
  ratio: number;
  /** 起始弧度 */
  startAngle: number;
  /** 结束弧度 */
  endAngle: number;
  /** 配色 */
  color: string;
  /** 是否聚合出来的「其他」 */
  isOther: boolean;
}

/**
 * 把分类金额聚合成环形图分片
 *
 * 规则：过滤非正值 → 按金额倒序 → 超过 max 的尾部合并为「其他」→ 计算占比与弧度。
 * 这样保证大块在前、扇区不均但面积绝对正确（占比按金额而非数量算）。
 *
 * @param items 分类金额（单位：分）
 * @param max 最多单独展示的分类数
 * @param otherLabel 「其他」的文案
 * @returns 分片数组；无有效数据时返回空数组
 */
export function buildPieSlices(
  items: readonly PieInput[],
  max: number = DEFAULT_MAX_SLICES,
  otherLabel = '其他'
): PieSlice[] {
  const valid = items.filter((it) => Number.isFinite(it.value) && it.value > 0);
  const total = valid.reduce((sum, it) => sum + it.value, 0);
  if (!valid.length || total <= 0) return [];

  const sorted = valid.slice().sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, Math.max(1, max));
  const tail = sorted.slice(Math.max(1, max));

  const merged: PieInput[] = head.map((it) => ({ label: it.label, value: it.value }));
  if (tail.length) {
    merged.push({
      label: otherLabel,
      value: tail.reduce((sum, it) => sum + it.value, 0),
    });
  }

  let angle = START_ANGLE;
  return merged.map((it, i) => {
    const ratio = it.value / total;
    const startAngle = angle;
    const endAngle = startAngle + ratio * Math.PI * 2;
    angle = endAngle;
    const isOther = it.label === otherLabel && tail.length > 0;
    return {
      label: it.label,
      value: it.value,
      ratio,
      startAngle,
      endAngle,
      color: isOther ? OTHER_COLOR : PIE_COLORS[i % PIE_COLORS.length],
      isOther,
    };
  });
}

/**
 * 迷你占比条的段（首页 / 记账页 summary 卡里那条"支出构成"）
 *
 * 与环形图同源：复用 buildPieSlices，因此两处的分类归属与占比永远一致。
 */
export interface MixSegment {
  /** 分类名 */
  label: string;
  /** 占比（0~100，保留一位小数） */
  percent: number;
  /** 占比文案，如 "42.0%" */
  percentText: string;
  /** 配色（与环形图同一套） */
  color: string;
}

/**
 * 生成占比条数据
 * @param items 分类金额（单位：分）
 * @param max 最多展示的分类数，超出合并为「其他」
 * @param otherLabel 「其他」的文案
 * @returns 占比段数组；无有效数据时返回空数组
 */
export function buildMixSegments(
  items: readonly PieInput[],
  max = 4,
  otherLabel = '其他'
): MixSegment[] {
  return buildPieSlices(items, max, otherLabel).map((s) => {
    const percent = Math.round(s.ratio * 1000) / 10;
    return {
      label: s.label,
      percent,
      percentText: percent.toFixed(1) + '%',
      color: s.color,
    };
  });
}

/**
 * 归一化到 [0, 2π)
 * @param angle 弧度
 * @returns 归一化弧度
 */
export function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const a = angle % twoPi;
  return a < 0 ? a + twoPi : a;
}

/* ================= 折线图（每日趋势） ================= */

/** 折线上的一个点（画布逻辑像素坐标） */
export interface LinePoint {
  x: number;
  y: number;
}

/**
 * 把数值序列映射为折线坐标
 *
 * x 等距铺满（去掉左右留白）；y 按"最大值 = 图表顶部"线性压缩，
 * 全 0 序列时以 1 为基准，画一条贴底的平线而不是除零。
 *
 * @param values 数值序列（非负，单位：分）
 * @param width 画布宽
 * @param height 画布高
 * @param padX 左右留白
 * @param padTop 顶部留白
 * @param padBottom 底部留白（基线位置）
 * @returns 与 values 等长的坐标数组；values 为空返回空数组
 */
export function linePoints(
  values: readonly number[],
  width: number,
  height: number,
  padX: number,
  padTop: number,
  padBottom: number
): LinePoint[] {
  if (!values.length || width <= 0 || height <= 0) return [];
  const max = Math.max(...values, 1);
  const innerH = height - padTop - padBottom;
  const step = values.length > 1 ? (width - padX * 2) / (values.length - 1) : 0;
  return values.map((v, i) => ({
    x: padX + i * step,
    y: padTop + (1 - Math.max(0, v) / max) * innerH,
  }));
}

/**
 * 找 x 坐标最近的折线点下标（点折线跳转某天用）
 * @param points 折线坐标
 * @param x 触点 x
 * @returns 最近的下标；points 为空返回 -1
 */
export function nearestLineIndex(points: readonly LinePoint[], x: number): number {
  if (!points.length) return -1;
  let best = 0;
  let bestDist = Math.abs(points[0].x - x);
  for (let i = 1; i < points.length; i++) {
    const d = Math.abs(points[i].x - x);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

/**
 * #RRGGBB → rgba(...)：给折线下方的渐变面积做透明度
 * @param hex 十六进制颜色
 * @param alpha 0~1
 * @returns rgba 字符串；非法入参返回原值
 */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 判断触点落在哪个扇区（用于点扇形高亮）
 *
 * 判定条件：半径落在内外半径之间，且角度落在该扇区区间内。
 *
 * @param slices 分片（含 startAngle / endAngle）
 * @param x 触点 x（相对画布）
 * @param y 触点 y（相对画布）
 * @param cx 圆心 x
 * @param cy 圆心 y
 * @param innerRadius 内半径
 * @param outerRadius 外半径
 * @returns 命中分片下标；未命中返回 -1
 */
export function hitTestSlice(
  slices: readonly PieSlice[],
  x: number,
  y: number,
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number
): number {
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // 外圈给一点容差，避免边缘点不准
  if (dist < innerRadius || dist > outerRadius + 4) return -1;

  const angle = normalizeAngle(Math.atan2(dy, dx));
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const from = normalizeAngle(s.startAngle);
    const to = normalizeAngle(s.endAngle);
    if (from <= to) {
      if (angle >= from && angle <= to) return i;
    } else {
      // 跨 0 点（从 12 点方向起画，最后一个扇区会跨）
      if (angle >= from || angle <= to) return i;
    }
  }
  return -1;
}
