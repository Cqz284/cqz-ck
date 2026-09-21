import { SettingsService, DEFAULT_SETTINGS } from '../../service/settings.service';
import { StorageService, StorageKeys } from '../../service/storage';
import { toFen, toYuan, formatMoney, isValidAmount, MAX_YUAN, MoneyError } from '../../utils/money';
import { uid } from '../../utils/id';
import { debounce } from '../../utils/debounce';
import { monthOf, dayDiff, fromNow } from '../../utils/date';
import { toText } from '../../utils/export';
import { APP_NAME } from '../../utils/app-info';
import { LedgerService } from '../../service/ledger.service';
import { NotesService } from '../../service/notes.service';
import { LedgerType, NoteKind } from '../../types/models';
import type { BaseSettings } from '../../types/models';

describe('SettingsService', () => {
  beforeEach(() => StorageService.clear());

  test('未存储时返回默认值', () => {
    expect(SettingsService.get()).toEqual({
      currency: '¥',
      haptics: true,
      monthlyBudget: 0,
      dailyBudget: 0,
      extra: {},
    });
  });

  test('设置里不再有主题模式（主题始终跟随系统）', () => {
    // 主题切换已移除：模型、默认值、归一化三处都不能再残留该字段
    expect('themeMode' in SettingsService.get()).toBe(false);
    expect('themeMode' in DEFAULT_SETTINGS).toBe(false);
  });

  test('update 合并并持久化', () => {
    SettingsService.update({ currency: '$' });
    StorageService.clearCache(); // 仅清缓存，模拟重启后从 storage 读取
    expect(SettingsService.get().currency).toBe('$');
  });

  test('返回的 extra 与默认值不共享引用（浅拷贝会污染全局默认值）', () => {
    const first = SettingsService.get();
    first.extra.injected = true;

    expect(DEFAULT_SETTINGS.extra).toEqual({});
    expect(SettingsService.get().extra).toEqual({});
  });

  test('震动开关可持久化，且旧数据（无该字段）按开启处理', () => {
    SettingsService.update({ haptics: false });
    StorageService.clearCache();
    expect(SettingsService.get().haptics).toBe(false);

    // 模拟旧版本写入的数据：没有 haptics 字段
    StorageService.set(
      StorageKeys.SettingsBase,
      { currency: '¥', extra: {} } as unknown as BaseSettings
    );
    StorageService.clearCache();
    expect(SettingsService.get().haptics).toBe(true);
  });

  test('update 对开关与货币做收口，非法值不会写坏存储', () => {
    SettingsService.update({ haptics: undefined as unknown as boolean });
    expect(SettingsService.get().haptics).toBe(true);

    SettingsService.update({ currency: '' });
    expect(SettingsService.get().currency).toBe('¥');
  });

  test('旧数据里残留的 themeMode 会被丢弃（主题已改为始终跟随系统）', () => {
    // 老版本往存储里写过 themeMode；读取时不该再返回它，
    // 否则归一化会把未知字段一路带着漂下去，每处判断都要多问一句"这是啥"
    StorageService.set(
      StorageKeys.SettingsBase,
      { currency: '¥', themeMode: 'dark', extra: {} } as unknown as BaseSettings
    );
    StorageService.clearCache();

    const s = SettingsService.get();
    expect('themeMode' in s).toBe(false);
    expect(s.currency).toBe('¥');
  });

  test('旧数据缺额度字段时读取自动补齐', () => {
    StorageService.set(
      StorageKeys.SettingsBase,
      { currency: '¥', extra: {} } as unknown as BaseSettings
    );
    StorageService.clearCache();

    const s = SettingsService.get();
    expect(s.monthlyBudget).toBe(0);
    expect(s.dailyBudget).toBe(0);
  });

  test('额度归一化：负数 / 非数字 / 超上限都收口', () => {
    expect(SettingsService.update({ monthlyBudget: -1 }).monthlyBudget).toBe(0);
    expect(SettingsService.update({ dailyBudget: Number.NaN }).dailyBudget).toBe(0);
    // 小数按分四舍五入（元转分在页面侧完成，这里只保证是整数分）
    expect(SettingsService.update({ dailyBudget: 12345.6 }).dailyBudget).toBe(12346);
    expect(SettingsService.update({ monthlyBudget: 1e12 }).monthlyBudget).toBe(MAX_YUAN * 100);
  });
});

describe('money 工具', () => {
  test('元转分无浮点误差', () => {
    expect(toFen(19.99)).toBe(1999);
    expect(toFen(0.1 + 0.2)).toBe(30);
    expect(toFen(8800)).toBe(880000);
  });

  test('toFen 对非法输入抛错，而不是静默返回 NaN', () => {
    expect(() => toFen(NaN)).toThrow(MoneyError);
    expect(() => toFen(Infinity)).toThrow(MoneyError);
  });

  test('分转元', () => {
    expect(toYuan(1999)).toBe(19.99);
    expect(toYuan(880000)).toBe(8800);
    expect(toYuan(NaN)).toBe(0);
  });

  test('formatMoney', () => {
    expect(formatMoney(1999)).toBe('¥19.99');
    expect(formatMoney(-500, '¥', true)).toBe('-¥5.00');
    expect(formatMoney(0)).toBe('¥0.00');
  });

  test('formatMoney 对非有限数字给出兜底文案，不产生 ¥NaN.undefined', () => {
    expect(formatMoney(NaN)).toBe('¥0.00');
    expect(formatMoney(Infinity, '$')).toBe('$0.00');
    expect(formatMoney(NaN)).not.toContain('NaN');
  });

  test('isValidAmount 覆盖空值 / 边界 / 上限', () => {
    expect(isValidAmount('25.5')).toBe(true);
    expect(isValidAmount('0')).toBe(false);
    expect(isValidAmount('-1')).toBe(false);
    expect(isValidAmount('abc')).toBe(false);
    expect(isValidAmount('1.999')).toBe(false);
    expect(isValidAmount('')).toBe(false);
    expect(isValidAmount('   ')).toBe(false);
    expect(isValidAmount(null)).toBe(false);
    expect(isValidAmount(undefined)).toBe(false);
    expect(isValidAmount(NaN)).toBe(false);
    expect(isValidAmount('.5')).toBe(false);
    expect(isValidAmount('1.')).toBe(false);
    expect(isValidAmount(String(MAX_YUAN))).toBe(true);
    expect(isValidAmount(String(MAX_YUAN + 1))).toBe(false);
  });
});

