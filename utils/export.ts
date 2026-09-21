import { LedgerService } from '../service/ledger.service';
import { NotesService } from '../service/notes.service';
import { SettingsService } from '../service/settings.service';
import { formatMoney } from './money';
import { format, monthOf } from './date';
import { APP_NAME } from './app-info';
import { LedgerType, NoteKind } from '../types/models';

/**
 * 将全部数据导出为纯文本
 * @returns 导出文本
 */
export function toText(): string {
  const currency = SettingsService.get().currency;
  const records = LedgerService.list();
  const notes = NotesService.list();
  const month = monthOf();
  const s = LedgerService.summary(month);

  const lines: string[] = [];
  lines.push('===== ' + APP_NAME + '导出 =====');
  lines.push('导出时间：' + format(Date.now(), 'YYYY-MM-DD HH:mm'));
  // 结余必须带符号：支出大于收入时为负，否则导出结果会误导使用者
  lines.push('本月(' + month + ') 收入：' + formatMoney(s.income, currency));
  lines.push('本月(' + month + ') 支出：' + formatMoney(s.expense, currency));
  lines.push('本月(' + month + ') 结余：' + formatMoney(s.balance, currency, true));
  lines.push('');
  lines.push('----- 记账明细（共 ' + records.length + ' 条）-----');
  records.forEach((r) => {
    const sign = r.type === LedgerType.Income ? '+' : '-';
    lines.push(
      '[' +
        r.date +
        '] ' +
        (r.tag || '未分类') +
        ' ' +
        sign +
        formatMoney(r.amount, currency) +
        (r.remark ? '  ' + r.remark : '')
    );
  });
  lines.push('');
  lines.push('----- 记事明细（共 ' + notes.length + ' 条）-----');
  notes.forEach((n) => {
    const prefix = n.kind === NoteKind.Todo ? (n.done ? '[已完成]' : '[待办]') : '[笔记]';
    lines.push(prefix + ' ' + n.content);
  });
  return lines.join('\n');
}

/**
 * 复制文本到剪贴板
 * @param text 待复制文本
 * @returns Promise<void>
 */
export function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.setClipboardData({
      data: text,
      success: () => resolve(),
      fail: (err) => reject(err),
    });
  });
}
