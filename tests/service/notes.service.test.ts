import { NotesService, NotesError, MAX_CONTENT_LEN } from '../../service/notes.service';
import { StorageService } from '../../service/storage';
import { NoteKind } from '../../types/models';

describe('NotesService', () => {
  beforeEach(() => {
    StorageService.clear();
  });

  test('普通笔记 done 恒为 false', () => {
    const n = NotesService.create({ kind: NoteKind.Plain, content: '笔记', done: true });
    expect(n.done).toBe(false);
    expect(n.kind).toBe(NoteKind.Plain);
  });

  test('待办创建与勾选切换', () => {
    const n = NotesService.create({ kind: NoteKind.Todo, content: '买牛奶' });
    expect(n.done).toBe(false);
    const t1 = NotesService.toggleDone(n.id);
    expect(t1.done).toBe(true);
    const t2 = NotesService.toggleDone(n.id);
    expect(t2.done).toBe(false);
  });

  test('toggleDone 对普通笔记无效', () => {
    const n = NotesService.create({ kind: NoteKind.Plain, content: '笔记' });
    const t = NotesService.toggleDone(n.id);
    expect(t.done).toBe(false);
  });

  test('search 按关键词过滤', () => {
    NotesService.create({ kind: NoteKind.Plain, content: '今天买牛奶' });
    NotesService.create({ kind: NoteKind.Todo, content: '写周报' });
    expect(NotesService.list({ keyword: '牛奶' })).toHaveLength(1);
    expect(NotesService.list({ keyword: '周报' })).toHaveLength(1);
    expect(NotesService.list({ keyword: '不存在的词' })).toHaveLength(0);
  });

  test('list 支持按类型过滤', () => {
    NotesService.create({ kind: NoteKind.Plain, content: 'a' });
    NotesService.create({ kind: NoteKind.Todo, content: 'b' });
    expect(NotesService.list({ kind: NoteKind.Todo })).toHaveLength(1);
    expect(NotesService.list({ kind: NoteKind.Plain })).toHaveLength(1);
  });

  test('pendingTodoCount 只统计未完成待办', () => {
    NotesService.create({ kind: NoteKind.Todo, content: 't1' });
    NotesService.create({ kind: NoteKind.Todo, content: 't2' });
    NotesService.create({ kind: NoteKind.Plain, content: 'p' });
    expect(NotesService.pendingTodoCount()).toBe(2);
    const todos = NotesService.list({ kind: NoteKind.Todo });
    NotesService.toggleDone(todos[0].id);
    expect(NotesService.pendingTodoCount()).toBe(1);
  });

  test('remove 删除记事项', () => {
    const n = NotesService.create({ kind: NoteKind.Plain, content: 'x' });
    NotesService.remove(n.id);
    expect(NotesService.list()).toHaveLength(0);
  });

  test('clear 清空全部', () => {
    NotesService.create({ kind: NoteKind.Plain, content: 'x' });
    NotesService.create({ kind: NoteKind.Todo, content: 'y' });
    NotesService.clear();
    expect(NotesService.list()).toHaveLength(0);
  });

  test('create 不修改此前已返回的列表（不可变更新）', () => {
    NotesService.create({ kind: NoteKind.Plain, content: 'a' });
    const snapshot = NotesService.list();

    NotesService.create({ kind: NoteKind.Plain, content: 'b' });
    expect(snapshot).toHaveLength(1);
    expect(NotesService.list()).toHaveLength(2);
  });

  describe('入参校验（此前缺失）', () => {
    test('create 拒绝空内容', () => {
      expect(() => NotesService.create({ kind: NoteKind.Plain, content: '' })).toThrow(NotesError);
      expect(() => NotesService.create({ kind: NoteKind.Plain, content: '   ' })).toThrow(NotesError);
    });

    test('create 会去首尾空格并截断到上限', () => {
      const n = NotesService.create({ kind: NoteKind.Plain, content: '  内容  ' });
      expect(n.content).toBe('内容');

      const long = NotesService.create({
        kind: NoteKind.Plain,
        content: 'x'.repeat(MAX_CONTENT_LEN + 10),
      });
      expect(long.content).toHaveLength(MAX_CONTENT_LEN);
    });

    test('create 拒绝非法类型', () => {
      const invalid = 'memo' as unknown as NoteKind;
      expect(() => NotesService.create({ kind: invalid, content: 'x' })).toThrow(NotesError);
    });

    test('update 记录不存在时抛 NotesError', () => {
      expect(() => NotesService.update('not-exist', { content: 'x' })).toThrow(NotesError);
    });

    test('toggleDone 记录不存在时抛 NotesError', () => {
      expect(() => NotesService.toggleDone('not-exist')).toThrow(NotesError);
    });
  });

  describe('dueTime 截止时间', () => {
    test('待办创建时保留合法的截止时间', () => {
      const n = NotesService.create({ kind: NoteKind.Todo, content: 't', dueTime: 1000 });
      expect(n.dueTime).toBe(1000);
    });

    test('非法截止时间（负数 / NaN / 非数字）静默丢弃', () => {
      const a = NotesService.create({ kind: NoteKind.Todo, content: 'a', dueTime: -1 });
      expect(a.dueTime).toBeUndefined();
      const b = NotesService.create({ kind: NoteKind.Todo, content: 'b', dueTime: NaN });
      expect(b.dueTime).toBeUndefined();
      const c = NotesService.create({
        kind: NoteKind.Todo,
        content: 'c',
        dueTime: '明天' as unknown as number,
      });
      expect(c.dueTime).toBeUndefined();
    });

    test('普通笔记即使传了截止时间也丢弃', () => {
      const n = NotesService.create({ kind: NoteKind.Plain, content: 'p', dueTime: 1000 });
      expect(n.dueTime).toBeUndefined();
    });

    test('update 未传保持原值；传 0 清除（结构里真没有该字段）', () => {
      const n = NotesService.create({ kind: NoteKind.Todo, content: 't', dueTime: 1000 });
      const kept = NotesService.update(n.id, { content: 't2' });
      expect(kept.dueTime).toBe(1000);

      const cleared = NotesService.update(n.id, { dueTime: 0 });
      expect(cleared.dueTime).toBeUndefined();
      expect('dueTime' in cleared).toBe(false);
    });

    test('待办改回普通笔记时截止时间一并清除', () => {
      const n = NotesService.create({ kind: NoteKind.Todo, content: 't', dueTime: 1000 });
      const p = NotesService.update(n.id, { kind: NoteKind.Plain });
      expect(p.dueTime).toBeUndefined();
      expect('dueTime' in p).toBe(false);
    });

    test('过去的时间允许设置（设了就已逾期是合理状态）', () => {
      const n = NotesService.create({ kind: NoteKind.Todo, content: 't', dueTime: 1 });
      expect(n.dueTime).toBe(1);
    });
  });

  describe('tags 标签（2026-09-21）', () => {
    test('create 保留合法标签；笔记与待办都可以有', () => {
      const a = NotesService.create({ kind: NoteKind.Plain, content: 'a', tags: ['工作', '灵感'] });
      expect(a.tags).toEqual(['工作', '灵感']);
      const b = NotesService.create({ kind: NoteKind.Todo, content: 'b', tags: ['采购'] });
      expect(b.tags).toEqual(['采购']);
    });

    test('标签去空格、去重、限长、限个（脏值逐个丢弃不报错）', () => {
      const n = NotesService.create({
        kind: NoteKind.Plain,
        content: 'a',
        tags: ['  工作  ', '工作', '', 'x'.repeat(30), ...Array.from({ length: 15 }, (_, i) => `t${i}`)],
      });
      // 「工作」去空格后与重复项合并；超长被截断到 20；最多保留 10 个
      expect(n.tags).toHaveLength(10);
      expect(n.tags?.[0]).toBe('工作');
      expect(n.tags?.every((t) => t.length <= 20)).toBe(true);
    });

    test('清洗后一个不剩时不落 tags 字段（与 dueTime 的清除语义一致）', () => {
      const n = NotesService.create({ kind: NoteKind.Plain, content: 'a', tags: ['', '   '] });
      expect('tags' in n).toBe(false);
    });

    test('search 关键词命中标签', () => {
      NotesService.create({ kind: NoteKind.Plain, content: '随便写点', tags: ['灵感'] });
      NotesService.create({ kind: NoteKind.Plain, content: '另一条' });
      expect(NotesService.list({ keyword: '灵感' })).toHaveLength(1);
    });

    test('update 未传保持原值；空数组清除（结构里真没有该字段）', () => {
      const n = NotesService.create({ kind: NoteKind.Plain, content: 'a', tags: ['工作'] });
      const kept = NotesService.update(n.id, { content: 'a2' });
      expect(kept.tags).toEqual(['工作']);

      const cleared = NotesService.update(n.id, { tags: [] });
      expect(cleared.tags).toBeUndefined();
      expect('tags' in cleared).toBe(false);
    });

    test('update 传新集合整体替换', () => {
      const n = NotesService.create({ kind: NoteKind.Plain, content: 'a', tags: ['旧'] });
      const next = NotesService.update(n.id, { tags: ['新1', '新2'] });
      expect(next.tags).toEqual(['新1', '新2']);
    });
  });
});
