import { buildBackup, parseBackup, applyBackup, BackupError } from '../../utils/backup';
import { StorageService, StorageKeys } from '../../service/storage';
import { LedgerService } from '../../service/ledger.service';
import { NotesService } from '../../service/notes.service';
import { SettingsService } from '../../service/settings.service';
import { TagService } from '../../service/tag.service';
import { LedgerType, NoteKind } from '../../types/models';

/** 测试用记账记录结构（不经 service 创建，便于构造脏数据） */
function record(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'r1',
    type: LedgerType.Expense,
    amount: 1250,
    tag: '餐饮',
    remark: '午饭',
    date: '2026-09-19',
    time: '12:30',
    createTime: 1720000000000,
    updateTime: 1720000000000,
    extra: {},
    ...overrides,
  };
}

function note(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'n1',
    kind: NoteKind.Todo,
    content: '买菜',
    done: false,
    createTime: 1720000000000,
    updateTime: 1720000000000,
    extra: {},
    ...overrides,
  };
}

beforeEach(() => {
  (global as unknown as { __wxStorageMock: Map<string, unknown> }).__wxStorageMock.clear();
  StorageService.clearCache();
});

describe('backup · buildBackup', () => {
  test('导出包含记账、记事、快速标签、设置，且金额保持「分」', () => {
    LedgerService.create({
      type: LedgerType.Expense,
      amount: 12.5,
      tag: '餐饮',
      remark: '午饭',
      date: '2026-09-19',
      time: '12:30',
    });
    NotesService.create({ kind: NoteKind.Todo, content: '买菜' });

    const { json, counts } = buildBackup();
    expect(counts).toEqual({ records: 1, notes: 1 });

    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.app).toBe('ledger-notes');
    expect(parsed.version).toBe(1);
    const records = parsed.records as Array<{ amount: number }>;
    expect(records[0].amount).toBe(1250); // 分
  });

  test('从未自定义快速标签时导出 null（导入端还原"默认标签"行为）', () => {
    const { json } = buildBackup();
    const parsed = JSON.parse(json) as { quickTags: unknown };
    expect(parsed.quickTags).toBeNull();
  });
});

describe('backup · parseBackup', () => {
  test('合法备份往返解析：数据无损', () => {
    LedgerService.create({
      type: LedgerType.Income,
      amount: 100,
      tag: '工资',
      remark: '',
      date: '2026-09-01',
      time: '10:00',
    });
    const { json } = buildBackup();
    const { payload, dropped } = parseBackup(json);
    expect(dropped).toEqual({ records: 0, notes: 0 });
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0]).toMatchObject({ amount: 10000, type: LedgerType.Income });
  });

  test('不是本应用的备份 / JSON 非法 / 版本不兼容 → BackupError', () => {
    expect(() => parseBackup('{"app":"other","version":1}')).toThrow(BackupError);
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup('{"app":"ledger-notes","version":99}')).toThrow(BackupError);
    expect(() => parseBackup('{"app":"ledger-notes"}')).toThrow(BackupError);
  });

  test('脏数据逐条丢弃并计数：不影响合法条目', () => {
    const json = JSON.stringify({
      app: 'ledger-notes',
      version: 1,
      exportedAt: '2026-09-19 23:00',
      records: [
        record({}),
        record({ id: '', amount: 100 }), // 无 id → 丢
        record({ id: 'r2', type: 'unknown' }), // 类型非法 → 丢
        record({ id: 'r3', amount: 0 }), // 金额非正 → 丢
        record({ id: 'r4', amount: 12.5 }), // 金额非整数分 → 丢
        record({ id: 'r5', date: '20260901' }), // 日期格式非法 → 丢
        record({ id: 'r6', amount: 300 }), // 合法
        record({ id: 'r6', amount: 500 }), // 备份内部重复 id → 保留首条
      ],
      notes: [
        note({}),
        note({ id: 'n2', content: '   ' }), // 空内容 → 丢
        note({ id: 'n3', kind: 'other' }), // 类型非法 → 丢
        note({ id: 'n4', kind: NoteKind.Plain, done: true }), // 普通笔记 done 强制 false
      ],
      quickTags: null,
      settings: null,
    });
    const { payload, dropped } = parseBackup(json);
    expect(dropped).toEqual({ records: 5, notes: 2 });
    expect(payload.records.map((r) => r.id)).toEqual(['r1', 'r6']);
    expect(payload.records[1].amount).toBe(300);
    expect(payload.notes.map((n) => n.id)).toEqual(['n1', 'n4']);
    expect(payload.notes[1].done).toBe(false);
  });

  test('快速标签清洗：去重、去空、居中项失效时清空', () => {
    const json = JSON.stringify({
      app: 'ledger-notes',
      version: 1,
      records: [],
      notes: [],
      quickTags: { tags: ['餐饮', ' 餐饮 ', '', '交通'], center: '不存在' },
      settings: null,
    });
    const { payload } = parseBackup(json);
    expect(payload.quickTags).toEqual({ tags: ['餐饮', '交通'], center: '' });
  });
});

