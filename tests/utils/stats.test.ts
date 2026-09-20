/**
 * 统计聚合测试：sumByCategory / pickByLabels / labelOf
 *
 * 这两个函数是「环形图」与「点开分类看明细」的共同口径：
 * 图上显示的分类金额与点进去看到的明细必须对得上，所以过滤规则要钉死：
 * 只留指定收支类型、金额为正的记录，分类名走 labelOf（空标签归入 fallbackLabel）。
 */
import { labelOf, pickByLabels, sumByCategory, buildDailySeries, comparePeriods, monthTickLabels } from '../../utils/stats';
import { LedgerType } from '../../types/models';
import type { LedgerRecord } from '../../types/models';

/**
 * 造一条记账记录（只需 type / amount / tag / date）
 * @param over 覆盖字段
 * @returns LedgerRecord
 */
function rec(over: Partial<LedgerRecord>): LedgerRecord {
  return {
    id: over.id ?? 'r1',
    type: over.type ?? LedgerType.Expense,
    amount: over.amount ?? 100,
    date: over.date ?? '2026-09-19',
    createTime: 0,
    updateTime: 0,
    extra: {},
    ...over,
  };
}

describe('stats · labelOf', () => {
  test('有标签用标签，空白标签与无标签都归入 fallback', () => {
    expect(labelOf(rec({ tag: '餐饮' }))).toBe('餐饮');
    expect(labelOf(rec({ tag: '' }))).toBe('未分类');
    // 只有空白的 tag 等同于没有 tag（老数据可能有 "  " 这种脏值）
    expect(labelOf(rec({ tag: '   ' }))).toBe('未分类');
    expect(labelOf(rec({ tag: '' }), '其他')).toBe('其他');
  });

  test('标签两侧空白会被裁掉，避免「餐饮 」和「餐饮」裂成两类', () => {
    expect(labelOf(rec({ tag: ' 餐饮 ' }))).toBe('餐饮');
  });
});

describe('stats · sumByCategory', () => {
  test('按分类聚合金额与笔数，并按金额降序', () => {
    const records = [
      rec({ id: 'a', tag: '餐饮', amount: 300 }),
      rec({ id: 'b', tag: '餐饮', amount: 200 }),
      rec({ id: 'c', tag: '交通', amount: 1000 }),
      rec({ id: 'd', tag: '', amount: 50 }),
    ];
    const sums = sumByCategory(records, LedgerType.Expense);
    expect(sums.map((s) => s.label)).toEqual(['交通', '餐饮', '未分类']);
    expect(sums[0]).toMatchObject({ label: '交通', value: 1000, count: 1 });
    expect(sums[1]).toMatchObject({ label: '餐饮', value: 500, count: 2 });
    expect(sums[2]).toMatchObject({ label: '未分类', value: 50, count: 1 });
  });

  test('只统计指定收支类型：收入不混进支出汇总', () => {
    const records = [
      rec({ id: 'a', tag: '餐饮', amount: 300 }),
      rec({ id: 'b', tag: '工资', amount: 5000, type: LedgerType.Income }),
    ];
    const sums = sumByCategory(records, LedgerType.Expense);
    expect(sums).toHaveLength(1);
    expect(sums[0].label).toBe('餐饮');
  });

  test('金额非正（0 / 负数 / NaN）的记录不参与聚合', () => {
    const records = [
      rec({ id: 'a', tag: '餐饮', amount: 0 }),
      rec({ id: 'b', tag: '餐饮', amount: -100 }),
      rec({ id: 'c', tag: '餐饮', amount: Number.NaN }),
      rec({ id: 'd', tag: '餐饮', amount: 100 }),
    ];
    const sums = sumByCategory(records, LedgerType.Expense);
    expect(sums).toHaveLength(1);
    expect(sums[0].value).toBe(100);
    expect(sums[0].count).toBe(1);
  });

  test('空集合返回空数组', () => {
    expect(sumByCategory([], LedgerType.Expense)).toEqual([]);
  });
});

