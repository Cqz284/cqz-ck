/**
 * 额度（预算）与进度条计算测试
 *
 * 这些数字同时决定"进度条长度"和"提醒文案"，口径错了用户会看到
 * "条已经满了、文案却说还没超"这种自相矛盾的界面，所以边界要钉死。
 */
import {
  WARN_RATIO,
  budgetAlertText,
  budgetProgress,
  budgetViews,
  dayExpense,
  daysInMonth,
  daysLeftInMonth,
  monthExpense,
  ratioLevel,
  shouldNoticeToday,
  sumExpense,
  todoProgressView,
} from '../../utils/budget';
import { LedgerType } from '../../types/models';
import type { LedgerRecord } from '../../types/models';

/**
 * 造一条记账记录（只需要用到 type / amount / date 三个字段）
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

describe('budget · ratioLevel', () => {
  test('80% 是预警线，100% 是超额线', () => {
    expect(ratioLevel(0)).toBe('normal');
    expect(ratioLevel(0.79)).toBe('normal');
    expect(ratioLevel(WARN_RATIO)).toBe('warn');
    expect(ratioLevel(0.99)).toBe('warn');
    expect(ratioLevel(1)).toBe('over');
    expect(ratioLevel(3)).toBe('over');
  });

  test('非法占比按正常处理，不误报超额', () => {
    expect(ratioLevel(Number.NaN)).toBe('normal');
    expect(ratioLevel(-1)).toBe('normal');
  });
});

describe('budget · budgetProgress', () => {
  test('未设置额度（limit <= 0）时 enabled 为 false，且不算出百分比', () => {
    const p = budgetProgress(5000, 0);
    expect(p.enabled).toBe(false);
    expect(p.percentText).toBe('');
    expect(p.barPercent).toBe(0);
    expect(p.level).toBe('normal');
  });

  test('条长夹取到 100%，但百分比文案保留真实值', () => {
    const p = budgetProgress(1500, 1000);
    expect(p.enabled).toBe(true);
    expect(p.barPercent).toBe(100);
    expect(p.percentText).toBe('150%');
    expect(p.remain).toBe(-500);
    expect(p.level).toBe('over');
  });

  test('剩余为负说明已超出，剩余为正说明还有余量', () => {
    expect(budgetProgress(300, 1000).remain).toBe(700);
    expect(budgetProgress(1000, 1000).remain).toBe(0);
    expect(budgetProgress(1000, 1000).level).toBe('over');
  });

  test('负数已用按 0 处理（脏数据不该让条变成负宽）', () => {
    const p = budgetProgress(-100, 1000);
    expect(p.used).toBe(0);
    expect(p.barPercent).toBe(0);
  });
});

describe('budget · todoProgressView', () => {
  test('没有待办时整块不出现', () => {
    const v = todoProgressView(0, 0);
    expect(v.enabled).toBe(false);
    expect(v.value).toBe('');
    expect(v.hint).toBe('');
  });

  test('已完成 / 总数与剩余文案', () => {
    const v = todoProgressView(1, 4);
    expect(v.enabled).toBe(true);
    expect(v.value).toBe('1 / 4');
    expect(v.percent).toBe(25);
    expect(v.hint).toBe('还剩 3 条未完成');
  });

  test('全部完成时不显示"还剩 0 条"', () => {
    const v = todoProgressView(3, 3);
    expect(v.percent).toBe(100);
    expect(v.hint).toBe('全部完成');
  });

  test('已完成数大于总数时夹取，不出现 120% 这种条', () => {
    const v = todoProgressView(9, 3);
    expect(v.value).toBe('3 / 3');
    expect(v.percent).toBe(100);
  });
});

describe('budget · 日期与汇总', () => {
  test('月份天数含闰年', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2026-09')).toBe(30);
    // 非法入参兜底 30 天，而不是 NaN
    expect(daysInMonth('bad')).toBe(30);
  });

  test('本月剩余天数含当天', () => {
    expect(daysLeftInMonth('2026-09-19')).toBe(12);
    expect(daysLeftInMonth('2026-09-30')).toBe(1);
    expect(daysLeftInMonth('2026-09-01')).toBe(30);
  });

  test('只统计支出，收入不计入额度', () => {
    const records = [
      rec({ id: 'a', amount: 300, date: '2026-09-19' }),
      rec({ id: 'b', amount: 700, type: LedgerType.Income, date: '2026-09-19' }),
      rec({ id: 'c', amount: 200, date: '2026-09-18' }),
    ];
    expect(dayExpense(records, '2026-09-19')).toBe(300);
    expect(monthExpense(records, '2026-09')).toBe(500);
    // 换个条件直接复用同一个汇总
    expect(sumExpense(records, (r) => r.id === 'c')).toBe(200);
  });
});

describe('budget · budgetAlertText', () => {
  const base = { dailyUsed: 0, dailyLimit: 0, monthUsed: 0, monthLimit: 0, currency: '¥' };

  test('没有超额时返回空串（80% 那档只变色、不弹提醒）', () => {
    expect(budgetAlertText({ ...base, dailyUsed: 800, dailyLimit: 1000 })).toBe('');
  });

  test('未设置额度时即使花超也不提醒', () => {
    expect(budgetAlertText({ ...base, dailyUsed: 99999, monthUsed: 99999 })).toBe('');
  });

  test('只超每日额度 / 只超月预算 / 两个都超', () => {
    expect(budgetAlertText({ ...base, dailyUsed: 1200, dailyLimit: 1000 })).toBe('今日已超额度 ¥2.00');
    expect(budgetAlertText({ ...base, monthUsed: 301000, monthLimit: 300000 })).toBe('本月已超预算 ¥10.00');
    expect(
      budgetAlertText({ ...base, dailyUsed: 1200, dailyLimit: 1000, monthUsed: 301000, monthLimit: 300000 })
    ).toBe('今日已超额度 ¥2.00，本月已超预算 ¥10.00');
  });

  test('提醒文案跟随货币符号', () => {
    expect(budgetAlertText({ ...base, dailyUsed: 1200, dailyLimit: 1000, currency: '$' })).toBe(
      '今日已超额度 $2.00'
    );
  });
});

describe('budget · shouldNoticeToday', () => {
  test('同一天只提醒一次', () => {
    expect(shouldNoticeToday('', '2026-09-19')).toBe(true);
    expect(shouldNoticeToday('2026-09-18', '2026-09-19')).toBe(true);
    expect(shouldNoticeToday('2026-09-19', '2026-09-19')).toBe(false);
  });

  test('没有今天这个前提时不提醒（避免拿空串做判断）', () => {
    expect(shouldNoticeToday('', '')).toBe(false);
  });
});

describe('budget · budgetViews（首页汇总卡的额度进度）', () => {
  const settings = { currency: '¥', monthlyBudget: 300000, dailyBudget: 10000 };

  test('两项额度都设置了：两条都出现，文案含已用 / 额度与剩余说明', () => {
    const records = [
      rec({ id: 'm1', amount: 100000, date: '2026-09-01' }),
      rec({ id: 'd1', amount: 3000, date: '2026-09-19' }),
      rec({ id: 'income', amount: 999999, type: LedgerType.Income, date: '2026-09-19' }),
    ];
    const v = budgetViews(records, settings, '2026-09-19');
    expect(v.hasBudget).toBe(true);
    expect(v.monthBar.enabled).toBe(true);
    // 月度已用含当天那笔：1000 + 30 = 1030
    expect(v.monthBar.value).toBe('¥1,030.00 / ¥3,000.00');
    expect(v.monthBar.hint).toContain('本月还剩 12 天');
    expect(v.dayBar.enabled).toBe(true);
    expect(v.dayBar.value).toBe('¥30.00 / ¥100.00');
    expect(v.dayBar.hint).toBe('剩余 ¥70.00');
  });

  test('只设置月预算：每日额度不出现，hasBudget 仍为 true', () => {
    const v = budgetViews([], { currency: '¥', monthlyBudget: 300000, dailyBudget: 0 }, '2026-09-19');
    expect(v.hasBudget).toBe(true);
    expect(v.monthBar.enabled).toBe(true);
    expect(v.dayBar.enabled).toBe(false);
    expect(v.dayBar.value).toBe('');
  });

  test('两项都没设置：hasBudget 为 false，模板据此显示"去设置"入口', () => {
    const v = budgetViews([], { currency: '¥', monthlyBudget: 0, dailyBudget: 0 }, '2026-09-19');
    expect(v.hasBudget).toBe(false);
    expect(v.monthBar.enabled).toBe(false);
    expect(v.dayBar.enabled).toBe(false);
  });

  test('收入不计入额度（只有支出算已用）', () => {
    const records = [rec({ id: 'i', amount: 500000, type: LedgerType.Income, date: '2026-09-19' })];
    const v = budgetViews(records, settings, '2026-09-19');
    expect(v.dayBar.value).toBe('¥0.00 / ¥100.00');
  });

  test('超支时提示文案转为"已超出"', () => {
    const records = [rec({ id: 'd1', amount: 12000, date: '2026-09-19' })];
    const v = budgetViews(records, settings, '2026-09-19');
    expect(v.dayBar.hint).toBe('已超出 ¥20.00');
    expect(v.dayBar.level).toBe('over');
  });
});
