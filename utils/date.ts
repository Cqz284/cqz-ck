/**
 * 日期工具（基于 dayjs）
 */
import dayjs from 'dayjs';

/** 默认日期格式 */
const DATE_PATTERN = 'YYYY-MM-DD';
/** 月份格式 */
const MONTH_PATTERN = 'YYYY-MM';
/** 一天的毫秒数 */
const DAY_MS = 86400000;

/**
 * 当前时间戳（毫秒）
 * @returns number
 */
export function now(): number {
  return Date.now();
}

/**
 * 格式化日期
 * @param d 日期（时间戳 / Date / 日期字符串）
 * @param pattern 格式，默认 YYYY-MM-DD
 * @returns 格式化后的字符串
 */
export function format(d: number | string | Date, pattern: string = DATE_PATTERN): string {
  return dayjs(d).format(pattern);
}

/**
 * 今天日期字符串 YYYY-MM-DD
 * @returns string
 */
export function today(): string {
  return dayjs().format(DATE_PATTERN);
}

/**
 * 当前时间字符串 HH:mm
 * @returns string
 */
export function nowTime(): string {
  return dayjs().format('HH:mm');
}

/**
 * 取某日期所属月份 YYYY-MM
 * @param d 日期，默认当前时间
 * @returns string
 */
export function monthOf(d: number | string | Date = Date.now()): string {
  return dayjs(d).format(MONTH_PATTERN);
}

/**
 * 月份偏移（用于统计页的「上一月 / 下一月」）
 *
 * 统一按当月 1 号加减，避免使用「当月 31 号」时出现跨月错位。
 *
 * @param month 基准月份 YYYY-MM
 * @param delta 偏移量，负数为往前
 * @returns 偏移后的月份 YYYY-MM
 */
export function shiftMonth(month: string, delta: number): string {
  const p = month.split('-');
  const year = Number(p[0]);
  const mon = Number(p[1]);
  if (!Number.isFinite(year) || !Number.isFinite(mon)) return month;
  // Date 的月份从 0 开始，用 1 号做基准最稳
  const d = new Date(year, mon - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 月份展示文案
 * @param month 月份 YYYY-MM
 * @returns 形如「2026年9月」
 */
export function monthLabel(month: string): string {
  const p = month.split('-');
  return `${p[0]}年${Number(p[1])}月`;
}

/**
 * 日期偏移（天）
 *
 * 与 shiftMonth 同一套做法：按本地时间构造再自己格式化，
 * 既规避 iOS 对 `new Date('2026-09-15')` 的解析差异，也顺手处理跨月/跨年。
 *
 * @param date 基准日期 YYYY-MM-DD
 * @param delta 偏移天数，负数为往前
 * @returns 偏移后的日期 YYYY-MM-DD
 */
export function shiftDate(date: string, delta: number): string {
  const p = date.split('-');
  const y = Number(p[0]);
  const m = Number(p[1]);
  const d = Number(p[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return date;
  return format(new Date(y, m - 1, d + delta), DATE_PATTERN);
}

/**
 * 日期展示文案
 * @param date 日期 YYYY-MM-DD
 * @returns 形如「2026年9月15日」
 */
export function dateLabel(date: string): string {
  const p = date.split('-');
  if (p.length < 3) return date;
  return `${p[0]}年${Number(p[1])}月${Number(p[2])}日`;
}

/**
 * 星期文案
 * @param date 日期 YYYY-MM-DD
 * @returns 形如「周二」；日期非法时返回空串
 */
export function weekdayLabel(date: string): string {
  const p = date.split('-');
  const y = Number(p[0]);
  const m = Number(p[1]);
  const d = Number(p[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  return '周' + '日一二三四五六'[new Date(y, m - 1, d).getDay()];
}

/**
 * 把 YYYY-MM-DD 转成 UTC 时间戳（规避 iOS 对 `new Date('2026-09-01')` 的解析差异）
 * @param date 日期字符串
 * @returns 毫秒时间戳
 */
export function toUtcTs(date: string): number {
  const p = date.split('-');
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

/**
 * 两个 YYYY-MM-DD 之间相差的自然日天数（to - from）
 * @param from 起始日期 YYYY-MM-DD
 * @param to 结束日期 YYYY-MM-DD
 * @returns 天数差，可为负
 */
export function dayDiff(from: string, to: string): number {
  return Math.round((toUtcTs(to) - toUtcTs(from)) / DAY_MS);
}

/**
 * 相对时间描述（如：刚刚 / 5分钟前 / 昨天 14:30 / 9月17日 09:00）
 *
 * 口径（用户确认）：
 * - **同一天**内用相对时长：刚刚 / N分钟前 / N小时前（"刚发生"的感觉最好）
 * - **昨天**：`昨天 14:30`
 * - **更早**：`9月17日 14:30`（跨年带年份）——几月几号与时间都给出来；
 *   不再有「前天」档位，相对说法只保留今天与昨天，避免三种口径混在一列里。
 *
 * 判断按**自然日**而不是经过小时数：否则今天 00:30 看 26 小时前会被说成"昨天"（实为前天）。
 *
 * @param ts 时间戳（毫秒）
 * @returns string
 */
export function fromNow(ts: number): string {
  const date = format(ts, DATE_PATTERN);
  const todayStr = today();
  const clock = format(ts, 'HH:mm');
  const days = dayDiff(date, todayStr);

  if (days === 0) {
    const diff = Date.now() - ts;
    const minute = 60 * 1000;
    if (diff < minute) return '刚刚';
    if (diff < 60 * minute) return `${Math.floor(diff / minute)}分钟前`;
    return `${Math.floor(diff / (60 * minute))}小时前`;
  }
  if (days === 1) return `昨天 ${clock}`;

  const p = date.split('-');
  const dateText =
    p[0] === todayStr.slice(0, 4)
      ? `${Number(p[1])}月${Number(p[2])}日`
      : `${p[0]}年${Number(p[1])}月${Number(p[2])}日`;
  return `${dateText} ${clock}`;
}
