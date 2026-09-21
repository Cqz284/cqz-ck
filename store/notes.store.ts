/**
 * 记事状态层：跨页面共享的记事数据
 */
import { observable, action } from 'mobx-miniprogram';
import { NotesService } from '../service/notes.service';
import { NoteKind } from '../types/models';
import type { NoteItem, NoteInput } from '../types/models';

/** 列表筛选条件 */
export type NotesFilter = 'all' | NoteKind;

/** 记事 store 的形状（显式声明以保留 this 的类型信息） */
export interface NotesStore {
  /** 全部记事项（按创建时间倒序） */
  items: NoteItem[];
  /** 搜索关键词 */
  searchKeyword: string;
  /** 列表筛选：全部 / 待办 / 普通 */
  filter: NotesFilter;
  /** 一次性落点意图（-1 = 无）：首页入口希望记事页落到的 tab 序号 */
  pendingTab: number;
  /** 是否加载中 */
  loading: boolean;
  /** 按关键词与筛选条件过滤后的列表 */
  readonly visibleItems: NoteItem[];
  /** 未完成待办数量 */
  readonly pendingCount: number;
  /** 全部数量 */
  readonly totalCount: number;
  /** 从本地存储加载数据 */
  load(): void;
  /** 新增记事 */
  add(input: NoteInput): NoteItem;
  /** 编辑记事 */
  edit(id: string, patch: Partial<NoteInput>): NoteItem;
  /** 切换待办完成状态 */
  toggleDone(id: string): NoteItem;
  /** 删除记事 */
  remove(id: string): void;
  /**
   * 批量删除记事
   * @param ids 记事项 id 集合
   * @returns 被删掉的记事项（供撤销用）
   */
  removeMany(ids: readonly string[]): NoteItem[];
  /**
   * 恢复记事（撤销删除）
   * @param items 待恢复的记事项
   */
  restore(items: readonly NoteItem[]): void;
  /** 设置搜索关键词 */
  setSearchKeyword(kw: string): void;
  /** 设置筛选类型 */
  setFilter(filter: NotesFilter): void;
  /**
   * 一次性落点意图：首页「待办清单」等入口希望记事页落到的 tab 序号（-1 = 无）。
   * switchTab 不能带参数，跨页传 tab 落点只能走共享状态；
   * 只生效一次（记事页 onShow 读取后立即清掉），平时切换不受影响。
   */
  setPendingTab(index: number): void;
  /** 清空全部记事 */
  clearAll(): void;
}

export const notesStore = observable({
  /** 全部记事项（按创建时间倒序） */
  items: [] as NoteItem[],
  /** 搜索关键词 */
  searchKeyword: '',
  /** 列表筛选：全部 / 待办 / 普通 */
  filter: 'all' as NotesFilter,
  /** 一次性落点意图（-1 = 无）：首页入口希望记事页落到的 tab 序号 */
  pendingTab: -1,
  /** 是否加载中 */
  loading: false,

  /** 按关键词与筛选条件过滤后的列表 */
  get visibleItems(): NoteItem[] {
    const kw = this.searchKeyword.trim().toLowerCase();
    return this.items.filter((n) => {
      if (this.filter !== 'all' && n.kind !== this.filter) return false;
      if (
        kw &&
        !n.content.toLowerCase().includes(kw) &&
        !(n.tags ?? []).some((t) => t.toLowerCase().includes(kw))
      )
        return false;
      return true;
    });
  },

  /** 未完成待办数量 */
  get pendingCount(): number {
    return this.items.filter((n) => n.kind === NoteKind.Todo && !n.done).length;
  },

  /** 全部数量 */
  get totalCount(): number {
    return this.items.length;
  },

  /** 从本地存储加载数据 */
  load: action(function (this: NotesStore) {
    this.loading = true;
    try {
      this.items = NotesService.list();
    } finally {
      this.loading = false;
    }
  }),

  /** 新增记事 */
  add: action(function (this: NotesStore, input: NoteInput) {
    const item = NotesService.create(input);
    this.items = [item, ...this.items];
    return item;
  }),

  /** 编辑记事 */
  edit: action(function (this: NotesStore, id: string, patch: Partial<NoteInput>) {
    const next = NotesService.update(id, patch);
    this.items = this.items.map((n) => (n.id === id ? next : n));
    return next;
  }),

  /** 切换待办完成状态 */
  toggleDone: action(function (this: NotesStore, id: string) {
    const next = NotesService.toggleDone(id);
    this.items = this.items.map((n) => (n.id === id ? next : n));
    return next;
  }),

  /** 删除记事 */
  remove: action(function (this: NotesStore, id: string) {
    NotesService.remove(id);
    this.items = this.items.filter((n) => n.id !== id);
  }),

  /** 批量删除记事（单次落盘；返回被删项供撤销） */
  removeMany: action(function (this: NotesStore, ids: readonly string[]) {
    const removed = NotesService.removeMany(ids);
    if (removed.length) {
      const set = new Set(removed.map((n) => n.id));
      this.items = this.items.filter((n) => !set.has(n.id));
    }
    return removed;
  }),

  /** 恢复记事（撤销删除）：直接从存储重读，排序口径自动对齐 */
  restore: action(function (this: NotesStore, items: readonly NoteItem[]) {
    if (!NotesService.restore(items)) return;
    this.items = NotesService.list();
  }),

  /** 设置搜索关键词 */
  setSearchKeyword: action(function (this: NotesStore, kw: string) {
    this.searchKeyword = kw;
  }),

  /** 设置筛选类型 */
  setFilter: action(function (this: NotesStore, filter: NotesFilter) {
    this.filter = filter;
  }),

  /** 记一次性落点意图（记事页 onShow 读取后用 setPendingTab(-1) 清掉） */
  setPendingTab: action(function (this: NotesStore, index: number) {
    this.pendingTab = index;
  }),

  /** 清空全部记事（单次落盘，避免逐条删除的 O(n²) 写入） */
  clearAll: action(function (this: NotesStore) {
    NotesService.clear();
    this.items = [];
  }),
}) as NotesStore;
