import { ledgerStore } from '../../store/ledger.store';
import { notesStore } from '../../store/notes.store';
import { settingsStore } from '../../store/settings.store';
import { StorageService, StorageKeys } from '../../service/storage';
import { LedgerType, NoteKind } from '../../types/models';
import { monthOf } from '../../utils/date';
import { isHapticsEnabled } from '../../utils/haptics';

describe('stores（mobx-miniprogram）', () => {
  beforeEach(() => {
    // 清空底层存储与缓存
    (global as unknown as { __wxStorageMock: Map<string, unknown> }).__wxStorageMock.clear();
    StorageService.clear();
    ledgerStore.load();
    notesStore.load();
    notesStore.setFilter('all');
    notesStore.setSearchKeyword('');
  });

  test('ledgerStore add / monthSummary 联动', () => {
    expect(ledgerStore.records).toHaveLength(0);
    ledgerStore.add({ type: LedgerType.Expense, amount: 12.3, date: '2026-09-16' });
    expect(ledgerStore.records).toHaveLength(1);
    expect(ledgerStore.monthSummary).toEqual({ income: 0, expense: 1230, balance: -1230 });
  });

  test('ledgerStore monthSummary 只统计当月', () => {
    const month = monthOf();
    ledgerStore.add({ type: LedgerType.Income, amount: 100, date: month + '-10' });
    ledgerStore.add({ type: LedgerType.Expense, amount: 30, date: month + '-11' });
    ledgerStore.add({ type: LedgerType.Expense, amount: 999, date: '2000-01-01' }); // 非本月

    expect(ledgerStore.monthSummary).toEqual({ income: 10000, expense: 3000, balance: 7000 });
    expect(ledgerStore.monthCount).toBe(2);
  });

  test('ledgerStore edit 同步更新汇总', () => {
    const r = ledgerStore.add({ type: LedgerType.Expense, amount: 10, date: monthOf() + '-08' });
    expect(ledgerStore.monthSummary.expense).toBe(1000);

    ledgerStore.edit(r.id, { amount: 25 });
    expect(ledgerStore.monthSummary.expense).toBe(2500);
  });

  test('ledgerStore remove', () => {
    const r = ledgerStore.add({ type: LedgerType.Expense, amount: 1, date: '2026-09-16' });
    ledgerStore.remove(r.id);
    expect(ledgerStore.records.find((x) => x.id === r.id)).toBeUndefined();
  });

  test('ledgerStore clearAll 一次落盘并清空', () => {
    ledgerStore.add({ type: LedgerType.Expense, amount: 1, date: '2026-09-16' });
    ledgerStore.add({ type: LedgerType.Income, amount: 2, date: '2026-09-16' });
    expect(ledgerStore.records).toHaveLength(2);

    ledgerStore.clearAll();
    expect(ledgerStore.records).toHaveLength(0);
    expect(StorageService.get(StorageKeys.LedgerRecords)).toEqual([]);
  });

  test('ledgerStore 非法金额被拒绝且不写入', () => {
    expect(() => ledgerStore.add({ type: LedgerType.Expense, amount: 0, date: '2026-09-16' })).toThrow();
    expect(ledgerStore.records).toHaveLength(0);
  });

  test('notesStore add / toggleDone / pendingCount', () => {
    expect(notesStore.totalCount).toBe(0);

    const n = notesStore.add({ kind: NoteKind.Todo, content: '测试待办' });
    expect(notesStore.totalCount).toBe(1);
    expect(notesStore.pendingCount).toBe(1);

    notesStore.toggleDone(n.id);
    expect(notesStore.pendingCount).toBe(0);
  });

  test('notesStore setSearchKeyword 过滤', () => {
    notesStore.add({ kind: NoteKind.Plain, content: '独特关键词abc' });
    notesStore.add({ kind: NoteKind.Plain, content: '无关内容' });

    notesStore.setSearchKeyword('abc');
    expect(notesStore.visibleItems).toHaveLength(1);
    expect(notesStore.visibleItems[0].content).toBe('独特关键词abc');
  });

  test('notesStore setFilter 过滤', () => {
    notesStore.add({ kind: NoteKind.Plain, content: '普通笔记' });
    notesStore.add({ kind: NoteKind.Todo, content: '待办事项' });

    notesStore.setFilter(NoteKind.Todo);
    expect(notesStore.visibleItems).toHaveLength(1);
    expect(notesStore.visibleItems[0].kind).toBe(NoteKind.Todo);

    notesStore.setFilter('all');
    expect(notesStore.visibleItems).toHaveLength(2);
  });

  test('notesStore clearAll 一次落盘并清空', () => {
    notesStore.add({ kind: NoteKind.Plain, content: 'a' });
    notesStore.add({ kind: NoteKind.Todo, content: 'b' });

    notesStore.clearAll();
    expect(notesStore.totalCount).toBe(0);
    expect(StorageService.get(StorageKeys.NotesItems)).toEqual([]);
  });

  test('settingsStore 初值与 service 默认值一致', () => {
    settingsStore.reset();
    expect(settingsStore.settings).toEqual({
      currency: '¥',
      haptics: true,
      monthlyBudget: 0,
      dailyBudget: 0,
      extra: {},
    });

    settingsStore.update({ currency: '$' });
    expect(settingsStore.settings.currency).toBe('$');
  });

  test('settingsStore 更新震动开关会同步到运行时开关', () => {
    settingsStore.reset();
    expect(isHapticsEnabled()).toBe(true);

    settingsStore.update({ haptics: false });
    expect(isHapticsEnabled()).toBe(false);

    settingsStore.update({ haptics: true });
    expect(isHapticsEnabled()).toBe(true);
  });
});
