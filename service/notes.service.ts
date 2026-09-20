/**
 * 记事业务层：负责记事项的读写与业务规则
 * 规则：普通笔记 done 恒为 false；toggleDone 仅对 todo 生效
 *
 * 设计说明：与 LedgerService 一致，写入采用不可变更新 + 入参校验。
 */
import { StorageService, StorageKeys } from './storage';
import { uid } from '../utils/id';
import { now } from '../utils/date';
import { NoteKind } from '../types/models';
import type { NoteItem, NoteInput, NoteQueryOptions } from '../types/models';

/** 记事内容最大长度（与编辑页 maxlength 保持一致） */
export const MAX_CONTENT_LEN = 2000;

/** 记事业务错误 */
export class NotesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotesError';
  }
}

/**
 * 校验并归一化记事类型
 * @param kind 入参
 * @returns {NoteKind}
 * @throws {NotesError} 取值非法
 */
function normalizeKind(kind: unknown): NoteKind {
  if (kind === NoteKind.Plain || kind === NoteKind.Todo) return kind;
  throw new NotesError(`记事类型不合法：${String(kind)}`);
}

/**
 * 校验并归一化记事内容（去首尾空格，长度截断到上限）
 * @param content 入参
 * @returns {string}
 * @throws {NotesError} 内容为空
 */
function normalizeContent(content: unknown): string {
  const text = String(content ?? '').trim();
  if (!text) throw new NotesError('记事内容不能为空');
  return text.slice(0, MAX_CONTENT_LEN);
}

/**
 * 校验并归一化截止时间（毫秒时间戳）
 *
 * 口径：
 * - 正整数才有效；非法值（负数、非数字、NaN）一律视为「未设置」直接丢弃，不报错
 * - 0 是显式的「清除」语义（编辑页的可清除入口）
 * - 允许是过去的时间：设了就已逾期是合理状态
 *
 * @param dueTime 入参
 * @returns 大于 0 的整数毫秒时间戳，或 undefined（未设置）
 */
function normalizeDueTime(dueTime: unknown): number | undefined {
  if (typeof dueTime !== 'number' || !Number.isFinite(dueTime)) return undefined;
  const ts = Math.floor(dueTime);
  return ts > 0 ? ts : undefined;
}

export class NotesService {
  /**
   * 查询记事项，默认按创建时间倒序
   * @param opts 查询条件（类型 / 完成状态 / 关键词）
   * @returns NoteItem[]
   */
  static list(opts: NoteQueryOptions = {}): NoteItem[] {
    const all = StorageService.get(StorageKeys.NotesItems) ?? [];
    let list = Array.isArray(all) ? all.slice() : [];

    if (opts.kind) list = list.filter((n) => n.kind === opts.kind);
    if (opts.done !== undefined) list = list.filter((n) => n.done === opts.done);
    if (opts.keyword) {
      const kw = opts.keyword.trim().toLowerCase();
      list = list.filter((n) => n.content.toLowerCase().includes(kw));
    }
    return list.sort((a, b) => b.createTime - a.createTime);
  }

  /**
   * 新增记事项
   * @param input 表单输入
   * @returns 新增的记事项
   * @throws {NotesError} 入参不合法
   */
  static create(input: NoteInput): NoteItem {
    const ts = now();
    const kind = normalizeKind(input.kind ?? NoteKind.Plain);
    const item: NoteItem = {
      id: uid(),
      kind,
      content: normalizeContent(input.content),
      done: kind === NoteKind.Todo ? Boolean(input.done) : false,
      // 截止时间只在待办上有意义；普通笔记即使传了也丢弃
      dueTime:
        kind === NoteKind.Todo ? normalizeDueTime(input.dueTime) : undefined,
      createTime: ts,
      updateTime: ts,
      extra: {},
    };
    const all = StorageService.get(StorageKeys.NotesItems) ?? [];
    StorageService.set(StorageKeys.NotesItems, [item, ...all]);
    return item;
  }

