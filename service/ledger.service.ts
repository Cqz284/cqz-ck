/**
 * 记账业务层：负责记账记录的读写与业务规则
 * 约定：金额持久化单位为「分」，入参单位为「元」（LedgerInput.amount）
 *
 * 设计说明：所有写入都采用**不可变更新**（生成新数组后整体写回）。
 * StorageService.get 返回的是 readonly 引用，原地修改会被类型系统拦住。
 */
import { StorageService, StorageKeys } from './storage';
import { uid } from '../utils/id';
import { now, monthOf, nowTime } from '../utils/date';
import { compareByDateTimeDesc } from '../utils/group';
import { toFen, isValidAmount, MAX_YUAN } from '../utils/money';
import { LedgerType } from '../types/models';
import type { LedgerRecord, LedgerInput, LedgerQueryOptions, LedgerSummary } from '../types/models';

/** 标签最大长度 */
export const MAX_TAG_LEN = 20;
/** 备注最大长度 */
export const MAX_REMARK_LEN = 200;

/** 日期格式 YYYY-MM-DD */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 时间格式 HH:mm */
const TIME_RE = /^\d{2}:\d{2}$/;

/** 记账业务错误（入参不合法 / 记录不存在） */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * 校验并归一化收支类型
 * @param type 入参
 * @returns {LedgerType}
 * @throws {LedgerError} 取值非法
 */
function normalizeType(type: unknown): LedgerType {
  if (type === LedgerType.Income || type === LedgerType.Expense) return type;
  throw new LedgerError(`收支类型不合法：${String(type)}`);
}

/**
 * 校验并归一化金额（元 → 分）
 *
 * 旧实现直接 toFen(input.amount)，非法值会静默变成 NaN 落库，
 * 最终在界面上渲染出 `¥NaN.undefined`。这里在写库前就拦住。
 *
 * @param amount 金额（元）
 * @returns {number} 金额（分）
 * @throws {LedgerError} 金额非法
 */
export function normalizeAmount(amount: unknown): number {
  if (!isValidAmount(amount)) {
    throw new LedgerError(
      `金额不合法：${String(amount)}（需大于 0、两位小数以内、不超过 ${MAX_YUAN} 元）`
    );
  }
  return toFen(Number(amount));
}

/**
 * 校验并归一化日期
 * @param date 入参
 * @returns {string} YYYY-MM-DD
 * @throws {LedgerError} 日期非法
 */
function normalizeDate(date: unknown): string {
  const text = String(date ?? '');
  if (!DATE_RE.test(text)) {
    throw new LedgerError(`日期格式不合法：${text}（应为 YYYY-MM-DD）`);
  }
  return text;
}

/**
 * 校验并归一化时间
 * @param time 入参
 * @returns {string} HH:mm
 * @throws {LedgerError} 时间非法
 */
function normalizeTime(time: unknown): string {
  const text = String(time ?? '');
  if (!TIME_RE.test(text)) {
    throw new LedgerError(`时间格式不合法：${text}（应为 HH:mm）`);
  }
  return text;
}

/**
 * 归一化可选文本字段（去首尾空格并截断到上限）
 * @param value 入参
 * @param maxLen 最大长度
 * @returns {string}
 */
function normalizeText(value: unknown, maxLen: number): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLen);
}

/**
 * 从一组记录中累计收支（纯函数）
 *
 * 这是全项目**唯一**的收支汇总实现，service 与 store 共用，
 * 避免此前"store 里写一遍、service 里再写一遍"的双份逻辑。
 *
 * 月份比较用 `date.slice(0, 7)` 而不是 `monthOf(date)`（后者会为每条记录做一次 dayjs 解析）。
 *
 * @param records 记录集合
 * @param month 可选，月份 YYYY-MM；不传则统计全部
 * @returns LedgerSummary，单位：分
 */
export function summarize(records: readonly LedgerRecord[], month?: string): LedgerSummary {
  let income = 0;
  let expense = 0;
  records.forEach((r) => {
    if (month && r.date.slice(0, 7) !== month) return;
    if (r.type === LedgerType.Income) income += r.amount;
    else expense += r.amount;
  });
  return { income, expense, balance: income - expense };
}

export class LedgerService {
  /**
   * 查询记账记录，默认按记账日期 + 时间倒序（同日内时间晚的在前）
   * @param opts 查询条件（月份 / 关键词）
   * @returns LedgerRecord[]
   */
  static list(opts: LedgerQueryOptions = {}): LedgerRecord[] {
    const all = StorageService.get(StorageKeys.LedgerRecords) ?? [];
    let list = Array.isArray(all) ? all.slice() : [];

    if (opts.month) {
      list = list.filter((r) => monthOf(r.date) === opts.month);
    }
    if (opts.keyword) {
      const kw = opts.keyword.trim().toLowerCase();
      list = list.filter(
        (r) => (r.remark ?? '').toLowerCase().includes(kw) || (r.tag ?? '').toLowerCase().includes(kw)
      );
    }
    return list.sort(compareByDateTimeDesc);
  }

