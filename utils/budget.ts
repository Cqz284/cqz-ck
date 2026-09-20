/**
 * 额度（预算）与进度条计算
 *
 * 口径（用户确认）：月预算与每日额度**各自独立**，互不换算，也可以只设置其中一个。
 * 这里只放纯函数，便于单测；展示与提醒由页面编排。
 *
 * 提醒口径：达到 100% 记为 over（弹提醒），80% 记为 warn（只把进度条转暖色，不打扰）。
 */
import { LedgerType } from '../types/models';
import type { LedgerRecord } from '../types/models';
import { today } from './date';
import { formatMoney } from './money';

/** 预警阈值：达到 80% 转暖色 */
export const WARN_RATIO = 0.8;

/** 进度档位 */
export type ProgressLevel = 'normal' | 'warn' | 'over';

/**
 * 进度条视图数据
 * 字段与 components/business/progress-bar 的属性一一对应，
 * 页面只要把对象展开传给组件，两侧的文案与条长就永远同源。
 */
export interface ProgressView {
  /** 左侧标题 */
  label: string;
  /** 右侧数值文案 */
  value: string;
  /** 进度百分比（0~100，已夹取） */
  percent: number;
  /** 颜色档位 */
  level: ProgressLevel;
  /** 次要说明，可为空串 */
  hint: string;
  /** 是否启用（未设置额度 / 没有待办时为 false，模板据此隐藏整块） */
  enabled: boolean;
}

/** 额度进度 */
export interface BudgetProgress {
  /** 是否设置了额度 */
  enabled: boolean;
  /** 已用（分） */
  used: number;
  /** 额度（分） */
  limit: number;
  /** 已用占比（可能大于 1） */
  ratio: number;
  /** 画条用的百分比（0~100，已夹取） */
  barPercent: number;
  /** 展示百分比，如 42% / 128% */
  percentText: string;
  /** 剩余（分，可为负） */
  remain: number;
  /** 档位 */
  level: ProgressLevel;
}

/**
 * 按占比判定档位
 * @param ratio 已用占比（可大于 1）
 * @returns ProgressLevel
 */
export function ratioLevel(ratio: number): ProgressLevel {
  if (!Number.isFinite(ratio) || ratio < 0) return 'normal';
  if (ratio >= 1) return 'over';
  if (ratio >= WARN_RATIO) return 'warn';
  return 'normal';
}

/**
 * 计算额度进度
 * @param used 已用（分）
 * @param limit 额度（分）；<= 0 视为未设置
 * @returns BudgetProgress
 */
export function budgetProgress(used: number, limit: number): BudgetProgress {
  const u = Number.isFinite(used) ? Math.max(0, Math.round(used)) : 0;
  const l = Number.isFinite(limit) ? Math.max(0, Math.round(limit)) : 0;

  if (l <= 0) {
    return {
      enabled: false,
      used: u,
      limit: 0,
      ratio: 0,
      barPercent: 0,
      percentText: '',
      remain: 0,
      level: 'normal',
    };
  }

  const ratio = u / l;
  return {
    enabled: true,
    used: u,
    limit: l,
    ratio,
    barPercent: Math.min(100, Math.max(0, Math.round(ratio * 100))),
    percentText: Math.round(ratio * 100) + '%',
    remain: l - u,
    level: ratioLevel(ratio),
  };
}

/**
 * 待办完成度 → 进度条视图
 * @param done 已完成条数
 * @param total 待办总数
 * @returns ProgressView（total 为 0 时 enabled = false）
 */
export function todoProgressView(done: number, total: number): ProgressView {
  const t = Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0;
  const d = Number.isFinite(done) ? Math.min(Math.max(0, Math.round(done)), t) : 0;

  return {
    enabled: t > 0,
    label: '待办完成度',
    value: t > 0 ? `${d} / ${t}` : '',
    percent: t > 0 ? Math.round((d / t) * 100) : 0,
    level: 'normal',
    hint: t > 0 ? (d === t ? '全部完成' : `还剩 ${t - d} 条未完成`) : '',
  };
}

/**
 * 某月天数
 * @param month 月份 YYYY-MM
 * @returns 天数（入参非法时按 30 天兜底）
 */
export function daysInMonth(month: string): number {
  const parts = month.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return 30;
  // 下个月的第 0 天 = 本月最后一天
  return new Date(y, m, 0).getDate();
}

/**
 * 某日期所在月份还剩多少天（含当天）
 * @param date 日期 YYYY-MM-DD
 * @returns 天数，至少为 1
 */
export function daysLeftInMonth(date: string): number {
  const total = daysInMonth(date.slice(0, 7));
  const d = Number(date.slice(8, 10));
  if (!Number.isFinite(d) || d < 1) return total;
  return Math.max(1, total - d + 1);
}

/**
 * 按条件汇总支出（分）
 * @param records 记账记录
 * @param match 匹配条件
 * @returns 合计（分）
 */
