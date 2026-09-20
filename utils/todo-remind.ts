/**
 * 待办到期提醒（纯计算，无 wx 依赖）
 *
 * 职责：
 * - 从待办里筛出「已逾期」「今天内到期」的未完成项（首页横幅的数据源）
 * - 生成待办行上的截止时间小标签文案
 *
 * 时间口径（与项目约定一致）：
 * - 「今天」按自然日判断，不按「过了 24 小时」判断
 * - 标签文案统一 `M月D日 HH:mm`（跨年带年份）；不用「明天/后天」这类相对说法
 */

import type { NoteItem } from '../types/models';
import { format } from './date';

/** 到期状态：已逾期 / 今天内到期 / 未来某天 */
export type DueState = 'overdue' | 'today' | 'future';

/** 首页横幅视图 */
export interface DueBannerView {
  /** 没有逾期与今日到期的待办时不出现 */
  enabled: boolean;
  /** 文案，如「1 条已逾期 · 2 条今天到期」 */
  text: string;
}

/** 行上截止标签视图 */
export interface DueTagView {
  /** 未设置截止时间、或已完成时不显示 */
  enabled: boolean;
  /** 文案，如「9月20日 18:00」 */
  text: string;
  /** 已逾期红色 / 今天到期暖色 / 未来中性 */
  state: DueState;
}

/**
 * 判断截止时间的到期状态（按自然日）
 * @param dueTime 截止时间戳（毫秒，> 0）
 * @param nowTs 当前时间戳（毫秒）
 */
export function dueState(dueTime: number, nowTs: number): DueState {
  const d = new Date(dueTime);
  const n = new Date(nowTs);
  const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayDay = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  if (dueTime < nowTs) return 'overdue';
  if (dueDay === todayDay) return 'today';
  return 'future';
}

/**
 * 截止时间的行上标签文案：统一 `M月D日 HH:mm`，跨年带年份
 * @param dueTime 截止时间戳（毫秒）
 * @returns string
 */
export function dueText(dueTime: number, nowTs: number): string {
  const clock = format(dueTime, 'HH:mm');
  const dateStr = format(dueTime, 'YYYY-MM-DD');
  const todayStr = format(nowTs, 'YYYY-MM-DD');
  const p = dateStr.split('-');
  const dateText =
    p[0] === todayStr.slice(0, 4)
      ? `${Number(p[1])}月${Number(p[2])}日`
      : `${p[0]}年${Number(p[1])}月${Number(p[2])}日`;
  return `${dateText} ${clock}`;
}

/**
 * 待办行上的截止标签视图
 * @param item 待办（容忍脏数据：dueTime 非法视为未设置）
 * @param nowTs 当前时间戳（毫秒）
 */
export function dueTagView(item: NoteItem, nowTs: number): DueTagView {
  const due = item && typeof item.dueTime === 'number' ? item.dueTime : 0;
  if (due <= 0 || item.done) return { enabled: false, text: '', state: 'future' };
  return { enabled: true, text: dueText(due, nowTs), state: dueState(due, nowTs) };
}

/**
 * 首页横幅：聚合「已逾期」与「今天内到期」的未完成待办
 *
 * 注意「今天到期」含两个子状态：还没到点的（未来）与当天内已过点的（已逾期）。
 * 一条待办只进一组：先判逾期，再看今天，避免重复计数。
 *
 * @param items 全部待办（含已完成；函数内部过滤）
 * @param nowTs 当前时间戳（毫秒）
 */
export function dueBannerView(items: readonly NoteItem[], nowTs: number): DueBannerView {
  const pending = items.filter((n) => n && n.kind === 'todo' && !n.done);
  let overdue = 0;
  let dueToday = 0;
  pending.forEach((n) => {
    const due = typeof n.dueTime === 'number' ? n.dueTime : 0;
    if (due <= 0) return;
    const state = dueState(due, nowTs);
    if (state === 'overdue') {
      // 逾期但不是今天到期过点的（即截止日在更早的自然日）才算"已逾期"档；
      // 今天内过点的进"今天到期"，横幅里不重复报
      const d = new Date(due);
      const n2 = new Date(nowTs);
      const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const todayDay = new Date(n2.getFullYear(), n2.getMonth(), n2.getDate()).getTime();
      if (dueDay < todayDay) overdue += 1;
      else dueToday += 1;
    } else if (state === 'today') {
      dueToday += 1;
    }
  });

  const parts: string[] = [];
  if (overdue > 0) parts.push(`${overdue} 条已逾期`);
  if (dueToday > 0) parts.push(`${dueToday} 条今天到期`);
  return { enabled: parts.length > 0, text: parts.join(' · ') };
}
