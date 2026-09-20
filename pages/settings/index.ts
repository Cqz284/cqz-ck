import { settingsStore } from '../../store/settings.store';
import { haptic } from '../../utils/haptics';
import { formatMoney, toFen, toYuan, isValidAmount } from '../../utils/money';
import { LIGHT_COLORS, applyPageTheme, attachPageTheme, detachPageTheme } from '../../utils/theme';
import type { BaseSettings } from '../../types/models';

/** 可选货币符号（与 formatMoney 的展示配合） */
const CURRENCIES: Array<{ symbol: string; label: string }> = [
  { symbol: '¥', label: '人民币 ¥' },
  { symbol: '$', label: '美元 $' },
  { symbol: '€', label: '欧元 €' },
  { symbol: '£', label: '英镑 £' },
];

/**
 * 额度展示文案
 * @param fen 额度（分）；0 表示未设置
 * @param currency 货币符号
 * @returns 展示文本
 */
function budgetText(fen: number, currency: string): string {
  return fen > 0 ? formatMoney(fen, currency) : '未设置';
}

/** 页面 data */
interface SettingsData {
  /** 当前货币符号 */
  currency: string;
  /** 货币展示文案 */
  currencyLabel: string;
  /** 是否开启震动反馈 */
  haptics: boolean;
  /** 月度预算（分） */
  monthlyBudget: number;
  /** 每日额度（分） */
  dailyBudget: number;
  monthlyBudgetText: string;
  dailyBudgetText: string;
  pageStyle: string;
  pageBg: string;
  navBarBg: string;
  navBarColor: 'black' | 'white';
}

/** 页面自定义实例字段与方法 */
interface SettingsCustom {
  refresh(): void;
  onPickCurrency(): void;
  onToggleHaptics(e: { detail: unknown }): void;
  onEditMonthlyBudget(): void;
  onEditDailyBudget(): void;
  promptBudget(title: string, current: number, field: 'monthlyBudget' | 'dailyBudget'): void;
  onComing(): void;
}

Page<SettingsData, SettingsCustom>({
  data: {
    currency: '¥',
    currencyLabel: '人民币 ¥',
    haptics: true,
    monthlyBudget: 0,
    dailyBudget: 0,
    monthlyBudgetText: '未设置',
    dailyBudgetText: '未设置',
    pageStyle: '',
    pageBg: LIGHT_COLORS.pageBg,
    navBarBg: LIGHT_COLORS.pageBg,
    navBarColor: 'black',
  },

  onLoad() {
    attachPageTheme(this);
    // 数据在 onLoad 就位：onLoad 里的 setData 会随首次渲染一起生效，
    // 不会出现"页面先画出来、值再补上"的观感（页尾那组尤其明显）
    settingsStore.load();
    this.refresh();
  },

  onUnload() {
    detachPageTheme(this);
  },

  onShow() {
    settingsStore.load();
    this.refresh();
    applyPageTheme(this);
  },

  /** 从 store 同步展示数据 */
  refresh() {
    const s = settingsStore.settings;
    const hit = CURRENCIES.find((c) => c.symbol === s.currency);
    this.setData({
      currency: s.currency,
      currencyLabel: hit ? hit.label : s.currency,
      haptics: s.haptics,
      monthlyBudget: s.monthlyBudget,
      dailyBudget: s.dailyBudget,
      monthlyBudgetText: budgetText(s.monthlyBudget, s.currency),
      dailyBudgetText: budgetText(s.dailyBudget, s.currency),
    });
  },

  /** 选择货币符号（原生 action sheet 足够，不引额外组件） */
  onPickCurrency() {
    haptic('light');
    wx.showActionSheet({
      itemList: CURRENCIES.map((c) => c.label),
      success: (res) => {
        const picked = CURRENCIES[res.tapIndex];
        if (!picked || picked.symbol === this.data.currency) return;
        settingsStore.update({ currency: picked.symbol });
        this.refresh();
        wx.showToast({ title: '已切换为 ' + picked.symbol, icon: 'none' });
      },
      fail: () => {
        // 用户取消，不处理
      },
    });
  },

  /**
   * 切换震动反馈
   *
   * 注意顺序：先写入设置（store 里会即时应用到 haptics 开关），
   * 再补一次震动作为"开启"的正反馈——关闭时则不震（否则关掉还会震一下，很怪）。
   *
   * @param e van-switch 的 change 事件，detail 即当前值
   */
  onToggleHaptics(e: { detail: unknown }) {
    const next = Boolean(e.detail);
    settingsStore.update({ haptics: next });
    this.setData({ haptics: next });
    if (next) haptic('medium');
    wx.showToast({ title: next ? '已开启震动反馈' : '已关闭震动反馈', icon: 'none' });
  },

  /** 编辑月度预算 */
  onEditMonthlyBudget() {
    haptic('light');
    this.promptBudget('月度支出预算', this.data.monthlyBudget, 'monthlyBudget');
  },

  /** 编辑每日额度 */
  onEditDailyBudget() {
    haptic('light');
    this.promptBudget('每日支出额度', this.data.dailyBudget, 'dailyBudget');
  },

  /**
   * 弹输入框填写额度
   *
   * 用原生 editable modal：额度是低频设置，为它引一个数字键盘组件不划算。
   * 留空或填 0 = 不设置（清除该额度），两种写法都要支持，用户不必猜。
   *
   * @param title 弹窗标题
   * @param current 当前额度（分），用于提示文本
   * @param field 要写入的设置字段
   */
  promptBudget(title: string, current: number, field: 'monthlyBudget' | 'dailyBudget') {
    const label = field === 'monthlyBudget' ? '月度预算' : '每日额度';
    wx.showModal({
      title,
      editable: true,
      placeholderText: current > 0 ? `当前 ${toYuan(current)}，留空表示不设置` : '如 3000，留空表示不设置',
      success: (res) => {
        if (!res.confirm) return;
        const raw = String(res.content ?? '').trim();

        let fen = 0;
        if (raw !== '') {
          const num = Number(raw);
          const invalid = !Number.isFinite(num) || num < 0 || (num > 0 && !isValidAmount(raw));
          if (invalid) {
            wx.showToast({ title: '请输入有效金额（最多两位小数）', icon: 'none' });
            return;
          }
          // toFen 做"元转分"的浮点收口（如 19.99 * 100 = 1998.99…）
          fen = num > 0 ? toFen(num) : 0;
        }

        const patch: Partial<BaseSettings> =
          field === 'monthlyBudget' ? { monthlyBudget: fen } : { dailyBudget: fen };
        try {
          settingsStore.update(patch);
        } catch (err) {
          wx.showToast({ title: err instanceof Error ? err.message : '保存失败', icon: 'none' });
          return;
        }
        this.refresh();
        haptic(fen > 0 ? 'medium' : 'light');
        wx.showToast({ title: fen > 0 ? `${label}已设置` : `${label}已清除`, icon: 'none' });
      },
    });
  },

  /** 占位功能 */
  onComing() {
    haptic('light');
    wx.showToast({ title: '敬请期待', icon: 'none' });
  },
});
