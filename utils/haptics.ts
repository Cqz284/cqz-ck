/**
 * 触觉反馈（震动）统一入口
 *
 * 三级强度约定，避免每个页面各写一套"这里该不该震"的含糊判断：
 * - light  ：点选类轻反馈——切换收支类型 / 切换筛选 tab / 选中标签 / 打开弹窗 / 无效点击提示
 * - medium ：状态变更成功——保存成功 / 勾选待办 / 恢复默认标签 / 新增成功
 * - heavy  ：破坏性操作与重手势——删除确认 / 长按进入编辑或管理态
 *
 * 真机才有触感：开发者工具与部分低端机型不支持强度档位（会走 fail 回调），
 * 因此所有异常一律静默忽略，绝不因为"震不动"影响主流程。
 */

/** 震动强度 */
export type HapticLevel = 'light' | 'medium' | 'heavy';

/** 全局开关（预留：后续若在「我的」里加震动开关，直接接这里） */
let enabled = true;

/**
 * 设置是否启用震动反馈
 * @param value 是否启用
 */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

/**
 * 当前是否启用震动反馈
 * @returns boolean
 */
export function isHapticsEnabled(): boolean {
  return enabled;
}

/**
 * 触发一次震动反馈
 * @param level 强度，默认 light
 */
export function haptic(level: HapticLevel = 'light'): void {
  if (!enabled) return;
  // 单元测试与部分宿主环境没有 wx，或旧基础库没有 vibrateShort
  if (typeof wx === 'undefined' || typeof wx.vibrateShort !== 'function') return;
  try {
    wx.vibrateShort({ type: level, fail: () => {} });
  } catch {
    // 设备不支持震动时忽略
  }
}
