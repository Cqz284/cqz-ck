/**
 * 快速标签业务层：记账页标签条的列表维护与"居中项"持久化
 *
 * 设计说明：
 * - 标签条是**循环轨道**：拖拽只会让标签绕环转动，环上相邻顺序永远不变，
 *   因此"真实换位并记住顺序"需要持久化的状态 = 标签列表 + 当前居中的标签。
 *   重进页面时按列表原序渲染、把 center 转到正中，即可完整还原离开时的排列。
 * - 新增标签一律追加到列表尾部（环上位于"+"号之前）。
 * - 写入走 StorageService（先落盘后缓存），失败抛 StorageError，缓存不被污染。
 */
import { StorageService, StorageKeys } from './storage';
import { MAX_TAG_LEN } from './ledger.service';
import type { QuickTagsStore } from '../types/models';

/** 默认快速标签（与历史硬编码一致，作为首次使用的初始环） */
export const DEFAULT_QUICK_TAGS: readonly string[] = ['餐饮', '交通', '购物', '娱乐', '医疗', '工资'];

/** 快速标签总数上限（含默认标签与"+"号以外的全部项） */
export const MAX_QUICK_TAGS = 20;

/** 快速标签业务错误（入参不合法 / 重复 / 超上限） */
export class TagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TagError';
  }
}

/**
 * 宽松清洗：读取旧数据时逐项修剪，静默丢弃空值/超长/重复项
 * @param raw 存储中的原始列表
 * @returns 清洗后的标签列表
 */
function sanitizeList(raw: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const item of raw) {
    const text = String(item ?? '').trim();
    if (!text || text.length > MAX_TAG_LEN || seen.has(text)) continue;
    seen.add(text);
    list.push(text);
  }
  return list;
}

/**
 * 严格校验单个标签：修剪前后空白，拒绝空值与超长
 * @param input 入参
 * @returns {string} 归一化后的标签
 * @throws {TagError} 空值或超过 MAX_TAG_LEN
 */
function normalizeOne(input: unknown): string {
  const text = String(input ?? '').trim();
  if (!text) throw new TagError('标签不能为空');
  if (text.length > MAX_TAG_LEN) throw new TagError(`标签最多 ${MAX_TAG_LEN} 个字`);
  return text;
}

export class TagService {
  /**
   * 读取标签列表
   *
   * 注意"未存储"与"存储为空"的区别：前者是首次使用，返回默认列表；
   * 后者是用户把标签删光了，必须如实返回空数组，否则删掉的标签会"复活"。
   *
   * @returns 标签列表（新数组，调用方可安全持有）
   */
  static get(): string[] {
    const stored = StorageService.get(StorageKeys.QuickTags);
    if (!stored) return [...DEFAULT_QUICK_TAGS];
    return sanitizeList(stored.tags ?? []);
  }

  /**
   * 读取居中标签；未存储、已失效（不在列表中）时返回空串
   * @returns 居中标签
   */
  static getCenter(): string {
    const stored = StorageService.get(StorageKeys.QuickTags);
    if (!stored?.center) return '';
    const center = String(stored.center);
    return this.get().includes(center) ? center : '';
  }

  /**
   * 记录居中标签（循环轮转后的"顺序"状态）
   * @param tag 停在正中的标签（须在列表中）
   * @throws {TagError} 标签不在列表中
   */
  static setCenter(tag: string): void {
    const list = this.get();
    if (!list.includes(tag)) throw new TagError(`标签不存在：${tag}`);
    StorageService.set(StorageKeys.QuickTags, { tags: list, center: tag });
  }

  /**
   * 新增标签：追加到列表尾部并保持居中项不变
   * @param input 待新增的标签
   * @returns {string[]} 更新后的列表
   * @throws {TagError} 空值 / 超长 / 重复 / 超上限
   */
  static add(input: unknown): string[] {
    const tag = normalizeOne(input);
    const list = this.get();
    if (list.includes(tag)) throw new TagError(`「${tag}」已经有了`);
    if (list.length >= MAX_QUICK_TAGS) throw new TagError(`最多 ${MAX_QUICK_TAGS} 个标签`);

    const center = this.getCenter();
    const next: QuickTagsStore = { tags: [...list, tag], center };
    StorageService.set(StorageKeys.QuickTags, next);
    return next.tags;
  }

  /**
   * 删除标签；若被删的正是居中项，则清空居中记录（由调用方决定新的居中项）
   * @param input 待删除的标签
   * @returns {string[]} 更新后的列表（可能为空）
   * @throws {TagError} 标签不存在
   */
  static remove(input: unknown): string[] {
    const tag = normalizeOne(input);
    const list = this.get();
    if (!list.includes(tag)) throw new TagError(`标签不存在：${tag}`);

    const next = list.filter((t) => t !== tag);
    const center = this.getCenter();
    StorageService.set(StorageKeys.QuickTags, {
      tags: next,
      center: next.includes(center) ? center : '',
    });
    return next;
  }

  /**
   * 恢复默认标签（允许用户在删空后随时找回）
   * @returns {string[]} 默认标签列表
   */
  static resetDefaults(): string[] {
    const list = [...DEFAULT_QUICK_TAGS];
    const center = this.getCenter();
    StorageService.set(StorageKeys.QuickTags, {
      tags: list,
      center: list.includes(center) ? center : '',
    });
    return list;
  }

  /**
   * 整体保存（供测试与未来的排序能力使用）：逐项严格校验、去重、限量
   * @param input 待保存的列表（允许为空：用户可以把标签删光）
   * @returns {string[]} 归一化后的列表
   * @throws {TagError} 任一项非法或超上限
   */
  static save(input: readonly unknown[]): string[] {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const item of input) {
      const tag = normalizeOne(item);
      if (seen.has(tag)) continue;
      if (list.length >= MAX_QUICK_TAGS) throw new TagError(`最多 ${MAX_QUICK_TAGS} 个标签`);
      seen.add(tag);
      list.push(tag);
    }
    const center = this.getCenter();
    StorageService.set(StorageKeys.QuickTags, {
      tags: list,
      center: list.includes(center) ? center : '',
    });
    return list;
  }
}
