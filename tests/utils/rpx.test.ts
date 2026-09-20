import { SWIPE_ACTION_WIDTH_RPX, rpxToPx, swipeActionWidth } from '../../utils/rpx';

/** 直接改全局 wx（jest.setup.js 里那份手写 mock），用来模拟不同窗口宽度/缺失窗口信息 */
const g = globalThis as unknown as { wx: { getWindowInfo?: () => { windowWidth?: number } } };

/** 临时替换 getWindowInfo，跑完自动还原 */
function withWindowInfo(
  impl: (() => { windowWidth?: number }) | undefined,
  fn: () => void
): void {
  const original = g.wx.getWindowInfo;
  g.wx.getWindowInfo = impl;
  try {
    fn();
  } finally {
    g.wx.getWindowInfo = original;
  }
}

describe('rpx → px 换算', () => {
  test('按 750 基准换算（jest mock 的窗口宽是 375）', () => {
    expect(rpxToPx(750)).toBeCloseTo(375, 5);
    expect(rpxToPx(144)).toBeCloseTo(72, 5);
  });

  test('跟随窗口宽度（换成 414 就按 414 算）', () => {
    withWindowInfo(() => ({ windowWidth: 414 }), () => {
      expect(rpxToPx(144)).toBeCloseTo((144 * 414) / 750, 5);
    });
  });

  test('拿不到窗口信息时退回 375 基准，不抛异常', () => {
    withWindowInfo(undefined, () => {
      expect(rpxToPx(144)).toBeCloseTo(72, 5);
    });
  });

  test('滑开距离 = 操作块宽度（左右滑不露空白的充要条件）', () => {
    // app.wxss 里 .swipe-act 的 width 就是 144rpx，这个常量必须与它一起改
    expect(SWIPE_ACTION_WIDTH_RPX).toBe(144);
    expect(swipeActionWidth()).toBeCloseTo(rpxToPx(SWIPE_ACTION_WIDTH_RPX), 5);
    // van-swipe-cell 的两个 width 参数单位是 px，所以喂进去的必须是换算值而不是 144
    expect(swipeActionWidth()).not.toBe(SWIPE_ACTION_WIDTH_RPX);
  });
});
