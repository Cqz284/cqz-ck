/**
 * 额度提醒：弹窗 + 每次超额只弹一次
 *
 * 这里钉的是"不打扰"与"该提醒时别漏"之间的那条线：
 * 1. 未超额 / 未设置额度 → 不弹；
 * 2. 同一次超额只弹一次（反复弹会被当成噪音）；
 * 3. 弹的是弹窗（showModal）而不是 toast —— toast 一闪而过，额度超了这种需要被看见的事会被错过；
 * 4. **回到额度以内要把"已提醒"作废**：删掉超支那笔再加一笔重新超额，应该再提醒一次。
 */
import { StorageService, StorageKeys } from '../../service/storage';
import {
  clearBudgetNotice,
  currentBudgetAlert,
  resyncBudgetNotice,
  showBudgetAlertOnce,
} from '../../utils/budget-alert';
import { today } from '../../utils/date';
import { LedgerType } from '../../types/models';
import type { LedgerRecord } from '../../types/models';

/**
 * 造一条记账记录（只需要 type / amount / date 三个字段）
 * @param over 覆盖字段
 * @returns LedgerRecord
 */
function rec(over: Partial<LedgerRecord>): LedgerRecord {
  return {
    id: over.id ?? 'r1',
    type: over.type ?? LedgerType.Expense,
    amount: over.amount ?? 100,
    date: over.date ?? today(),
    createTime: 0,
    updateTime: 0,
    extra: {},
    ...over,
  };
}

const showModal = jest.fn();

beforeEach(() => {
  StorageService.clear();
  showModal.mockReset();
  (wx as unknown as Record<string, unknown>).showModal = showModal;
});

describe('budget-alert · currentBudgetAlert', () => {
  test('没设置任何额度时不提醒', () => {
    const records = [rec({ amount: 999999 })];
    expect(currentBudgetAlert({ records, dailyBudget: 0, monthlyBudget: 0, currency: '¥' })).toBe('');
  });

  test('没超额时不提醒（80% 那档只让进度条转暖色）', () => {
    const records = [rec({ amount: 5000 })]; // 50 元 / 额度 100 元
    expect(currentBudgetAlert({ records, dailyBudget: 10000, monthlyBudget: 0, currency: '¥' })).toBe('');
  });

  test('超出每日额度时给出可读文案', () => {
    const records = [rec({ amount: 12000 })]; // 120 元 / 额度 100 元
    const text = currentBudgetAlert({ records, dailyBudget: 10000, monthlyBudget: 0, currency: '¥' });
    expect(text).toContain('今日已超额度');
    expect(text).toContain('¥20.00');
  });

  test('收入不计入支出额度（否则记笔工资也会被提醒超支）', () => {
    const records = [rec({ type: LedgerType.Income, amount: 12000 })];
    expect(currentBudgetAlert({ records, dailyBudget: 10000, monthlyBudget: 0, currency: '¥' })).toBe('');
  });
});

describe('budget-alert · showBudgetAlertOnce', () => {
  test('空文案不弹，且不动去重记录（作废是 resync 的职责，记收入时也会传空文案）', () => {
    StorageService.set(StorageKeys.BudgetNotice, { date: today() });
    expect(showBudgetAlertOnce('')).toBe(false);
    expect(showModal).not.toHaveBeenCalled();
    expect(StorageService.get(StorageKeys.BudgetNotice)).toEqual({ date: today() });
  });

  test('弹一次弹窗，并记下"今天已提醒"；同一次超额不再弹', () => {
    expect(showBudgetAlertOnce('今日已超额度 ¥20.00')).toBe(true);

    expect(showModal).toHaveBeenCalledTimes(1);
    const opt = showModal.mock.calls[0][0] as { title: string; content: string; showCancel: boolean };
    expect(opt.title).toBe('额度提醒');
    expect(opt.content).toBe('今日已超额度 ¥20.00');
    // 只给一个「知道了」：这不是需要用户做选择的问题
    expect(opt.showCancel).toBe(false);

    expect(StorageService.get(StorageKeys.BudgetNotice)).toEqual({ date: today() });

    expect(showBudgetAlertOnce('今日已超额度 ¥20.00')).toBe(false);
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  test('换一天可以再弹（去重按自然日，是"同一次超额"不是"一辈子一次"）', () => {
    StorageService.set(StorageKeys.BudgetNotice, { date: '2000-01-01' });
    expect(showBudgetAlertOnce('超额')).toBe(true);
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  test('弹窗关闭后回调（记账页用它接"返回上一页"）', () => {
    showModal.mockImplementation((opt: { complete?: () => void }) => {
      if (opt.complete) opt.complete();
    });
    const onClose = jest.fn();
    showBudgetAlertOnce('超额', onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('budget-alert · resyncBudgetNotice', () => {
  test('回到额度以内会作废"已提醒"，于是删掉超支那笔再重新超额还能弹', () => {
    // 先超额提醒一次，同一次超额不重复弹
    expect(showBudgetAlertOnce('今日已超额度 ¥20.00')).toBe(true);
    expect(showBudgetAlertOnce('今日已超额度 ¥20.00')).toBe(false);

    // 用户把超支那笔删了 → 列表页刷新时用当前状态校准
    resyncBudgetNotice('');
    expect(StorageService.get(StorageKeys.BudgetNotice)).toEqual({ date: '' });

    // 再加一笔重新超额 → 应该还能收到提醒
    expect(showBudgetAlertOnce('今日已超额度 ¥20.00')).toBe(true);
    expect(showModal).toHaveBeenCalledTimes(2);
  });

  test('仍然超额时不动记录，避免"每记一笔都弹"', () => {
    showBudgetAlertOnce('今日已超额度 ¥20.00');
    const before = StorageService.get(StorageKeys.BudgetNotice);

    resyncBudgetNotice('今日已超额度 ¥50.00');

    expect(StorageService.get(StorageKeys.BudgetNotice)).toEqual(before);
    expect(showBudgetAlertOnce('今日已超额度 ¥50.00')).toBe(false);
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  test('clearBudgetNotice 用空日期占位，判定上等价于"从未提醒过"', () => {
    showBudgetAlertOnce('超额');
    clearBudgetNotice();
    expect(StorageService.get(StorageKeys.BudgetNotice)).toEqual({ date: '' });
    expect(showBudgetAlertOnce('超额')).toBe(true);
  });
});
