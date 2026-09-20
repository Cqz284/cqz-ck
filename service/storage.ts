/**
 * 本地存储封装
 *
 * 设计说明（v3 修订）：
 * - 读操作**不做防抖**：wx.getStorageSync 是同步本地读，本身极快，防抖会让同步返回值失效。
 *   真正的优化是**内存缓存**：首次读取后缓存（含"空值"这一结论），写操作时同步更新缓存。
 * - 写操作**先落盘、后更新缓存**。旧实现顺序相反，落盘失败抛错时缓存已被写入新值，
 *   导致内存与磁盘长期不一致，后续读操作会一直读到那份"写失败的数据"。
 * - 读取返回的类型是 **readonly**，业务层必须用不可变方式更新（`[x, ...list]` / `map`），
 *   这样"误改缓存内部数组"会在编译期就被拦住。
 */
import type { BaseSettings, LedgerRecord, NoteItem, QuickTagsStore } from '../types/models';

/** Storage key 命名空间 */
export const StorageKeys = {
  /** 记账记录数组 */
  LedgerRecords: 'ledger:records',
  /** 记事项数组 */
  NotesItems: 'notes:items',
  /** 基础设置 */
  SettingsBase: 'settings:base',
  /** 记账页快速标签（列表 + 居中项） */
  QuickTags: 'ledger:quick-tags',
  /** 额度提醒记录：最近一次提醒的日期，避免同一天反复提示 */
  BudgetNotice: 'budget:notice',
} as const;

/** 存储异常 */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

/** 内存缓存：key -> 值（null 表示"已确认不存在"，避免反复读 storage） */
const cache = new Map<string, unknown>();

/** 按 key 缓存的数据类型约束（readonly 是刻意的：防止业务层原地修改缓存对象） */
interface StorageSchema {
  [StorageKeys.LedgerRecords]: readonly LedgerRecord[];
  [StorageKeys.NotesItems]: readonly NoteItem[];
  [StorageKeys.SettingsBase]: Readonly<BaseSettings>;
  [StorageKeys.QuickTags]: Readonly<QuickTagsStore>;
  /** 额度提醒：{ date: 'YYYY-MM-DD' } */
  [StorageKeys.BudgetNotice]: Readonly<{ date: string }>;
}

export class StorageService {
  /**
   * 读取指定 key 的数据（带内存缓存）
   * @param key Storage key
   * @returns 解析后的数据，不存在或解析失败返回 null
   */
  static get<K extends keyof StorageSchema>(key: K): StorageSchema[K] | null {
    if (cache.has(key)) return cache.get(key) as StorageSchema[K] | null;

    try {
      const raw = wx.getStorageSync(key);
      if (raw === '' || raw === null || raw === undefined) {
        cache.set(key, null);
        return null;
      }

      let value: unknown = raw;
      if (typeof raw === 'string') {
        try {
          value = JSON.parse(raw);
        } catch {
          // 历史数据可能为纯字符串，直接返回
          value = raw;
        }
      }
      cache.set(key, value);
      return value as StorageSchema[K];
    } catch (err) {
      console.error('[storage] 读取失败:', key, err);
      return null;
    }
  }

  /**
   * 写入数据：先落盘，成功后再更新缓存
   * @param key Storage key
   * @param value 待写入的数据
   * @throws {StorageError} 落盘失败时抛出（此时缓存保持原值，不会产生不一致）
   */
  static set<K extends keyof StorageSchema>(key: K, value: StorageSchema[K]): void {
    try {
      wx.setStorageSync(key, value);
    } catch (err) {
      console.error('[storage] 写入失败:', key, err);
      throw new StorageError(`写入失败：${key}`);
    }
    cache.set(key, value);
  }

  /**
   * 删除指定 key
   * @param key Storage key
   */
  static remove(key: string): void {
    try {
      wx.removeStorageSync(key);
    } catch (err) {
      console.error('[storage] 删除失败:', key, err);
      return;
    }
    cache.delete(key);
  }

  /**
   * 清空全部业务数据（含缓存）
   */
  static clear(): void {
    cache.clear();
    try {
      Object.values(StorageKeys).forEach((key) => wx.removeStorageSync(key));
    } catch (err) {
      console.error('[storage] 清空失败:', err);
    }
  }

  /**
   * 仅清空内存缓存（供测试使用）
   */
  static clearCache(): void {
    cache.clear();
  }

  /**
   * 估算已占用容量（字节，按 UTF-8 粗略计算）
   * @returns { bytes, keys }
   */
  static usage(): { bytes: number; keys: string[] } {
    let bytes = 0;
    const keys: string[] = [];
    Object.values(StorageKeys).forEach((key) => {
      const val = this.get(key as keyof StorageSchema);
      if (val !== null) {
        keys.push(key);
        bytes += byteLength(JSON.stringify(val));
      }
    });
    return { bytes, keys };
  }
}

/** 简易 UTF-8 字节长度计算（避免使用 Buffer，保证小程序与 node 测试环境均可用） */
function byteLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      n += 1;
    } else if (code < 0x800) {
      n += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // 高位代理：与后面的低位代理共同构成一个 4 字节字符（emoji 等）
      n += 4;
      i++;
    } else {
      n += 3;
    }
  }
  return n;
}
