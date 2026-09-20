/**
 * 设置业务层：基础设置的读取与更新
 *
 * 这里同时承担**旧数据归一化**：新增字段后，存储里的老数据缺字段或字段非法，
 * 都由 normalizeSettings 统一收口，读取处（store / 页面）拿到的永远是完整合法的设置。
 */
import { StorageService, StorageKeys } from './storage';
import { MAX_YUAN } from '../utils/money';
import type { BaseSettings } from '../types/models';

/** 默认设置（视作常量，任何出口都必须返回副本，避免被调用方改坏） */
export const DEFAULT_SETTINGS: Readonly<BaseSettings> = {
  currency: '¥',
  haptics: true,
  monthlyBudget: 0,
  dailyBudget: 0,
  extra: {},
};

/** 额度上限：与单笔金额上限一致（100 万元） */
const MAX_BUDGET_FEN = MAX_YUAN * 100;

/**
 * 归一化额度（分）：非有限数 / 负数 / 超上限一律收口
 * - 负数与非数字 → 0（视为未设置），而不是抛错：额度是"锦上添花"的设置项，
 *   不该因为一条脏数据让整个设置读取失败
 * @param value 待校验的值
 * @returns 分（>= 0 的整数）
 */
function normalizeBudget(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), MAX_BUDGET_FEN);
}

/**
 * 把任意来源的设置归一化成完整合法的设置
 * @param s 源设置（可能缺字段 / 字段非法）
 * @returns 新的设置对象（extra 也是新对象）
 */
function normalizeSettings(s: Readonly<BaseSettings>): BaseSettings {
  // 逐字段拷贝，而不是展开 s：
  // 老版本遗留的未知字段（例如已移除的 themeMode）不该被重新写回存储，
  // 否则它会一直跟着这条记录漂下去，每处判断都要多问一句"这是啥"
  return {
    currency: String(s.currency ?? DEFAULT_SETTINGS.currency) || DEFAULT_SETTINGS.currency,
    // 布尔开关统一收口：传进来非布尔值也不会写坏存储（只有显式 false 才算关闭）
    haptics: s.haptics !== false,
    monthlyBudget: normalizeBudget(s.monthlyBudget),
    dailyBudget: normalizeBudget(s.dailyBudget),
    extra: { ...(s.extra ?? {}) },
  };
}

export class SettingsService {
  /**
   * 读取设置，未存储时返回默认值的副本
   * @returns BaseSettings
   */
  static get(): BaseSettings {
    const stored = StorageService.get(StorageKeys.SettingsBase);
    if (!stored) return normalizeSettings(DEFAULT_SETTINGS);
    return normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...stored,
      extra: { ...DEFAULT_SETTINGS.extra, ...(stored.extra ?? {}) },
    });
  }

  /**
   * 局部更新设置
   * @param patch 待更新字段
   * @returns 更新后的设置
   */
  static update(patch: Partial<BaseSettings>): BaseSettings {
    const next = normalizeSettings({ ...this.get(), ...patch });
    StorageService.set(StorageKeys.SettingsBase, next);
    return next;
  }

  /**
   * 恢复默认设置
   * @returns BaseSettings
   */
  static reset(): BaseSettings {
    const next = normalizeSettings(DEFAULT_SETTINGS);
    StorageService.set(StorageKeys.SettingsBase, next);
    return normalizeSettings(next);
  }
}
