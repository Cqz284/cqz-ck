/**
 * 备份与恢复：机器可读的全量数据备份（区别于 utils/export.ts 的人读文本导出）
 *
 * 设计说明：
 * - 备份导出**原始持久化结构**（金额为分、保留原 id / createTime），
 *   这样导入后记录与备份前完全一致，双机互备也不会产生重复。
 * - 解析端逐条清洗：坏数据**静默丢弃并计数**，不让一条脏记录毁掉整个导入。
 * - 两种导入模式（用户每次选择）：
 *   · merge    合并去重：按 id 跳过本机已有；快速标签仅在本机从未自定义过时导入；设置不动
 *   · overwrite 覆盖导入：记账、记事、快速标签、设置四项全部替换为备份内容（换机迁移）
 */
import { StorageService, StorageKeys } from '../service/storage';
import { LedgerService, MAX_TAG_LEN, MAX_REMARK_LEN } from '../service/ledger.service';
import { NotesService, MAX_CONTENT_LEN, normalizeTags } from '../service/notes.service';
import { SettingsService } from '../service/settings.service';
import { MAX_QUICK_TAGS } from '../service/tag.service';
import { LedgerType, NoteKind } from '../types/models';
import type { BaseSettings, LedgerRecord, NoteItem, QuickTagsStore } from '../types/models';
import { MAX_YUAN } from './money';
import { format } from './date';

/** 备份标识：导入时校验，防止把别的应用的 JSON 灌进来 */
export const BACKUP_APP = 'ledger-notes';
/**
 * 备份格式版本：将来字段结构变化时递增，旧版本按兼容规则处理。
 * v2（2026-09-21）：NoteItem 增加 tags 字段；v1 备份没有 tags，导入时按"无标签"处理。
 */
export const BACKUP_VERSION = 2;

/** 单条记账金额上限（分），与 LedgerService 的口径一致 */
const MAX_AMOUNT_FEN = MAX_YUAN * 100;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** 备份业务错误（格式不合法 / 应用不匹配 / 版本不兼容） */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

/** 备份文件结构 */
export interface BackupPayload {
  app: string;
  version: number;
  /** 导出时间 YYYY-MM-DD HH:mm */
  exportedAt: string;
  records: LedgerRecord[];
  notes: NoteItem[];
  /** 快速标签；null 表示导出设备从未自定义过（保持读取默认标签的行为） */
  quickTags: QuickTagsStore | null;
  /** 基础设置；异常时为 null（覆盖导入会跳过设置项） */
  settings: BaseSettings | null;
}

/** 解析结果：清洗后的数据 + 被丢弃的脏数据计数 */
export interface ParsedBackup {
  payload: BackupPayload;
  dropped: { records: number; notes: number };
}

/** 导入结果：实际生效的条数 */
export interface ApplyResult {
  addedRecords: number;
  addedNotes: number;
}

/**
 * 生成全量备份 JSON
 * @returns json 文本 + 条数统计（供 UI 提示）
 */
export function buildBackup(): { json: string; counts: { records: number; notes: number } } {
  const payload: BackupPayload = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: format(Date.now(), 'YYYY-MM-DD HH:mm'),
    // list() 返回的是存储数据的浅拷贝，直接进 JSON 即可
    records: LedgerService.list(),
    notes: NotesService.list(),
    // 未自定义过时存储里没有这个 key，导出 null（导入端还原成"未自定义"）
    quickTags: StorageService.get(StorageKeys.QuickTags) ?? null,
    settings: SettingsService.get(),
  };
  return {
    json: JSON.stringify(payload),
    counts: { records: payload.records.length, notes: payload.notes.length },
  };
}