export function sumExpense(records: readonly LedgerRecord[], match: (r: LedgerRecord) => boolean): number {
  return records.reduce(
    (acc, r) => (r.type === LedgerType.Expense && match(r) ? acc + r.amount : acc),
    0
  );
}

/**
 * 某天的支出合计（分）
 * @param records 记账记录
 * @param date 日期 YYYY-MM-DD
 * @returns 合计（分）
 */
export function dayExpense(records: readonly LedgerRecord[], date: string): number {
  return sumExpense(records, (r) => r.date === date);
}

/**
 * 某月的支出合计（分）
 * @param records 记账记录
 * @param month 月份 YYYY-MM
 * @returns 合计（分）
 */
export function monthExpense(records: readonly LedgerRecord[], month: string): number {
  return sumExpense(records, (r) => r.date.slice(0, 7) === month);
}

/** 额度提醒的输入 */
export interface BudgetAlertInput {
  /** 今日已用（分） */
  dailyUsed: number;
  /** 每日额度（分）；0 表示未设置 */
  dailyLimit: number;
  /** 本月已用（分） */
  monthUsed: number;
  /** 月度预算（分）；0 表示未设置 */
  monthLimit: number;
  /** 货币符号 */
  currency: string;
}

/**
 * 组装超额提醒文案
 *
 * 只有**真正超出**（>= 100%）才提示——80% 那档只把进度条转成暖色，
 * 否则每天要弹好几条提示，反而让人把提醒当噪音。
 *
 * @param input 额度与已用情况
 * @returns 文案；没有超额时返回空串
 */
export function budgetAlertText(input: BudgetAlertInput): string {
  const parts: string[] = [];
  const daily = budgetProgress(input.dailyUsed, input.dailyLimit);
  const month = budgetProgress(input.monthUsed, input.monthLimit);

  if (daily.enabled && daily.level === 'over') {
    parts.push(`今日已超额度 ${formatMoney(-daily.remain, input.currency)}`);
  }
  if (month.enabled && month.level === 'over') {
    parts.push(`本月已超预算 ${formatMoney(-month.remain, input.currency)}`);
  }
  return parts.join('，');
}

/**
 * 今天是否还没提醒过
 * @param lastNoticedDate 上次提醒的日期（可能为空串）
 * @param today 今天 YYYY-MM-DD
 * @returns 未提醒过则为 true
 */
export function shouldNoticeToday(lastNoticedDate: string, today: string): boolean {
  return !!today && lastNoticedDate !== today;
}

/** 首页汇总卡的额度进度视图 */
export interface BudgetViews {
  /** 是否设置过任一额度（都没设置时页面显示"去设置"入口） */
  hasBudget: boolean;
  /** 本月预算进度条 */
  monthBar: ProgressView;
  /** 每日额度进度条 */
  dayBar: ProgressView;
}

/** 页面/设置里与额度计算相关的最小字段 */
export interface BudgetSettingsLike {
  /** 货币符号 */
  currency: string;
  /** 月度预算（分）；0 表示未设置 */
  monthlyBudget: number;
  /** 每日额度（分）；0 表示未设置 */
  dailyBudget: number;
}

/**
 * 组装首页汇总卡的额度进度条视图
 *
 * 月预算与每日额度各自独立（见文件头口径）：两个都按"已用 / 额度"渲染，
 * 谁没设置谁就 enabled = false，不出现在页面上。
 *
 * @param records 记账记录
 * @param settings 货币与两项额度
 * @param todayStr 今天 YYYY-MM-DD（默认取当前日期，测试可注入）
 * @returns BudgetViews
 */
export function budgetViews(
  records: readonly LedgerRecord[],
  settings: BudgetSettingsLike,
  todayStr: string = today()
): BudgetViews {
  const cur = settings.currency;
  const monthUsed = monthExpense(records, todayStr.slice(0, 7));
  const dayUsed = dayExpense(records, todayStr);
  const month = budgetProgress(monthUsed, settings.monthlyBudget);
  const day = budgetProgress(dayUsed, settings.dailyBudget);

  /** 剩余/超出的说明文案 */
  const remainHint = (remain: number, tail: string) =>
    remain >= 0
      ? `剩余 ${formatMoney(remain, cur)}${tail}`
      : `已超出 ${formatMoney(-remain, cur)}`;

  return {
    hasBudget: month.enabled || day.enabled,
    monthBar: {
      enabled: month.enabled,
      label: '本月预算',
      value: month.enabled
        ? `${formatMoney(monthUsed, cur)} / ${formatMoney(settings.monthlyBudget, cur)}`
        : '',
      percent: month.barPercent,
      level: month.level,
      hint: month.enabled ? remainHint(month.remain, ` · 本月还剩 ${daysLeftInMonth(todayStr)} 天`) : '',
    },
    dayBar: {
      enabled: day.enabled,
      label: '每日额度',
      value: day.enabled
        ? `${formatMoney(dayUsed, cur)} / ${formatMoney(settings.dailyBudget, cur)}`
        : '',
      percent: day.barPercent,
      level: day.level,
      hint: day.enabled ? remainHint(day.remain, '') : '',
    },
  };
}