describe('stats · pickByLabels', () => {
  const records = [
    rec({ id: 'a', tag: '餐饮', amount: 300 }),
    rec({ id: 'b', tag: '交通', amount: 200 }),
    rec({ id: 'c', tag: '购物', amount: 100 }),
    rec({ id: 'd', tag: '', amount: 50 }),
    rec({ id: 'e', tag: '工资', amount: 5000, type: LedgerType.Income }),
    rec({ id: 'f', tag: '餐饮', amount: 0 }),
  ];

  test('包含模式：只留指定分类、指定类型、金额为正的记录', () => {
    const picked = pickByLabels(records, LedgerType.Expense, ['餐饮']);
    expect(picked.map((r) => r.id)).toEqual(['a']);
  });

  test('与 sumByCategory 同口径：无标签记录按 fallbackLabel 归类', () => {
    // 「未分类」要能被点名捞出来，否则图例上点"未分类"会得到空明细
    const picked = pickByLabels(records, LedgerType.Expense, ['未分类']);
    expect(picked.map((r) => r.id)).toEqual(['d']);
  });

  test('排除模式：用于「其他」分类的成员取反', () => {
    const picked = pickByLabels(records, LedgerType.Expense, ['餐饮', '交通'], { exclude: true });
    // 排除「餐饮 / 交通」后剩购物与未分类；金额为 0 的 f 依旧不进来
    expect(picked.map((r) => r.id)).toEqual(['c', 'd']);
  });

  test('排除模式同样尊重类型与金额为正的口径', () => {
    const picked = pickByLabels(records, LedgerType.Expense, ['不存在的分类'], { exclude: true });
    expect(picked.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('fallbackLabel 可自定义，与聚合时的自定义保持一致', () => {
    const picked = pickByLabels(records, LedgerType.Expense, ['其他'], {
      fallbackLabel: '其他',
    });
    expect(picked.map((r) => r.id)).toEqual(['d']);
  });

  test('聚合结果与明细能对上：sumByCategory 的金额 = pickByLabels 明细之和', () => {
    const labels = ['餐饮', '交通', '未分类'];
    const picked = pickByLabels(records, LedgerType.Expense, labels);
    const total = picked.reduce((acc, r) => acc + r.amount, 0);
    const sumOfLabels = sumByCategory(records, LedgerType.Expense)
      .filter((s) => labels.includes(s.label))
      .reduce((acc, s) => acc + s.value, 0);
    expect(total).toBe(sumOfLabels);
  });

  test('不修改入参数组', () => {
    const frozen = Object.freeze([
      rec({ id: 'a', tag: '餐饮', amount: 300 }),
    ]) as readonly LedgerRecord[];
    expect(() => pickByLabels(frozen, LedgerType.Expense, ['餐饮'])).not.toThrow();
  });
});

describe('stats · buildDailySeries', () => {
  test('按日聚合，序列补齐整月（无记录的日期为 0）', () => {
    const records = [
      rec({ id: 'a', date: '2026-09-01', amount: 100 }),
      rec({ id: 'b', date: '2026-09-01', amount: 200 }),
      rec({ id: 'c', date: '2026-09-15', amount: 50 }),
    ] as readonly LedgerRecord[];
    const series = buildDailySeries(records, '2026-09', LedgerType.Expense);
    expect(series).toHaveLength(30); // 9 月 30 天
    expect(series[0]).toEqual({ date: '2026-09-01', day: 1, value: 300 });
    expect(series[14]).toEqual({ date: '2026-09-15', day: 15, value: 50 });
    expect(series[1].value).toBe(0);
    expect(series[29].day).toBe(30);
  });

  test('只统计指定收支类型，跨月记录不串月', () => {
    const records = [
      rec({ id: 'a', date: '2026-09-02', amount: 100 }),
      rec({ id: 'b', date: '2026-09-03', amount: 999, type: LedgerType.Income }),
      rec({ id: 'c', date: '2026-08-02', amount: 777 }),
    ] as readonly LedgerRecord[];
    const series = buildDailySeries(records, '2026-09', LedgerType.Expense);
    expect(series[1].value).toBe(100);
    expect(series[2].value).toBe(0); // 收入不进支出序列
    expect(series.every((p) => p.value !== 777)).toBe(true);
  });

  test('非法月份返回空数组', () => {
    expect(buildDailySeries([], 'bad', LedgerType.Expense)).toEqual([]);
    expect(buildDailySeries([], '2026-13', LedgerType.Expense)).toEqual([]);
  });

  test('序列日期连续（跨月边界不缺天）', () => {
    const series = buildDailySeries([], '2026-02', LedgerType.Expense);
    expect(series).toHaveLength(28); // 2026 平年
    expect(series[0].date).toBe('2026-02-01');
    expect(series[27].date).toBe('2026-02-28');
  });
});

describe('stats · comparePeriods', () => {
  test('差额与比例', () => {
    const r = comparePeriods(1200, 1000);
    expect(r.diff).toBe(200);
    expect(r.ratio).toBeCloseTo(0.2);
  });

  test('当期更少时差额为负', () => {
    const r = comparePeriods(500, 1000);
    expect(r.diff).toBe(-500);
    expect(r.ratio).toBeCloseTo(-0.5);
  });

  test('上期为 0 时比例为 null（无穷大不可展示）', () => {
    expect(comparePeriods(300, 0).ratio).toBeNull();
    expect(comparePeriods(0, 0).ratio).toBeNull();
  });
});

describe('stats · monthTickLabels', () => {
  test('31 天：首尾固定为 1 日与月末，中段向下取整不越位', () => {
    expect(monthTickLabels(31)).toEqual(['1日', '8日', '16日', '23日', '31日']);
  });

  test('30 天与 28 天：首尾始终对齐月长', () => {
    expect(monthTickLabels(30)).toEqual(['1日', '8日', '15日', '22日', '30日']);
    expect(monthTickLabels(28)[0]).toBe('1日');
    expect(monthTickLabels(28)[monthTickLabels(28).length - 1]).toBe('28日');
  });

  test('月长不足 5 天时逐日给出，不产生重复刻度', () => {
    expect(monthTickLabels(3)).toEqual(['1日', '2日', '3日']);
  });

  test('非法入参返回空数组（不渲染刻度行）', () => {
    expect(monthTickLabels(0)).toEqual([]);
    expect(monthTickLabels(NaN)).toEqual([]);
  });
});
