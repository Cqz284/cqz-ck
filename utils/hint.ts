/**
 * 一次性轻提示
 *
 * 用于"点击不再有反应、但要教会用户新交互"的场景：
 * 列表改成「长按编辑」后，用户点一下没有任何反馈会以为坏了，
 * 因此在第一次无效点击时给一次提示，之后同一会话不再打扰。
 */

/** 已提示过的 key */
const shown = new Set<string>();

/**
 * 弹出一次性提示（同一 key 在小程序生命周期内只弹一次）
 * @param key 去重键
 * @param title 提示文案
 */
export function hintOnce(key: string, title: string): void {
  if (shown.has(key)) return;
  shown.add(key);
  try {
    wx.showToast({ title, icon: 'none', duration: 1800 });
  } catch {
    // 宿主环境异常时忽略，提示本身不该影响功能
  }
}

/** 清空提示记录（仅测试与调试用） */
export function resetHints(): void {
  shown.clear();
}
