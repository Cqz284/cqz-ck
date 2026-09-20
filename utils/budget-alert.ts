/**
 * 额度提醒的编排：**弹窗 + 每次超额只弹一次**
 *
 * 为什么不放在各页面里各写一遍：
 * 首页（回到首页时）与记账编辑页（保存时）判断的是同一件事、去重也该是同一个键。
 * 分开写会出现"同一笔超额被提醒两次"，很快就成了噪音。
 *
 * ⚠️ 去重的语义是「**这一次**超额只提醒一次」，不是"今天只提醒一次"（踩过一次坑）：
 * 用户把超支那笔删掉、再加一笔重新超额，**应该**再提醒一次。
 * 但"回到额度以内"这个瞬间没有任何检查点会经过（删除只发生在列表页），
 * 所以凡是数据会变动的地方都要显式调一次 resyncBudgetNotice()，把作废这件事补上。
 */
import { StorageService, StorageKeys } from '../service/storage';
import { haptic } from './haptics';
import { monthOf, today } from './date';
import { budgetAlertText, dayExpense, monthExpense, shouldNoticeToday } from './budget';
import type { LedgerRecord } from '../types/models';

/** 额度提醒的输入 */
export interface BudgetAlertOptions {
  /** 记账记录（用于汇总已用金额） */
  records: readonly LedgerRecord[];
  /** 每日额度（分）；0 表示未设置 */
  dailyBudget: number;
  /** 月度预算（分）；0 表示未设置 */
  monthlyBudget: number;
  /** 货币符号 */
  currency: string;
}

/**
 * 组装超额提醒文案
 *
 * 只有**真正超出**（>= 100%）才有文案——80% 那档只把进度条转成暖色，不打扰用户。
 *
 * @param o 额度与记录
 * @returns 提醒文案；未超额 / 未设置额度时为空串
 */
export function currentBudgetAlert(o: BudgetAlertOptions): string {
  if (o.dailyBudget <= 0 && o.monthlyBudget <= 0) return '';
  return budgetAlertText({
    dailyUsed: dayExpense(o.records, today()),
    dailyLimit: o.dailyBudget,
    monthUsed: monthExpense(o.records, monthOf()),
    monthLimit: o.monthlyBudget,
    currency: o.currency,
  });
}

/**
 * 弹一次额度提醒，并记下"今天已经提醒过"
 *
 * 用弹窗（而不是 toast）：额度超了是"需要被看见"的事，toast 一闪而过容易被错过。
 * 每天最多一次——同一件事反复弹反而会被当成噪音。
 *
 * 注意职责边界：本函数**不判断**"当前是否还超额"。传空文案时它只是不弹窗，
 * 不会去动去重记录——因为记账页记收入时同样会传空文案，那时不该把"已提醒"抹掉。
 * 作废记录是 resyncBudgetNotice() 的事。
 *
 * @param text 提醒文案；空串直接跳过
 * @param onClose 弹窗关闭后的回调（记账页用它接"返回上一页"）
 * @returns 是否真的弹了
 */
export function showBudgetAlertOnce(text: string, onClose?: () => void): boolean {
  if (!text) return false;

  const todayStr = today();
  const last = StorageService.get(StorageKeys.BudgetNotice);
  if (!shouldNoticeToday(last?.date ?? '', todayStr)) return false;

  try {
    StorageService.set(StorageKeys.BudgetNotice, { date: todayStr });
  } catch {
    // 记录失败最多多提醒一次，不影响主流程
  }

  haptic('heavy');
  wx.showModal({
    title: '额度提醒',
    content: text,
    showCancel: false,
    confirmText: '知道了',
    complete: () => {
      if (onClose) onClose();
    },
  });
  return true;
}

/**
 * 清掉"今天已提醒"
 *
 * 用空日期占位而不是删 key：`shouldNoticeToday('', today)` 会判定为"从未提醒过"，
 * 效果与删除等价，而 StorageService 不必为此多一个 remove 接口。
 */
export function clearBudgetNotice(): void {
  try {
    StorageService.set(StorageKeys.BudgetNotice, { date: '' });
  } catch {
    // 清不掉最多多提醒一次，不影响主流程
  }
}

/**
 * 用当前额度状态校准去重记录
 *
 * 已经不超额（text 为空）就把"今天已提醒"作废：这样用户
 * 「删掉超支那笔 → 再加一笔重新超额」时还能再收到一次提醒。
 * 仍然超额则什么都不做，避免变成"每记一笔都弹"。
 *
 * @param text 当前超额文案（调用方用 currentBudgetAlert 算好传进来，避免这里再读一遍 store）
 */
export function resyncBudgetNotice(text: string): void {
  if (text) return;
  clearBudgetNotice();
}