  /**
   * 更新记事项
   * @param id 记事项 id
   * @param patch 待更新字段；未传入的字段保持原值
   * @returns 更新后的记事项
   * @throws {NotesError} 记录不存在或入参不合法
   */
  static update(id: string, patch: Partial<NoteInput>): NoteItem {
    const all = StorageService.get(StorageKeys.NotesItems) ?? [];
    const idx = all.findIndex((n) => n.id === id);
    if (idx < 0) throw new NotesError(`记事项不存在：${id}`);

    const prev = all[idx];
    const kind = patch.kind !== undefined ? normalizeKind(patch.kind) : prev.kind;
    const next: NoteItem = {
      ...prev,
      kind,
      updateTime: now(),
      done: kind === NoteKind.Todo ? (patch.done ?? prev.done) : false,
    };
    if (patch.content !== undefined) next.content = normalizeContent(patch.content);
    // 截止时间：未传保持原值；传了按归一化落值（0 / 非法 = 清除）。
    // 用 delete 保证「清除后」的持久化结构里真的没有这个字段，而不是残留一个 undefined
    if (kind === NoteKind.Todo && patch.dueTime !== undefined) {
      const due = normalizeDueTime(patch.dueTime);
      if (due) next.dueTime = due;
      else delete next.dueTime;
    } else if (kind !== NoteKind.Todo) {
      delete next.dueTime;
    }

    const updated = all.map((n, i) => (i === idx ? next : n));
    StorageService.set(StorageKeys.NotesItems, updated);
    return next;
  }

  /**
   * 切换待办完成状态（仅对 todo 生效）
   * @param id 记事项 id
   * @returns 更新后的记事项；普通笔记原样返回
   * @throws {NotesError} 记录不存在
   */
  static toggleDone(id: string): NoteItem {
    const all = StorageService.get(StorageKeys.NotesItems) ?? [];
    const idx = all.findIndex((n) => n.id === id);
    if (idx < 0) throw new NotesError(`记事项不存在：${id}`);

    const prev = all[idx];
    if (prev.kind !== NoteKind.Todo) return prev;

    const next: NoteItem = { ...prev, done: !prev.done, updateTime: now() };
    const updated = all.map((n, i) => (i === idx ? next : n));
    StorageService.set(StorageKeys.NotesItems, updated);
    return next;
  }

  /**
   * 删除记事项
   * @param id 记事项 id
   */
  static remove(id: string): void {
    const all = StorageService.get(StorageKeys.NotesItems) ?? [];
    StorageService.set(
      StorageKeys.NotesItems,
      all.filter((n) => n.id !== id)
    );
  }

  /**
   * 批量删除记事项（单次落盘）
   * @param ids 记事项 id 集合
   * @returns 被删掉的记事项（供「撤销」用）；无命中时返回空数组且不写库
   */
  static removeMany(ids: readonly string[]): NoteItem[] {
    if (!ids.length) return [];
    const all = StorageService.get(StorageKeys.NotesItems) ?? [];
    const set = new Set(ids);
    const removed = all.filter((n) => set.has(n.id));
    if (!removed.length) return [];
    StorageService.set(
      StorageKeys.NotesItems,
      all.filter((n) => !set.has(n.id))
    );
    return removed;
  }

  /**
   * 恢复记事项（撤销删除）
   *
   * 保留原 id / createTime / done 状态，恢复后与删除前一致。
   * 已存在的 id 会被跳过，避免重复插入。
   *
   * @param items 待恢复的记事项
   * @returns 实际恢复的条数
   */
  static restore(items: readonly NoteItem[]): number {
    if (!items.length) return 0;
    const all = StorageService.get(StorageKeys.NotesItems) ?? [];
    const exists = new Set(all.map((n) => n.id));
    const add = items.filter((n) => n && n.id && !exists.has(n.id));
    if (!add.length) return 0;
    StorageService.set(StorageKeys.NotesItems, [...all, ...add]);
    return add.length;
  }

  /**
   * 清空全部记事项（单次落盘）
   */
  static clear(): void {
    StorageService.set(StorageKeys.NotesItems, []);
  }

  /**
   * 统计未完成待办数量
   * @returns number
   */
  static pendingTodoCount(): number {
    return this.list({ kind: NoteKind.Todo, done: false }).length;
  }
}
