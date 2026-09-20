import { LedgerService, LedgerError, MAX_TAG_LEN, MAX_REMARK_LEN } from '../../service/ledger.service';
import { StorageService } from '../../service/storage';
import { LedgerType } from '../../types/models';
import { isValidAmount, MAX_YUAN } from '../../utils/money';

describe('LedgerService', () => {
  beforeEach(() => {
    StorageService.clear();
  });

  test('create 应将元转分并倒序存储', () => {
    const a = LedgerService.create({ type: LedgerType.Expense, amount: 19.99, date: '2026-09-16', tag: '餐饮', remark: '午饭' });
    expect(a.amount).toBe(1999);
    const b = LedgerService.create({ type: LedgerType.Income, amount: 100, date: '2026-09-16' });
    const list = LedgerService.list();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(b.id); // 后创建的在前
    expect(list[1].id).toBe(a.id);
  });

  test('create 不修改此前已返回的列表（不可变更新）', () => {
    LedgerService.create({ type: LedgerType.Expense, amount: 10, date: '2026-09-16' });
    const snapshot = LedgerService.list();
    expect(snapshot).toHaveLength(1);

    LedgerService.create({ type: LedgerType.Expense, amount: 20, date: '2026-09-16' });
    expect(snapshot).toHaveLength(1); // 旧快照不受影响
    expect(LedgerService.list()).toHaveLength(2);
  });

  test('list 支持月份过滤', () => {
    LedgerService.create({ type: LedgerType.Expense, amount: 10, date: '2026-09-01' });
    LedgerService.create({ type: LedgerType.Expense, amount: 20, date: '2026-08-01' });
    expect(LedgerService.list({ month: '2026-09' })).toHaveLength(1);
    expect(LedgerService.list({ month: '2026-08' })).toHaveLength(1);
  });

  test('update 只更新传入字段', () => {
    const r = LedgerService.create({ type: LedgerType.Expense, amount: 50, date: '2026-09-16', remark: '旧' });
    const next = LedgerService.update(r.id, { amount: 88.5, remark: '新' });
    expect(next.amount).toBe(8850);
    expect(next.remark).toBe('新');
    expect(next.tag).toBe('');
    expect(next.type).toBe(LedgerType.Expense);
  });

  test('update 支持用空字符串清空可选字段', () => {
    const r = LedgerService.create({ type: LedgerType.Expense, amount: 50, date: '2026-09-16', tag: '餐饮' });
    const next = LedgerService.update(r.id, { tag: '' });
    expect(next.tag).toBe('');
  });

  test('update 记录不存在时抛 LedgerError', () => {
    expect(() => LedgerService.update('not-exist', { amount: 1 })).toThrow(LedgerError);
  });

  test('remove 删除指定记录', () => {
    const r = LedgerService.create({ type: LedgerType.Expense, amount: 10, date: '2026-09-16' });
    LedgerService.remove(r.id);
    expect(LedgerService.list()).toHaveLength(0);
  });

  test('clear 清空全部', () => {
    LedgerService.create({ type: LedgerType.Expense, amount: 10, date: '2026-09-16' });
    LedgerService.clear();
    expect(LedgerService.list()).toHaveLength(0);
  });

  test('summary 按月汇总收支与结余（分）', () => {
    LedgerService.create({ type: LedgerType.Income, amount: 100, date: '2026-09-10' });
    LedgerService.create({ type: LedgerType.Expense, amount: 30.5, date: '2026-09-11' });
    LedgerService.create({ type: LedgerType.Expense, amount: 5, date: '2026-08-11' }); // 不计入本月
    const s = LedgerService.summary('2026-09');
    expect(s.income).toBe(10000);
    expect(s.expense).toBe(3050);
    expect(s.balance).toBe(6950);
  });

  describe('入参校验（此前缺失，脏数据可直接落库）', () => {
    const base = { type: LedgerType.Expense, date: '2026-09-16' };

    test.each([
      ['0', 0],
      ['负数', -1],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['超过三位小数', 1.999],
      ['超出上限', MAX_YUAN + 1],
    ])('create 拒绝非法金额：%s', (_label, amount) => {
      expect(() => LedgerService.create({ ...base, amount })).toThrow(LedgerError);
      expect(LedgerService.list()).toHaveLength(0);
    });

    test('isValidAmount 与 service 校验口径一致', () => {
      expect(isValidAmount(String(MAX_YUAN))).toBe(true);
      expect(() => LedgerService.create({ ...base, amount: MAX_YUAN })).not.toThrow();
    });

    test('create 拒绝畸形日期', () => {
      expect(() => LedgerService.create({ ...base, amount: 1, date: '' })).toThrow(LedgerError);
      expect(() => LedgerService.create({ ...base, amount: 1, date: '2026/09/16' })).toThrow(LedgerError);
    });

    test('create 拒绝非法收支类型', () => {
      const invalidType = 'transfer' as unknown as LedgerType;
      expect(() => LedgerService.create({ ...base, amount: 1, type: invalidType })).toThrow(LedgerError);
    });

    test('可选文本字段会去空格并截断到长度上限', () => {
      const r = LedgerService.create({
        ...base,
        amount: 1,
        tag: '  ' + 'a'.repeat(MAX_TAG_LEN + 5) + '  ',
        remark: 'b'.repeat(MAX_REMARK_LEN + 5),
      });
      expect(r.tag).toHaveLength(MAX_TAG_LEN);
      expect(r.remark).toHaveLength(MAX_REMARK_LEN);
    });
  });
});
