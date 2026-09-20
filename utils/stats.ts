/**
 * 统计聚合（纯函数）：把记账记录按分类汇总，供环形图与图例使用
 *
 * 金额单位一律为「分」：整数聚合不会出现浮点误差，
 * 展示层再用 formatMoney 转成元。
 */
import { LedgerType } from '../types/models';
import type { LedgerRecord } from '../types/models';

/** 分类汇总项 */
export interface CategorySum {
  /** 分类名（空标签归入 fallbackLabel） */
  label: string;
  /** 金额（分） */
  value: number;
  /** 笔数 */
  count: number;
}

/**
 * 取一条记录的分类名
 *
 * `sumByCategory` 与「点开分类看明细」必须用**同一套归类口径**，
 * 否则明细里的笔数会与图例上的笔数对不上。所以抽成一个函数，两处都调它。
 *
 * @param r 记录
 * @param fallbackLabel 没有标签时的归类名
 * @returns 分类名
 */
export function labelOf(r: LedgerRecord, fallbackLabel = '未分类'): string {
  return (r.tag || '').trim() || fallbackLabel;
}

/**
 * 按分类汇总某一收支类型的金额
 *
 * @param records 记录集合
 * @param type 收支类型
 * @param fallbackLabel 没有标签时的归类名
 * @returns 汇总数组（含 0 值分类会被过滤，排序交给调用方）
 */
export function sumByCategory(
  records: readonly LedgerRecord[],
  type: LedgerType,
  fallbackLabel = '未分类'
): CategorySum[] {
  const map = new Map<string, CategorySum>();
  records.forEach((r) => {
    if (r.type !== type) return;
    if (!Number.isFinite(r.amount) || r.amount <= 0) return;
    const label = labelOf(r, fallbackLabel);
    const hit = map.get(label);
    if (hit) {
      hit.value += r.amount;
      hit.count += 1;
    } else {
      map.set(label, { label, value: r.amount, count: 1 });
    }
  });
  return Array.from(map.values()).sort((a, b) => b.value - a.value);
}

/**
 * 按分类名筛选记录（供"点开某个分类看明细"用）
 *
 * 过滤口径与 `sumByCategory` 完全一致：只留该收支类型、金额为正的记录，
 * 分类名也走 `labelOf`。顺序交给调用方（明细按日期 + 时间倒序）。
 *
 * @param records 记录集合（调用方已按时间范围过滤过）
 * @param type 收支类型
 * @param labels 分类名集合
 * @param options.exclude 为 true 时改为"排除这些分类"——「其他」那一块的成员要用排除法取
 * @param options.fallbackLabel 无标签时的归类名
 * @returns 新数组（不修改入参）
 */
export function pickByLabels(
  records: readonly LedgerRecord[],
  type: LedgerType,
  labels: readonly string[],
  options: { exclude?: boolean; fallbackLabel?: string } = {}
): LedgerRecord[] {
  const keep = new Set(labels);
  const exclude = options.exclude === true;
  return records.filter((r) => {
    if (r.type !== type) return false;
    if (!Number.isFinite(r.amount) || r.amount <= 0) return false;
    const hit = keep.has(labelOf(r, options.fallbackLabel));
    return exclude ? !hit : hit;
  });
}

/** 每日趋势序列的一个点 */
export interface DailyPoint {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 几号（1 起，用于画 x 轴刻度） */
  day: number;
  /** 当日金额（分）；无记录为 0 */
  value: number;
}

/**
 * 把某个月的记录聚合成"每天一格"的固定长度序列
 *
 * 序列**必须补齐整月**（无记录的日期补 0）：折线图的 x 轴要按日等距，
 * 跳过 0 值日期会让"哪天没花"这个信息直接消失。
 *
 * @param records 记录集合（可以不预过滤，函数内部按月 + 类型筛选）
 * @param month 月份 YYYY-MM
 * @param type 收支类型
 * @returns 长度 = 当月天数的数组，按日期升序
 */
export function buildDailySeries(
  records: readonly LedgerRecord[],
  month: string,
  type: LedgerType
): DailyPoint[] {
  const parts = month.split('-');
  const year = Number(parts[0]);
  const mon = Number(parts[1]);
  if (!Number.isInteger(year) || !Number.isInteger(mon) || mon < 1 || mon > 12) return [];
  // 当月天数：取下个月第 0 天
  const days = new Date(year, mon, 0).getDate();

  const byDate = new Map<string, number>();
  records.forEach((r) => {
    if (r.type !== type) return;
    if (r.date.slice(0, 7) !== month) return;
    if (!Number.isFinite(r.amount) || r.amount <= 0) return;
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.amount);
  });

  const out: DailyPoint[] = [];
  for (let d = 1; d <= days; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    out.push({ date, day: d, value: byDate.get(date) ?? 0 });
  }
  return out;
}

/** 两段时期的对比结果（金额单位：分） */
export interface PeriodCompare {
  /** 当期合计 */
  current: number;
  /** 上期合计 */
  previous: number;
  /** 差额（正 = 当期更多） */
  diff: number;
  /**
   * 变化比例（diff / previous）；上期为 0 时为 null——
   * 从 0 到 100 的"涨幅"是无穷大，展示端应改用"上期无数据"文案而不是算比例
   */
  ratio: number | null;
}

/**
 * 对比两段时期的合计
 * @param current 当期合计（分）
 * @param previous 上期合计（分）
 */
export function comparePeriods(current: number, previous: number): PeriodCompare {
  const diff = current - previous;
  return {
    current,
    previous,
    diff,
    ratio: previous > 0 ? diff / previous : null,
  };
}

/**
 * 月份 X 轴刻度标签：把整月等分成 5 个刻度位
 *
 * 供趋势图下方的刻度行使用——用户要能把折线上的点与"具体某天"对上号。
 * 首尾必是 1 日与月末；中间三个位置四舍五入取整，可能与端点重合时去重。
 *
 * @param daysInMonth 当月天数（28–31）
 * @returns 形如 ['1日', '8日', '15日', '23日', '30日']
 */
export function monthTickLabels(daysInMonth: number): string[] {
  if (!Number.isFinite(daysInMonth) || daysInMonth < 1) return [];
  if (daysInMonth <= 5) {
    return Array.from({ length: daysInMonth }, (_, i) => `${i + 1}日`);
  }
  const idx = [0, 1, 2, 3, 4].map((k) => Math.floor((k * (daysInMonth - 1)) / 4));
  return idx
    .filter((v, i) => i === 0 || v !== idx[i - 1])
    .map((i) => `${i + 1}日`);
}
