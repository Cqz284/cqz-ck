/**
 * rpx ↔ px 的桥
 *
 * 为什么需要它：`van-swipe-cell` 的 `left-width` / `right-width` **单位是 px**——
 * vendor 内部直接把它拼进 `translate3d(...px)`，并用它夹取滑动位移与判定开合阈值。
 * 而设计尺寸与 wxss 里的值都是 rpx。两者混用会出现"卡片滑开 144px、操作块却只有 72px"，
 * 滑开后块的外侧就露出一条与差额等宽的空白（左右两个方向都会）。
 *
 * 所以：**滑开距离必须喂换算后的 px**，操作块宽度继续用 rpx 写样式，两边就严丝合缝。
 *
 * 换算关系：750rpx = 屏幕宽度，故 px = rpx × windowWidth / 750。
 */

/** 拿不到窗口信息时的兜底屏宽（px），仅用于异常环境与单元测试 */
const FALLBACK_WINDOW_WIDTH = 375;

/**
 * rpx → px
 * @param rpx 设计尺寸
 * @returns 换算后的 px（保留小数，不四舍五入：与 wxss 的 rpx 换算结果完全对齐，避免 1px 级缝隙）
 */
export function rpxToPx(rpx: number): number {
  let width = FALLBACK_WINDOW_WIDTH;
  try {
    if (typeof wx !== 'undefined' && typeof wx.getWindowInfo === 'function') {
      const info = wx.getWindowInfo();
      if (info && info.windowWidth) width = info.windowWidth;
    }
  } catch {
    // 极端环境拿不到窗口信息：用兜底屏宽，几何依然自洽（只是绝对值不同）
  }
  return (rpx * width) / 750;
}

/** 滑动操作块的设计宽度（rpx）。必须与 app.wxss 里 .swipe-act 的 width 一致 */
export const SWIPE_ACTION_WIDTH_RPX = 144;

/**
 * 滑动操作块的滑开距离（px）
 *
 * 直接喂给 `van-swipe-cell` 的 `left-width` / `right-width`：
 * 滑开多少 px，就露出多宽的块，块的外缘正好落在卡片闭合时的栅格线上。
 *
 * @returns px
 */
export function swipeActionWidth(): number {
  return rpxToPx(SWIPE_ACTION_WIDTH_RPX);
}