describe('backup · applyBackup', () => {
  function makePayload(records: unknown[], notes: unknown[]): string {
    return JSON.stringify({
      app: 'ledger-notes',
      version: 1,
      exportedAt: '2026-09-18 12:00',
      records,
      notes,
      quickTags: { tags: ['餐饮', '交通'], center: '餐饮' },
      settings: { currency: '¥', haptics: false, monthlyBudget: 300000, dailyBudget: 5000, extra: {} },
    });
  }

  test('merge：只补入本机没有的 id，已有记录不动，设置不受影响', () => {
    LedgerService.create({
      type: LedgerType.Expense,
      amount: 12.5,
      tag: '餐饮',
      remark: '午饭',
      date: '2026-09-19',
      time: '12:30',
    }); // id 不同于备份里的 r1
    SettingsService.update({ monthlyBudget: 100000 });

    const { payload } = parseBackup(makePayload([record({ id: 'r1' })], [note({ id: 'n1' })]));
    const result = applyBackup(payload, 'merge');
    expect(result).toEqual({ addedRecords: 1, addedNotes: 1 });
    expect(LedgerService.list()).toHaveLength(2);
    expect(NotesService.list()).toHaveLength(1);
    // 设置不动
    expect(SettingsService.get().monthlyBudget).toBe(100000);
    // 本机从未自定义标签 → 导入备份的标签
    expect(TagService.get()).toEqual(['餐饮', '交通']);
  });

  test('merge：本机已自定义标签时，不导入备份标签', () => {
    TagService.add('自定义'); // 本机已有自定义标签存储
    const { payload } = parseBackup(makePayload([], []));
    applyBackup(payload, 'merge');
    expect(TagService.get()).toContain('自定义');
    expect(TagService.get()).not.toEqual(['餐饮', '交通']);
  });

  test('overwrite：完全替换四项数据，备份为空标签时回落到默认标签', () => {
    LedgerService.create({
      type: LedgerType.Expense,
      amount: 99,
      tag: '购物',
      remark: '',
      date: '2026-09-19',
      time: '20:00',
    });
    TagService.add('旧标签');

    const { payload } = parseBackup(makePayload([record({ id: 'r1' })], []));
    const result = applyBackup(payload, 'overwrite');
    expect(result).toEqual({ addedRecords: 1, addedNotes: 0 });
    expect(LedgerService.list()).toHaveLength(1);
    expect(LedgerService.list()[0].id).toBe('r1'); // 原 id 保留
    expect(NotesService.list()).toHaveLength(0); // 本机与备份都无记事
    expect(SettingsService.get().monthlyBudget).toBe(300000);
    expect(SettingsService.get().haptics).toBe(false);
    expect(TagService.get()).toEqual(['餐饮', '交通']);
  });

  test('overwrite：空备份清空本机数据', () => {
    LedgerService.create({
      type: LedgerType.Expense,
      amount: 5,
      tag: '',
      remark: '',
      date: '2026-09-19',
      time: '08:00',
    });
    NotesService.create({ kind: NoteKind.Plain, content: '随手记' });
    const { payload } = parseBackup(makePayload([], []));
    applyBackup(payload, 'overwrite');
    expect(LedgerService.list()).toHaveLength(0);
    expect(NotesService.list()).toHaveLength(0);
  });
});
