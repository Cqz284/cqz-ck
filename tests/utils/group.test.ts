import { dayLabel, groupByDate } from '../../utils/group';
import { formatMoney } from '../../utils/money';
import { LedgerType } from '../../types/models';

/** 构造一条测试记录 */
function mk(id: string, type: LedgerType, amount: number, date: string): any {
  return { id, type, amount, date, createTime: 0, updateTime: 0, extra: {} };
}

describe('dayLabel', () => {
  test('相对说法只保留今天 / 昨天，且始终带月日', () => {
    expect(dayLabel('2026-09-17', '2026-09-17')).toBe('今天 9月17日');
    expect(dayLabel('2026-09-16', '2026-09-17')).toBe('昨天 9月16日');
  });

  test('前天不再出现，更早一律用月日', () => {
    expect(dayLabel('2026-09-15', '2026-09-17')).toBe('9月15日');
    expect(dayLabel('2026-09-01', '2026-09-17')).toBe('9月1日');
  });

  test('跨年带年份', () => {
    expect(dayLabel('2025-12-31', '2026-09-17')).toBe('2025年12月31日');
  });

  test('跨月计算正确', () => {
    expect(dayLabel('2026-08-31', '2026-09-02')).toBe('8月31日');
    expect(dayLabel('2026-09-01', '2026-09-02')).toBe('昨天 9月1日');
  });
});

describe('groupByDate', () => {
  test('按日期分组、统计当日收支、日期倒序', () => {
    const groups = groupByDate(
      [
        mk('a', LedgerType.Expense, 1234, '2026-09-17'),
        mk('b', LedgerType.Income, 500, '2026-09-17'),
        mk('c', LedgerType.Expense, 200, '2026-09-16'),
      ],
      '2026-09-17'
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].date).toBe('2026-09-17');
    expect(groups[0].label).toBe('今天 9月17日');
    expect(groups[0].income).toBe(500);
    expect(groups[0].expense).toBe(1234);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].date).toBe('2026-09-16');
    expect(groups[1].expense).toBe(200);
    expect(groups[1].income).toBe(0);
  });

  test('空列表返回空数组', () => {
    expect(groupByDate([], '2026-09-17')).toEqual([]);
  });
});

describe('formatMoney 千分位', () => {
  test('大额金额加千分位', () => {
    expect(formatMoney(123400)).toBe('¥1,234.00');
    expect(formatMoney(123456789)).toBe('¥1,234,567.89');
  });

  test('小额与零不受影响', () => {
    expect(formatMoney(1999)).toBe('¥19.99');
    expect(formatMoney(0)).toBe('¥0.00');
  });
});
