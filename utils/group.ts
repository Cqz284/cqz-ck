/**
 * 记账列表的日期分组工具
 */
import { LedgerType } from '../types/models';
import type { LedgerRecord } from '../types/models';
import { dayDiff, format, today } from './date';
import { formatMoney } from './money';

/** 一天的分组 */
export interface LedgerDayGroup {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 展示标签：今天 9月19日 / 昨天 9月18日 / 9月14日 / 2025年12月31日 */
  label: string;
  /** 当日收入（分） */
  income: number;
  /** 当日支出（分） */
  expense: number;
  /** 当日记录 */
  items: LedgerRecord[];
}

/**
 * 日期展示标签
 *
 * 口径（用户确认）：相对说法只保留「今天 / 昨天」，且**始终带上月日**；
 * 「前天」不再出现，更早的日期直接用月日（跨年才带年份）。
 * 三种口径混在一列里最容易看错，所以宁可让日期始终可见。
 *
 * @param date 日期 YYYY-MM-DD
 * @param todayStr 今天 YYYY-MM-DD
 * @returns 标签文本
 */
export function dayLabel(date: string, todayStr: string = today()): string {
  const p = date.split('-');
  const year = p[0];
  const month = Number(p[1]);
  const day = Number(p[2]);
  const dateText = year === todayStr.slice(0, 4) ? `${month}月${day}日` : `${year}年${month}月${day}日`;

  const diff = dayDiff(date, todayStr);
  if (diff === 0) return `今天 ${dateText}`;
  if (diff === 1) return `昨天 ${dateText}`;
  return dateText;
}

/** 合法 HH:mm */
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * 取记录的展示/排序时间 HH:mm
 *
 * 旧数据（升级前创建）没有 time 字段，回退到 createTime 推导，
 * 保证排序与展示对存量数据依然成立。
 *
 * @param r 记账记录
 * @returns HH:mm
 */
export function recordTime(r: LedgerRecord): string {
  return r.time && TIME_RE.test(r.time) ? r.time : format(r.createTime, 'HH:mm');
}

/**
 * 按日期 + 时间倒序比较（同日内时间晚的在前；时间相同按 createTime 新的在前）
 * @param a 记录
 * @param b 记录
 * @returns 比较结果（a 在前为正）
 */
export function compareByDateTimeDesc(a: LedgerRecord, b: LedgerRecord): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ta = recordTime(a);
  const tb = recordTime(b);
  if (ta !== tb) return ta < tb ? 1 : -1;
  return b.createTime - a.createTime;
}

/**
 * 按日期分组并统计当日收支，日期倒序
 * @param records 记账记录
 * @param todayStr 今天 YYYY-MM-DD
 * @returns 分组数组
 */
export function groupByDate(records: LedgerRecord[], todayStr: string = today()): LedgerDayGroup[] {
  const map = new Map<string, LedgerDayGroup>();
  records.forEach((r) => {
    let g = map.get(r.date);
    if (!g) {
      g = { date: r.date, label: dayLabel(r.date, todayStr), income: 0, expense: 0, items: [] };
      map.set(r.date, g);
    }
    g.items.push(r);
    if (r.type === LedgerType.Income) g.income += r.amount;
    else g.expense += r.amount;
  });
  // 组内按时间倒序：入参顺序不保证时依然正确（list 已排序时为稳定重排）
  Array.from(map.values()).forEach((g) => g.items.sort(compareByDateTimeDesc));
  return Array.from(map.values()).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * 生成当日小计文案
 *
 * 与 groupByDate 同源：分组视图上「支出 ¥124.00 · 收入 ¥10.00」那一行由这里出，
 * 页面不要再自己拼（旧实现复制在 ledger/list 里，两处口径会漂）。
 *
 * @param g 分组
 * @param currency 货币符号
 * @returns 形如「支出 ¥124.00 · 收入 ¥10.00」；当日没有金额时为空串
 */
export function daySummaryText(g: LedgerDayGroup, currency: string): string {
  const parts: string[] = [];
  if (g.expense > 0) parts.push('支出 ' + formatMoney(g.expense, currency));
  if (g.income > 0) parts.push('收入 ' + formatMoney(g.income, currency));
  return parts.join(' · ');
}