/**
 * 解析并清洗备份文本
 * @param text 备份 JSON 文本（来自文件或剪贴板）
 * @returns 清洗后的数据 + 丢弃计数
 * @throws {BackupError} JSON 非法 / 应用不匹配 / 版本不兼容
 */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(String(text ?? ''));
  } catch {
    throw new BackupError('备份内容不是有效的 JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BackupError('备份格式不正确');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.app !== BACKUP_APP) throw new BackupError('这不是本应用的备份文件');

  const version = Number(obj.version);
  if (!Number.isInteger(version) || version < 1 || version > BACKUP_VERSION) {
    throw new BackupError('备份版本不兼容，请把小程序更新到最新版');
  }

  const records: LedgerRecord[] = [];
  const seenRecordIds = new Set<string>();
  let droppedRecords = 0;
  const rawRecords = Array.isArray(obj.records) ? obj.records : [];
  rawRecords.forEach((item) => {
    const r = normalizeRecord(item);
    if (!r) {
      droppedRecords += 1;
      return;
    }
    if (seenRecordIds.has(r.id)) return; // 备份内部重复 id：保留首条
    seenRecordIds.add(r.id);
    records.push(r);
  });

  const notes: NoteItem[] = [];
  const seenNoteIds = new Set<string>();
  let droppedNotes = 0;
  const rawNotes = Array.isArray(obj.notes) ? obj.notes : [];
  rawNotes.forEach((item) => {
    const n = normalizeNote(item);
    if (!n) {
      droppedNotes += 1;
      return;
    }
    if (seenNoteIds.has(n.id)) return;
    seenNoteIds.add(n.id);
    notes.push(n);
  });

  return {
    payload: {
      app: BACKUP_APP,
      version,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
      records,
      notes,
      quickTags: normalizeQuickTags(obj.quickTags),
      settings: normalizeSettings(obj.settings),
    },
    dropped: { records: droppedRecords, notes: droppedNotes },
  };
}

/**
 * 应用备份到本机
 * @param payload parseBackup 清洗后的数据
 * @param mode 'merge' 合并去重 | 'overwrite' 覆盖导入
 * @returns 实际生效的条数
 */
export function applyBackup(payload: BackupPayload, mode: 'merge' | 'overwrite'): ApplyResult {
  if (mode === 'overwrite') {
    LedgerService.clear();
    NotesService.clear();
    if (payload.records.length) LedgerService.restore(payload.records);
    if (payload.notes.length) NotesService.restore(payload.notes);
    if (payload.quickTags) {
      StorageService.set(StorageKeys.QuickTags, payload.quickTags);
    } else {
      // 备份设备未自定义过标签：删除本机的自定义，让 TagService 回落到默认标签
      StorageService.remove(StorageKeys.QuickTags);
    }
    if (payload.settings) SettingsService.update(payload.settings);
    return { addedRecords: payload.records.length, addedNotes: payload.notes.length };
  }

  // merge：restore 内部按 id 跳过本机已有的记录，返回实际补入条数
  const addedRecords = LedgerService.restore(payload.records);
  const addedNotes = NotesService.restore(payload.notes);
  // 快速标签只在本机从未自定义过时才导入，避免双机互备时互相覆盖对方的轨道
  if (payload.quickTags && !StorageService.get(StorageKeys.QuickTags)) {
    StorageService.set(StorageKeys.QuickTags, payload.quickTags);
  }
  return { addedRecords, addedNotes };
}

/* ---------------- 清洗工具（与各 service 的校验口径保持一致） ---------------- */

/**
 * 清洗单条记账记录；不合法返回 null（调用方计数丢弃）
 * @param item 备份中的原始条目
 */
function normalizeRecord(item: unknown): LedgerRecord | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;

  const id = typeof o.id === 'string' ? o.id.trim() : '';
  if (!id) return null;
  if (o.type !== LedgerType.Income && o.type !== LedgerType.Expense) return null;

  const amount = Number(o.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT_FEN) return null;

  const date = String(o.date ?? '');
  if (!DATE_RE.test(date)) return null;

  const time = typeof o.time === 'string' && TIME_RE.test(o.time) ? o.time : undefined;
  // 时间戳缺失/非法时兜底为当前时间（保持记录可用，排序依据仍成立）
  const createTime = toTimestamp(o.createTime) ?? Date.now();
  const updateTime = toTimestamp(o.updateTime) ?? createTime;
  // extra 只收对象：防止备份里塞进数组/标量后污染读取方
  const extra = o.extra && typeof o.extra === 'object' && !Array.isArray(o.extra)
    ? (o.extra as Record<string, unknown>)
    : {};

  return {
    id,
    type: o.type,
    amount,
    tag: normalizeText(o.tag, MAX_TAG_LEN) || undefined,
    remark: normalizeText(o.remark, MAX_REMARK_LEN) || undefined,
    date,
    time,
    createTime,
    updateTime,
    extra,
  };
}

/**
 * 清洗单条记事项；不合法返回 null
 * @param item 备份中的原始条目
 */
function normalizeNote(item: unknown): NoteItem | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;

  const id = typeof o.id === 'string' ? o.id.trim() : '';
  if (!id) return null;
  if (o.kind !== NoteKind.Plain && o.kind !== NoteKind.Todo) return null;

  const content = normalizeText(o.content, MAX_CONTENT_LEN);
  if (!content) return null;

  const createTime = toTimestamp(o.createTime) ?? Date.now();
  const updateTime = toTimestamp(o.updateTime) ?? createTime;
  // 截止时间：正数才保留（普通笔记上出现也原样保留，导入端语义与存储一致）
  const dueTime = toTimestamp(o.dueTime);
  const extra = o.extra && typeof o.extra === 'object' && !Array.isArray(o.extra)
    ? (o.extra as Record<string, unknown>)
    : {};

  const note: NoteItem = {
    id,
    kind: o.kind,
    content,
    // 普通笔记恒为 false（与 NotesService 口径一致）
    done: o.kind === NoteKind.Todo ? o.done === true : false,
    createTime,
    updateTime,
    extra,
  };
  if (dueTime && dueTime > 0) note.dueTime = dueTime;
  // 标签：v1 备份没有该字段（undefined → 不落）；v2 逐个清洗（去空格/截断/去重/限个）
  const tags = normalizeTags(o.tags);
  if (tags) note.tags = tags;
  return note;
}

/**
 * 清洗快速标签（与 TagService.sanitizeList 同口径，但不落库）
 * @param raw 备份中的原始值
 */
function normalizeQuickTags(raw: unknown): QuickTagsStore | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.tags)) return null;

  const seen = new Set<string>();
  const tags: string[] = [];
  o.tags.forEach((item) => {
    const text = normalizeText(item, 20);
    if (!text || seen.has(text) || tags.length >= MAX_QUICK_TAGS) return;
    seen.add(text);
    tags.push(text);
  });
  const center = normalizeText(o.center, 20);
  return { tags, center: tags.includes(center) ? center : '' };
}

/**
 * 清洗设置：只挑已知字段，交给 SettingsService.update 做最终归一化
 * @param raw 备份中的原始值
 */
function normalizeSettings(raw: unknown): BaseSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const extra = o.extra && typeof o.extra === 'object' && !Array.isArray(o.extra)
    ? (o.extra as Record<string, unknown>)
    : {};
  return {
    currency: String(o.currency ?? '¥') || '¥',
    haptics: o.haptics !== false,
    monthlyBudget: Number(o.monthlyBudget) || 0,
    dailyBudget: Number(o.dailyBudget) || 0,
    extra,
  };
}

/** 文本字段：去空格 + 截断（与 service 的 normalizeText 同口径） */
function normalizeText(value: unknown, maxLen: number): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLen);
}

/** 时间戳清洗：非法时返回 null，由调用方兜底 */
function toTimestamp(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
