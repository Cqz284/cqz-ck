import { LedgerService } from '../../service/ledger.service';
import { NotesService } from '../../service/notes.service';
import { StorageService } from '../../service/storage';
import { ledgerStore } from '../../store/ledger.store';
import { notesStore } from '../../store/notes.store';
import { LedgerType, NoteKind } from '../../types/models';

beforeEach(() => {
  StorageService.clear();
});

describe('LedgerService · 批量删除与撤销', () => {
  test('removeMany 单次落盘并返回被删记录，restore 原样写回', () => {
    const a = LedgerService.create({ type: LedgerType.Expense, amount: 10, date: '2026-09-10', tag: '餐饮' });
    const b = LedgerService.create({ type: LedgerType.Expense, amount: 20, date: '2026-09-11', tag: '交通' });
    const c = LedgerService.create({ type: LedgerType.Income, amount: 30, date: '2026-09-12', tag: '工资' });

    const removed = LedgerService.removeMany([a.id, c.id]);
    expect(removed.map((r) => r.id).sort()).toEqual([a.id, c.id].sort());

    const left = LedgerService.list();
    expect(left.map((r) => r.id)).toEqual([b.id]);

    // 恢复后 id / 创建时间不变，列表与删除前一致（按日期倒序）
    expect(LedgerService.restore(removed)).toBe(2);
    const restored = LedgerService.list();
    expect(restored.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
    expect(restored.find((r) => r.id === a.id)?.createTime).toBe(a.createTime);
    expect(restored.find((r) => r.id === a.id)?.tag).toBe('餐饮');
  });

  test('重复恢复不会插入重复记录', () => {
    const a = LedgerService.create({ type: LedgerType.Expense, amount: 10, date: '2026-09-10' });
    const removed = LedgerService.removeMany([a.id]);
    expect(LedgerService.restore(removed)).toBe(1);
    expect(LedgerService.restore(removed)).toBe(0);
    expect(LedgerService.list()).toHaveLength(1);
  });

  test('空集合 / 不存在的 id 不写库', () => {
    LedgerService.create({ type: LedgerType.Expense, amount: 10, date: '2026-09-10' });
    expect(LedgerService.removeMany([])).toEqual([]);
    expect(LedgerService.removeMany(['不存在'])).toEqual([]);
    expect(LedgerService.list()).toHaveLength(1);
    expect(LedgerService.restore([])).toBe(0);
  });
});

describe('NotesService · 批量删除与撤销', () => {
  test('批量删除保留完成状态，撤销后完全复原', () => {
    const todo = NotesService.create({ kind: NoteKind.Todo, content: '周报' });
    const plain = NotesService.create({ kind: NoteKind.Plain, content: '随手记' });
    const done = NotesService.create({ kind: NoteKind.Todo, content: '已完成的事', done: true });

    const removed = NotesService.removeMany([todo.id, done.id]);
    expect(removed).toHaveLength(2);
    expect(NotesService.list().map((n) => n.id)).toEqual([plain.id]);

    expect(NotesService.restore(removed)).toBe(2);
    const list = NotesService.list();
    expect(list).toHaveLength(3);
    expect(list.find((n) => n.id === done.id)?.done).toBe(true);
    expect(list.find((n) => n.id === todo.id)?.done).toBe(false);
  });
});

describe('store · 批量删除与撤销', () => {
  test('ledgerStore.removeMany 同步内存并返回被删记录，restore 后顺序回到全局排序', () => {
    ledgerStore.load();
    const a = ledgerStore.add({ type: LedgerType.Expense, amount: 10, date: '2026-09-10', tag: '餐饮' });
    const b = ledgerStore.add({ type: LedgerType.Expense, amount: 20, date: '2026-09-11', tag: '交通' });
    const c = ledgerStore.add({ type: LedgerType.Expense, amount: 30, date: '2026-09-12', tag: '购物' });

    const removed = ledgerStore.removeMany([a.id, b.id]);
    expect(removed).toHaveLength(2);
    expect(ledgerStore.records.map((r) => r.id)).toEqual([c.id]);

    ledgerStore.restore(removed);
    // 恢复后按"日期 + 时间"倒序重新排列，而不是简单追加到末尾
    expect(ledgerStore.records.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
  });

  test('notesStore.removeMany 与 restore 保持 totalCount / pendingCount 一致', () => {
    notesStore.load();
    const t1 = notesStore.add({ kind: NoteKind.Todo, content: 'A' });
    const t2 = notesStore.add({ kind: NoteKind.Todo, content: 'B' });

    expect(notesStore.pendingCount).toBe(2);
    const removed = notesStore.removeMany([t1.id]);
    expect(notesStore.totalCount).toBe(1);
    expect(notesStore.pendingCount).toBe(1);

    notesStore.restore(removed);
    expect(notesStore.totalCount).toBe(2);
    expect(notesStore.pendingCount).toBe(2);
    expect(notesStore.items.map((n) => n.id)).toContain(t2.id);
  });
});
