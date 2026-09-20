/**
 * 设置状态层
 *
 * 注意：设置里凡是"会影响全局行为"的字段，都要在这里落地生效，
 * 而不是只写进存储——否则改了开关要重启小程序才生效。
 * 目前需要即时生效的是震动反馈（见 utils/haptics）。
 * （主题不做开关，始终跟随系统，由 utils/theme 自己监听系统变化。）
 */
import { observable, action } from 'mobx-miniprogram';
import { SettingsService, DEFAULT_SETTINGS } from '../service/settings.service';
import { setHapticsEnabled } from '../utils/haptics';
import type { BaseSettings } from '../types/models';

/** 设置 store 的形状（显式声明以保留 this 的类型信息） */
export interface SettingsStore {
  /** 基础设置 */
  settings: BaseSettings;
  /** 读取设置 */
  load(): void;
  /** 更新设置 */
  update(patch: Partial<BaseSettings>): void;
  /** 恢复默认 */
  reset(): void;
}

/**
 * 把设置同步到运行时开关
 * @param s 最新设置
 */
function applyRuntime(s: BaseSettings): void {
  setHapticsEnabled(s.haptics);
}

export const settingsStore = observable({
  /** 基础设置：初值直接复用 service 的常量，避免两处各写一份默认值 */
  settings: { ...DEFAULT_SETTINGS, extra: {} } as BaseSettings,

  /** 读取设置 */
  load: action(function (this: SettingsStore) {
    this.settings = SettingsService.get();
    applyRuntime(this.settings);
  }),

  /** 更新设置 */
  update: action(function (this: SettingsStore, patch: Partial<BaseSettings>) {
    this.settings = SettingsService.update(patch);
    applyRuntime(this.settings);
  }),

  /** 恢复默认 */
  reset: action(function (this: SettingsStore) {
    this.settings = SettingsService.reset();
    applyRuntime(this.settings);
  }),
}) as SettingsStore;