  /**
   * 新增记账记录
   * @param input 表单输入（金额为元）
   * @returns 新增的记录
   * @throws {LedgerError} 入参不合法
   */
  static create(input: LedgerInput): LedgerRecord {
    const ts = now();
    const record: LedgerRecord = {
      id: uid(),
      type: normalizeType(input.type),
      amount: normalizeAmount(input.amount),
      tag: normalizeText(input.tag, MAX_TAG_LEN),
      remark: normalizeText(input.remark, MAX_REMARK_LEN),
      date: normalizeDate(input.date),
      // 未传时间时兜底为当前时刻：记账时间默认"现在"
      time: input.time ? normalizeTime(input.time) : nowTime(),
      createTime: ts,
      updateTime: ts,
      extra: {},
    };
    const all = StorageService.get(StorageKeys.LedgerRecords) ?? [];
    StorageService.set(StorageKeys.LedgerRecords, [record, ...all]);
    return record;
  }

  /**
   * 更新记账记录
   * @param id 记录 id
   * @param patch 待更新字段（金额为元）；未传入的字段保持原值
   * @returns 更新后的记录
   * @throws {LedgerError} 记录不存在或入参不合法
   */
  static update(id: string, patch: Partial<LedgerInput>): LedgerRecord {
    const all = StorageService.get(StorageKeys.LedgerRecords) ?? [];
    const idx = all.findIndex((r) => r.id === id);
    if (idx < 0) throw new LedgerError(`记账记录不存在：${id}`);

    const prev = all[idx];
    const next: LedgerRecord = { ...prev, updateTime: now() };

    if (patch.type !== undefined) next.type = normalizeType(patch.type);
    if (patch.amount !== undefined) next.amount = normalizeAmount(patch.amount);
    if (patch.tag !== undefined) next.tag = normalizeText(patch.tag, MAX_TAG_LEN);
    if (patch.remark !== undefined) next.remark = normalizeText(patch.remark, MAX_REMARK_LEN);
    if (patch.date !== undefined) next.date = normalizeDate(patch.date);
    if (patch.time !== undefined) next.time = normalizeTime(patch.time);

    const updated = all.map((r, i) => (i === idx ? next : r));
    StorageService.set(StorageKeys.LedgerRecords, updated);
    return next;
  }

  /**
   * 删除记账记录
   * @param id 记录 id
   */
  static remove(id: string): void {
    const all = StorageService.get(StorageKeys.LedgerRecords) ?? [];
    StorageService.set(
      StorageKeys.LedgerRecords,
      all.filter((r) => r.id !== id)
    );
  }

  /**
   * 批量删除记账记录（单次落盘）
   * @param ids 记录 id 集合
   * @returns 被删掉的记录（供「撤销」用）；无命中时返回空数组且不写库
   */
  static removeMany(ids: readonly string[]): LedgerRecord[] {
    if (!ids.length) return [];
    const all = StorageService.get(StorageKeys.LedgerRecords) ?? [];
    const set = new Set(ids);
    const removed = all.filter((r) => set.has(r.id));
    if (!removed.length) return [];
    StorageService.set(
      StorageKeys.LedgerRecords,
      all.filter((r) => !set.has(r.id))
    );
    return removed;
  }

  /**
   * 恢复记录（撤销删除）
   *
   * 保留原 id / createTime，因此恢复后与删除前完全一致（列表排序在读取时重算）。
   * 已存在的 id 会被跳过，避免重复插入。
   *
   * @param records 待恢复的记录
   * @returns 实际恢复的条数
   */
  static restore(records: readonly LedgerRecord[]): number {
    if (!records.length) return 0;
    const all = StorageService.get(StorageKeys.LedgerRecords) ?? [];
    const exists = new Set(all.map((r) => r.id));
    const add = records.filter((r) => r && r.id && !exists.has(r.id));
    if (!add.length) return 0;
    StorageService.set(StorageKeys.LedgerRecords, [...all, ...add]);
    return add.length;
  }

  /**
   * 清空全部记账记录（单次落盘）
   */
  static clear(): void {
    StorageService.set(StorageKeys.LedgerRecords, []);
  }

  /**
   * 月度汇总
   * @param month 月份 YYYY-MM，默认当前月
   * @returns 收入 / 支出 / 结余，单位：分
   */
  static summary(month: string = monthOf()): LedgerSummary {
    const all = StorageService.get(StorageKeys.LedgerRecords) ?? [];
    return summarize(Array.isArray(all) ? all : [], month);
  }
}
