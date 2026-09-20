/**
 * 记账状态层：跨页面共享的记账数据
 * 依赖方向：store -> service，页面只与 store 交互
 */
import { observable, action } from 'mobx-miniprogram';
import { LedgerService, summarize } from '../service/ledger.service';
import type { LedgerRecord, LedgerInput, LedgerSummary } from '../types/models';
import { monthOf } from '../utils/date';

/** 记账 store 的形状（显式声明以保留 this 的类型信息） */
export interface LedgerStore {
  /** 全部记账记录（按记账日期 + 时间倒序） */
  records: LedgerRecord[];
  /** 是否加载中 */
  loading: boolean;
  /** 本月汇总：收入 / 支出 / 结余（单位：分） */
  readonly monthSummary: LedgerSummary;
  /** 本月记录数 */
  readonly monthCount: number;
  /** 从本地存储加载数据 */
  load(): void;
  /** 新增记录 */
  add(input: LedgerInput): LedgerRecord;
  /** 编辑记录 */
  edit(id: string, patch: Partial<LedgerInput>): LedgerRecord;
  /** 删除记录 */
  remove(id: string): void;
  /**
   * 批量删除记录
   * @param ids 记录 id 集合
   * @returns 被删掉的记录（供撤销用）
   */
  removeMany(ids: readonly string[]): LedgerRecord[];
  /**
   * 恢复记录（撤销删除）
   * @param records 待恢复的记录
   */
  restore(records: readonly LedgerRecord[]): void;
  /** 清空全部记录 */
  clearAll(): void;
}

export const ledgerStore = observable({
  /** 全部记账记录（按记账日期 + 时间倒序） */
  records: [] as LedgerRecord[],
  /** 是否加载中 */
  loading: false,

  /** 本月汇总：收入 / 支出 / 结余（单位：分） */
  get monthSummary(): LedgerSummary {
    return summarize(this.records, monthOf());
  },

  /** 本月记录数 */
  get monthCount(): number {
    const month = monthOf();
    return this.records.filter((r) => r.date.slice(0, 7) === month).length;
  },

  /** 从本地存储加载数据 */
  load: action(function (this: LedgerStore) {
    this.loading = true;
    try {
      this.records = LedgerService.list();
    } finally {
      this.loading = false;
    }
  }),

  /** 新增记录 */
  add: action(function (this: LedgerStore, input: LedgerInput) {
    const record = LedgerService.create(input);
    this.records = [record, ...this.records];
    return record;
  }),

  /** 编辑记录 */
  edit: action(function (this: LedgerStore, id: string, patch: Partial<LedgerInput>) {
    const next = LedgerService.update(id, patch);
    this.records = this.records.map((r) => (r.id === id ? next : r));
    return next;
  }),

  /** 删除记录 */
  remove: action(function (this: LedgerStore, id: string) {
    LedgerService.remove(id);
    this.records = this.records.filter((r) => r.id !== id);
  }),

  /** 批量删除记录（单次落盘；返回被删记录供撤销） */
  removeMany: action(function (this: LedgerStore, ids: readonly string[]) {
    const removed = LedgerService.removeMany(ids);
    if (removed.length) {
      const set = new Set(removed.map((r) => r.id));
      this.records = this.records.filter((r) => !set.has(r.id));
    }
    return removed;
  }),

  /** 恢复记录（撤销删除）：直接从存储重读，排序与分组口径自动对齐 */
  restore: action(function (this: LedgerStore, records: readonly LedgerRecord[]) {
    if (!LedgerService.restore(records)) return;
    this.records = LedgerService.list();
  }),

  /** 清空全部记录（单次落盘，避免逐条删除的 O(n²) 写入） */
  clearAll: action(function (this: LedgerStore) {
    LedgerService.clear();
    this.records = [];
  }),
}) as LedgerStore;
