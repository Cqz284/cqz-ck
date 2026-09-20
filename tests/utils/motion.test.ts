import { easeOutCubic, tweenValue, countUp, COUNT_UP_FRAMES } from '../../utils/motion';
import { haptic, setHapticsEnabled, isHapticsEnabled } from '../../utils/haptics';
import { hintOnce, resetHints } from '../../utils/hint';

describe('motion · 缓动与取值', () => {
  test('easeOutCubic 端点与单调性', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    // 缓动越界要被夹紧，避免进度抖动算出越界值
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);

    let prev = -1;
    for (let i = 0; i <= 10; i++) {
      const v = easeOutCubic(i / 10);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  test('tweenValue 首尾精确落位、中间值在区间内', () => {
    expect(tweenValue(100, 900, 0)).toBe(100);
    expect(tweenValue(100, 900, 1)).toBe(900);

    const mid = tweenValue(0, 1000, 0.5);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1000);

    // 金额单位为分：结果必须是整数，不能出现 0.5 分
    for (let i = 0; i <= 20; i++) {
      const v = tweenValue(-1337, 999, i / 20);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  test('tweenValue 对非有限值兜底为目标值', () => {
    expect(tweenValue(NaN, 500, 0.5)).toBe(500);
    expect(tweenValue(0, NaN, 0.5)).toBeNaN();
  });
});

describe('motion · 数字滚动', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('起止值相同则立即落位，不启动定时器', () => {
    const frames: number[] = [];
    countUp(200, 200, (v) => frames.push(v));
    expect(frames).toEqual([200]);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('滚动过程中逐帧回调，最终精确落在目标值', () => {
    const frames: number[] = [];
    countUp(0, 1200, (v) => frames.push(v));

    jest.advanceTimersByTime(1000);

    expect(frames.length).toBeGreaterThan(1);
    expect(frames[frames.length - 1]).toBe(1200);
    // 帧数受控（固定帧数而非无限 setData）
    expect(frames.length).toBeLessThanOrEqual(COUNT_UP_FRAMES + 1);
  });

  test('取消后不再回调（页面卸载 / 重新刷新时必须能停）', () => {
    const frames: number[] = [];
    const cancel = countUp(0, 1200, (v) => frames.push(v));
    jest.advanceTimersByTime(50);
    const countAfterCancel = frames.length;
    cancel();
    jest.advanceTimersByTime(1000);
    expect(frames.length).toBe(countAfterCancel);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('haptics · 震动反馈', () => {
  afterEach(() => setHapticsEnabled(true));

  test('按强度档位调用 vibrateShort', () => {
    const spy = jest.spyOn(wx, 'vibrateShort');
    haptic();
    haptic('medium');
    haptic('heavy');
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0][0]).toMatchObject({ type: 'light' });
    expect(spy.mock.calls[1][0]).toMatchObject({ type: 'medium' });
    expect(spy.mock.calls[2][0]).toMatchObject({ type: 'heavy' });
    spy.mockRestore();
  });

  test('关闭后不再震动', () => {
    setHapticsEnabled(false);
    expect(isHapticsEnabled()).toBe(false);
    const spy = jest.spyOn(wx, 'vibrateShort');
    haptic('heavy');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('宿主不支持 vibrateShort 时不抛错', () => {
    const original = wx.vibrateShort;
    // @ts-expect-error 故意删掉实现，模拟旧基础库
    delete wx.vibrateShort;
    expect(() => haptic('heavy')).not.toThrow();
    wx.vibrateShort = original;
  });
});

describe('hint · 一次性提示', () => {
  beforeEach(() => resetHints());

  test('同一 key 只提示一次', () => {
    const spy = jest.spyOn(wx, 'showToast');
    hintOnce('demo', '长按可编辑');
    hintOnce('demo', '长按可编辑');
    hintOnce('other', '另一条');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toMatchObject({ title: '长按可编辑', icon: 'none' });
    spy.mockRestore();
  });
});
