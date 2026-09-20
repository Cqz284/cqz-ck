import { StorageService, StorageKeys, StorageError } from '../../service/storage';
import { LedgerType, NoteKind } from '../../types/models';
import type { LedgerRecord, NoteItem } from '../../types/models';

/** 直接读写 wx mock 的最小接口 */
interface StorageLike {
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;
}

const mockWx = (): StorageLike => (global as unknown as { wx: StorageLike }).wx;
const rawStore = (): Map<string, unknown> =>
  (global as unknown as { __wxStorageMock: Map<string, unknown> }).__wxStorageMock;

/** 构造一条合法记录 */
function mkRecord(id: string): LedgerRecord {
  return {
    id,
    type: LedgerType.Expense,
    amount: 100,
    tag: '',
    remark: '',
    date: '2026-09-17',
    createTime: 1,
    updateTime: 1,
    extra: {},
  };
}

/** 构造一条合法记事项 */
function mkNote(id: string, content = 'x'): NoteItem {
  return {
    id,
    kind: NoteKind.Plain,
    content,
    done: false,
    createTime: 1,
    updateTime: 1,
    extra: {},
  };
}

describe('StorageService', () => {
  beforeEach(() => {
    StorageService.clear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('set 后 get 返回相同数据（命中缓存）', () => {
    StorageService.set(StorageKeys.LedgerRecords, [mkRecord('1')]);
    expect(StorageService.get(StorageKeys.LedgerRecords)).toEqual([mkRecord('1')]);
  });

  test('跨进程数据可读（走 wx.storage）', () => {
    StorageService.set(StorageKeys.LedgerRecords, [mkRecord('r1')]);
    StorageService.clearCache(); // 模拟重启后缓存为空
    expect(StorageService.get(StorageKeys.LedgerRecords)).toEqual([mkRecord('r1')]);
  });

  test('数据损坏时不抛错', () => {
    rawStore().set(StorageKeys.SettingsBase, '{broken json');
    StorageService.clearCache();
    expect(() => StorageService.get(StorageKeys.SettingsBase)).not.toThrow();
  });

  test('空 key 返回 null', () => {
    StorageService.clearCache();
    expect(StorageService.get(StorageKeys.LedgerRecords)).toBeNull();
  });

  test('不存在的 key 会缓存"空"结论，避免反复读 storage', () => {
    StorageService.clearCache();
    expect(StorageService.get(StorageKeys.LedgerRecords)).toBeNull();

    // 绕过 StorageService 直接往底层塞数据：若缓存生效，读取仍应返回 null
    rawStore().set(StorageKeys.LedgerRecords, [mkRecord('sneaky')]);
    expect(StorageService.get(StorageKeys.LedgerRecords)).toBeNull();
  });

  test('remove 与 clear', () => {
    StorageService.set(StorageKeys.LedgerRecords, [mkRecord('a')]);
    StorageService.set(StorageKeys.NotesItems, [mkNote('b')]);

    StorageService.remove(StorageKeys.LedgerRecords);
    expect(StorageService.get(StorageKeys.LedgerRecords)).toBeNull();

    StorageService.clear();
    expect(StorageService.get(StorageKeys.NotesItems)).toBeNull();
  });

  test('写入抛出 StorageError（wx.setStorageSync 失败场景）', () => {
    const origin = mockWx().setStorageSync;
    mockWx().setStorageSync = () => {
      throw new Error('mock fail');
    };
    try {
      expect(() => StorageService.set(StorageKeys.LedgerRecords, [])).toThrow(StorageError);
    } finally {
      mockWx().setStorageSync = origin;
    }
  });

  test('落盘失败时缓存保持原值，不产生内存/磁盘不一致', () => {
    StorageService.set(StorageKeys.LedgerRecords, [mkRecord('origin')]);

    const origin = mockWx().setStorageSync;
    mockWx().setStorageSync = () => {
      throw new Error('mock fail');
    };
    try {
      expect(() => StorageService.set(StorageKeys.LedgerRecords, [mkRecord('next')])).toThrow(
        StorageError
      );
    } finally {
      mockWx().setStorageSync = origin;
    }

    // 关键断言：写失败后读到的是旧值，而不是那份"没写成功的新值"
    expect(StorageService.get(StorageKeys.LedgerRecords)).toEqual([mkRecord('origin')]);
  });

  test('usage 统计业务 key 的字节数与 emoji 长度', () => {
    expect(StorageService.usage().keys).toEqual([]);

    StorageService.set(StorageKeys.NotesItems, [mkNote('e', '😀')]);
    const usage = StorageService.usage();
    expect(usage.keys).toEqual([StorageKeys.NotesItems]);
    expect(usage.bytes).toBeGreaterThan(0);
  });
});