describe('id / debounce / date', () => {
  test('uid 在大量生成下不重复且形态稳定', () => {
    const list = Array.from({ length: 5000 }, () => uid());
    expect(new Set(list).size).toBe(5000);
    list.forEach((id) => expect(id).toMatch(/^[0-9a-z]{16,}$/));
  });

  test('debounce 窗口内只执行一次', async () => {
    let count = 0;
    const fn = debounce(() => count++, 50);
    fn();
    fn();
    fn();
    await new Promise((r) => setTimeout(r, 120));
    expect(count).toBe(1);
  });

  test('debounce.cancel 之后不再执行（页面卸载时必须能取消）', async () => {
    let count = 0;
    const fn = debounce(() => count++, 50);
    fn();
    fn.cancel();
    await new Promise((r) => setTimeout(r, 120));
    expect(count).toBe(0);
  });

  test('monthOf 与 dayDiff', () => {
    expect(monthOf('2026-09-17')).toBe('2026-09');
    expect(dayDiff('2026-09-17', '2026-09-17')).toBe(0);
    expect(dayDiff('2026-09-16', '2026-09-17')).toBe(1);
    expect(dayDiff('2026-08-31', '2026-09-02')).toBe(2);
    expect(dayDiff('2025-12-31', '2026-01-01')).toBe(1);
  });

  test('fromNow 的同日分段文案', () => {
    const realNow = Date.now();
    const spy = jest.spyOn(Date, 'now');
    try {
      // 固定到今天 15:00：否则"3 小时前"在凌晨跑会落到昨天，用例随时钟漂
      const noon = new Date(realNow);
      noon.setHours(15, 0, 0, 0);
      spy.mockReturnValue(noon.getTime());
      const base = noon.getTime();

      expect(fromNow(base - 30 * 1000)).toBe('刚刚');
      expect(fromNow(base - 5 * 60 * 1000)).toBe('5分钟前');
      expect(fromNow(base - 3 * 3600 * 1000)).toBe('3小时前');
      expect(fromNow(base - 14 * 3600 * 1000)).toBe('14小时前');
    } finally {
      spy.mockRestore();
    }
  });

  test('fromNow：昨天用「昨天 HH:mm」，更早用「几月几号 + 时间」，不再出现前天', () => {
    const realNow = Date.now();
    const spy = jest.spyOn(Date, 'now');

    try {
      // 场景一：现在是今天 00:30，26 小时前落在前天 22:30 → 给日期 + 时间，且不说"昨天/前天"
      const early = new Date(realNow);
      early.setHours(0, 30, 0, 0);
      spy.mockReturnValue(early.getTime());

      const ts = early.getTime() - 26 * 3600 * 1000;
      const older = fromNow(ts);
      expect(older).not.toContain('昨天');
      expect(older).not.toContain('前天');
      expect(older).toMatch(/\d+月\d+日 22:30$/);

      // 场景二：现在是今天 23:00，46 小时前落在昨天 01:00 → 昨天 + 时间
      const late = new Date(realNow);
      late.setHours(23, 0, 0, 0);
      spy.mockReturnValue(late.getTime());

      expect(fromNow(late.getTime() - 46 * 3600 * 1000)).toBe('昨天 01:00');

      // 场景三：远期日期带年份 + 时间
      expect(fromNow(new Date(2020, 0, 15, 10, 0, 0).getTime())).toBe('2020年1月15日 10:00');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('export 工具', () => {
  beforeEach(() => StorageService.clear());

  test('toText 包含汇总与明细', () => {
    LedgerService.create({ type: LedgerType.Income, amount: 100, date: '2026-09-10', tag: '工资' });
    LedgerService.create({ type: LedgerType.Expense, amount: 25.5, date: '2026-09-11', tag: '餐饮', remark: '牛肉面' });
    NotesService.create({ kind: NoteKind.Todo, content: '周报' });
    const text = toText();
    expect(text).toContain(APP_NAME + '导出');
    expect(text).toContain('工资');
    expect(text).toContain('牛肉面');
    expect(text).toContain('周报');
    expect(text).toContain('¥25.50');
    expect(text).toContain('[待办] 周报');
  });

  test('支出大于收入时导出的结余带负号', () => {
    const month = monthOf();
    LedgerService.create({ type: LedgerType.Income, amount: 10, date: month + '-05' });
    LedgerService.create({ type: LedgerType.Expense, amount: 88.5, date: month + '-06' });

    const text = toText();
    expect(text).toContain('本月(' + month + ') 结余：-¥78.50');
  });
});
