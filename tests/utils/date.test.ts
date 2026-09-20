/**
 * 日期工具单测
 *
 * 重点覆盖统计页「看某一天」依赖的日期运算：跨月、跨年、闰年边界，
 * 以及非法输入不抛异常（页面拿到脏数据也不该崩）。
 */
import { dateLabel, monthLabel, shiftDate, shiftMonth, weekdayLabel } from '../../utils/date';

describe('date · shiftDate', () => {
  test('同月内前后偏移', () => {
    expect(shiftDate('2026-09-15', 1)).toBe('2026-09-16');
    expect(shiftDate('2026-09-15', -1)).toBe('2026-09-14');
  });

  test('跨月与跨年', () => {
    expect(shiftDate('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
  });

  test('闰年 2 月边界', () => {
    expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDate('2024-02-29', 1)).toBe('2024-03-01');
    expect(shiftDate('2026-02-28', 1)).toBe('2026-03-01');
  });

  test('非法输入原样返回（不抛异常）', () => {
    expect(shiftDate('', 1)).toBe('');
    expect(shiftDate('bad', 1)).toBe('bad');
  });
});

describe('date · dateLabel / weekdayLabel', () => {
  test('日期文案不带前导零', () => {
    expect(dateLabel('2026-09-05')).toBe('2026年9月5日');
  });

  test('星期文案（2026-09-19 是周六）', () => {
    expect(weekdayLabel('2026-09-19')).toBe('周六');
    expect(weekdayLabel('2026-09-20')).toBe('周日');
  });

  test('日期非法时星期返回空串', () => {
    expect(weekdayLabel('')).toBe('');
  });
});

describe('date · 月份口径（整月模式复用）', () => {
  test('shiftMonth 跨年正确', () => {
    expect(shiftMonth('2026-09', -1)).toBe('2026-08');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  test('monthLabel 不带前导零', () => {
    expect(monthLabel('2026-09')).toBe('2026年9月');
  });
});
