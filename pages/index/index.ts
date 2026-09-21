import { createStoreBindings } from 'mobx-miniprogram-bindings';
import type { StoreBindings } from 'mobx-miniprogram-bindings';
import { ledgerStore } from '../../store/ledger.store';
import { notesStore } from '../../store/notes.store';
import { settingsStore } from '../../store/settings.store';
import { formatMoney } from '../../utils/money';
import { COLLAPSE_DURATION_MS, createBalanceRoller, measureHeights } from '../../utils/motion';
import type { BalanceRoller } from '../../utils/motion';
import { haptic } from '../../utils/haptics';
import {
  budgetViews,
  todoProgressView,
} from '../../utils/budget';
import type { ProgressView } from '../../utils/budget';
import { currentBudgetAlert, resyncBudgetNotice, showBudgetAlertOnce } from '../../utils/budget-alert';
import { dueBannerView } from '../../utils/todo-remind';
import type { DueBannerView } from '../../utils/todo-remind';
import { LIGHT_COLORS, applyPageTheme, attachPageTheme, detachPageTheme } from '../../utils/theme';
import { NoteKind } from '../../types/models';
import type { LedgerRecord, NoteItem } from '../../types/models';

/** 首页「最近记账」「最近待办」的展示条数上限 */
const RECENT_LIMIT = 3;

/**
 * 空进度条
 * 返回新对象而不是共享常量：data 里的对象被框架接管，避免任何意外写入互相影响
 * @returns ProgressView
 */
function emptyView(): ProgressView {
  return { enabled: false, label: '', value: '', percent: 0, level: 'normal', hint: '' };
}

/** 取全部待办（含已完成） */
function allTodos(): NoteItem[] {
  return notesStore.items.filter((n) => n.kind === NoteKind.Todo);
}

/** 空横幅（没有逾期/今日到期时用） */
function emptyBanner(): DueBannerView {
  return { enabled: false, text: '' };
}

/** 页面 data */
interface HomeData {
  incomeText: string;
  expenseText: string;
  balanceText: string;
  balanceClass: string;
  monthCount: number;
  pendingCount: number;
  /** 本月预算进度条 */
  monthBar: ProgressView;
  /** 每日额度进度条 */
  dayBar: ProgressView;
  /** 是否设置过任一额度（都没设置时显示"去设置"入口） */
  hasBudget: boolean;
  /** 待办完成度进度条 */
  todoBar: ProgressView;
  /** 到期待办横幅（逾期 / 今天到期） */
  todoBanner: DueBannerView;
  recent: LedgerRecord[];
  /** 最近的**未完成**待办（完成的会被动画收走，普通笔记留给记事页） */
  recentTodos: NoteItem[];
  /** 已钉住高度的待办行 id（收起动画的起点） */
  pinnedId: string;
  /** 钉住的高度（px） */
  pinnedHeight: number;
  /** 正在收起的待办行 id */
  removingId: string;
  /** 无待办时的空态文案（全完成与从未有过，说的是两件事） */
  todoEmptyText: string;
  currency: string;
  hasLedger: boolean;
  hasTodos: boolean;
  pageStyle: string;
  pageBg: string;
  navBarBg: string;
  navBarColor: 'black' | 'white';
}

/** 页面自定义实例字段与方法 */
interface HomeCustom {
  bindings: StoreBindings[];
  /** 结余滚动器（onLoad 前为 null，首次滚动时创建；onUnload 时取消） */
  roller: BalanceRoller | null;
  /** 待办收起动画的清理定时器 */
  removeTimer: ReturnType<typeof setTimeout> | null;
  refresh(): void;
  buildTodoView(): ProgressView;
  noticeBudget(): void;
  startBalance(target: number): void;
  goAddLedger(): void;
  goAddTodo(): void;
  goAddNote(): void;
  goLedgerList(): void;
  goNotesList(): void;
  goStats(): void;
  goTodos(): void;
  goSettings(): void;
  onEditRecord(e: { detail: { id: string } }): void;
  onEditNote(e: { detail: { id: string } }): void;
  onToggleNote(e: { detail: { id: string } }): void;
}

Page<HomeData, HomeCustom>({
  /** store 绑定实例（onLoad 中填充，onUnload 中销毁） */
  bindings: [] as StoreBindings[],
  /** 结余滚动器（首次滚动时创建） */
  roller: null,
  /** 待办收起动画的定时器 */
  removeTimer: null,

  data: {
    incomeText: '¥0.00',
    expenseText: '¥0.00',
    balanceText: '¥0.00',
    balanceClass: '',
    monthCount: 0,
    pendingCount: 0,
    monthBar: emptyView(),
    dayBar: emptyView(),
    hasBudget: false,
    todoBar: emptyView(),
    todoBanner: emptyBanner(),
    recent: [] as LedgerRecord[],
    recentTodos: [] as NoteItem[],
    pinnedId: '',
    pinnedHeight: 0,
    removingId: '',
    todoEmptyText: '还没有待办，加一条吧',
    currency: '¥',
    hasLedger: false,
    hasTodos: false,
    pageStyle: '',
    pageBg: LIGHT_COLORS.pageBg,
    navBarBg: LIGHT_COLORS.pageBg,
    navBarColor: 'black',
  },

  onLoad() {
    // 只保留模板无法自行推导的字段：待办数由 store 直接驱动。
    // 记账相关的展示文案需要在 refresh() 里做金额格式化，因此不额外绑定 records / monthSummary。
    this.bindings = [
      createStoreBindings(this, { store: notesStore, fields: ['pendingCount'] }),
    ];
    attachPageTheme(this);
  },

  onUnload() {
    this.bindings.forEach((b) => b.destroyStoreBindings());
    this.roller?.cancel();
    this.roller = null;
    if (this.removeTimer) {
      clearTimeout(this.removeTimer);
      this.removeTimer = null;
    }
    detachPageTheme(this);
  },

  onShow() {
    // 先套主题（内部会重钉 tabBar）：系统 tabBar 可能在页面切换时被框架按 theme.json 重画过，
    // 越早钉，越不容易看到"tab 栏先错一下再变对"
    applyPageTheme(this);
    ledgerStore.load();
    notesStore.load();
    settingsStore.load();
    this.refresh();
    // 进入小程序/回到首页时看一眼额度（弹窗，每天最多一次）
    this.noticeBudget();
  },

  /** 重新计算首页展示数据 */
  refresh() {
    const s = ledgerStore.monthSummary;
    const cur = settingsStore.settings.currency;
    const records = ledgerStore.records;

    // 首页的待办区只放**未完成**的待办：完成的会被收走，否则"待办"里躺着做完的事很别扭。
    // 进度条仍按全部待办统计，所以完成一条时条会往前走，即使那一行已经消失。
    const todos = allTodos();
    const pending = todos.filter((n) => !n.done);

    // 额度进度条视图（纯计算在 utils/budget 的 budgetViews，首页与潜在的其它入口共用一套口径）
    const budget = budgetViews(records, settingsStore.settings);

    this.setData({
      incomeText: formatMoney(s.income, cur),
      expenseText: formatMoney(s.expense, cur),
      monthCount: ledgerStore.monthCount,
      currency: cur,
      recent: records.slice(0, RECENT_LIMIT),
      recentTodos: pending.slice(0, RECENT_LIMIT),
      hasLedger: records.length > 0,
      hasTodos: pending.length > 0,
      todoEmptyText: todos.length > 0 ? '待办都完成啦，加一条新的吧' : '还没有待办，加一条吧',
      todoBar: todoProgressView(todos.length - pending.length, todos.length),
      // 到期待办横幅（不打扰式：常驻展示，点了去记事页处理）
      todoBanner: dueBannerView(pending, Date.now()),
      hasBudget: budget.hasBudget,
      monthBar: budget.monthBar,
      dayBar: budget.dayBar,
    });
    this.startBalance(s.balance);
  },

  /** 待办完成度视图（与 strip 里那一行同源，完成动画中途也要能单独更新它） */
  buildTodoView() {
    const todos = allTodos();
    return todoProgressView(todos.filter((n) => n.done).length, todos.length);
  },

  /**
   * 进入小程序（回到首页）时检查额度
   *
   * 达到/超出额度用**弹窗**提示，且同一次超额只弹一次（见 utils/budget-alert）：
   * 每次切 tab 回首页都弹的话，很快就会被用户无视、变成噪音。
   *
   * 先 resync 再弹：如果当前已经不超额（比如把超支那笔删掉了），
   * 就把"今天已提醒"作废，于是再加一笔重新超额时还能收到提醒。
   */
  noticeBudget() {
    const settings = settingsStore.settings;
    const text = currentBudgetAlert({
      records: ledgerStore.records,
      dailyBudget: settings.dailyBudget,
      monthlyBudget: settings.monthlyBudget,
      currency: settings.currency,
    });
    resyncBudgetNotice(text);
    showBudgetAlertOnce(text);
  },

  /**
   * 结余数字滚动：从上次展示的值滚到新值（首屏 / 值未变时直接落位）
   * 状态与取消逻辑在 utils/motion 的 createBalanceRoller 里（与记账列表共用同一套口径）。
   * @param target 目标结余（分）
   */
  startBalance(target: number) {
    if (!this.roller) {
      this.roller = createBalanceRoller((v) =>
        this.setData({
          balanceText: formatMoney(v, this.data.currency, true),
          balanceClass: v < 0 ? 'amount--expense' : '',
        })
      );
    }
    this.roller.roll(target);
  },

  /**
   * 去记账：直接进「记一笔」
   *
   * （曾经改成"先切到记账页再自动打开编辑页"，以便返回落在记账页；
   *  但那样点下去会先闪一下列表页，用户反馈不接受，已改回直接打开编辑页）
   */
  goAddLedger() {
    haptic('light');
    wx.navigateTo({ url: '/pages/ledger/edit/index' });
  },

  /** 去记事：直接进「写点什么」（默认类型为笔记） */
  goAddNote() {
    haptic('light');
    wx.navigateTo({ url: '/pages/notes/edit/index' });
  },

  /** 首页的记事区只放待办，新增入口也直接落到「待办」 */
  goAddTodo() {
    haptic('light');
    wx.navigateTo({ url: '/pages/notes/edit/index?kind=todo' });
  },

  /** 查看全部记账 */
  goLedgerList() {
    haptic('light');
    wx.switchTab({ url: '/pages/ledger/list/index' });
  },

  /** 查看全部记事 */
  goNotesList() {
    haptic('light');
    wx.switchTab({ url: '/pages/notes/list/index' });
  },

  /** 分类统计 */
  goStats() {
    haptic('light');
    wx.navigateTo({ url: '/pages/stats/index' });
  },

  /** 待办清单：切到记事页并落在「待办」页签（switchTab 不能带参，走 store 的一次性落点意图） */
  goTodos() {
    haptic('light');
    notesStore.setPendingTab(1);
    wx.switchTab({ url: '/pages/notes/list/index' });
  },

  /** 还没设置额度时，从汇总卡直接进设置页 */
  goSettings() {
    haptic('light');
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  /**
   * 长按最近记账 → 编辑
   * @param e ledger-card 冒泡的 edit 事件
   */
  onEditRecord(e: { detail: { id: string } }) {
    wx.navigateTo({ url: '/pages/ledger/edit/index?id=' + e.detail.id });
  },

  /**
   * 长按最近记事 → 编辑
   * @param e note-item 冒泡的 edit 事件
   */
  onEditNote(e: { detail: { id: string } }) {
    wx.navigateTo({ url: '/pages/notes/edit/index?id=' + e.detail.id });
  },

  /**
   * 勾选最近待办 → 完成，并用"整行收起"把它从列表里送走
   *
   * 完成后它就不再是"待办"了，直接 setData 删掉会凭空消失，所以走一遍动画：
   * ① 先把这一条标成已完成（勾选立刻画出来），同时更新完成度进度条
   * ② 量出这一行的高度并写成内联 max-height —— CSS 无法从 auto 过渡到 0，
   *    没有确定的起点，收起就是"跳"而不是"滑"
   * ③ 下一帧再挂上收起类（顺序不能颠倒，否则起点还是 auto，动画不生效）
   * ④ 动画结束才真正刷新列表，此时第 4 条待办正好补上来
   *
   * 取消完成（把已完成的改回未完成）在首页是够不到的——已完成的不在列表里，
   * 走 else 分支只是兜底。
   *
   * @param e note-item 冒泡的 toggle 事件
   */
  onToggleNote(e: { detail: { id: string } }) {
    const id = e.detail.id;
    const before = notesStore.items.find((n) => n.id === id);
    if (!before) return;

    const completing = !before.done;
    haptic(completing ? 'medium' : 'light');
    try {
      notesStore.toggleDone(id);
    } catch (err) {
      wx.showToast({ title: err instanceof Error ? err.message : '操作失败', icon: 'none' });
      return;
    }

    // 收尾两种情况统一走"直接刷新"：
    // - 取消完成（首页够不到，只是兜底）
    // - 上一行的收起动画还没跑完就又勾了一条：不叠动画，
    //   否则第二次 setData 会覆盖 pinnedId / removingId，第一行会先"弹回去"再消失
    if (!completing || this.data.removingId) {
      this.refresh();
      return;
    }

    // ① 勾选先画出来；进度条同时前进，不必等动画结束
    const recentTodos = this.data.recentTodos.map((t) =>
      t.id === id ? Object.assign({}, t, { done: true }) : t
    );
    this.setData({ recentTodos, todoBar: this.buildTodoView() });

    // ② 量高 → 钉住
    measureHeights(this, '#todo-' + id, (heights) => {
      const height = heights[0] ?? 0;
      if (!height) {
        // 量不到（节点已消失等）：退化成直接刷新，至少不会卡住
        this.refresh();
        return;
      }
      this.setData({ pinnedId: id, pinnedHeight: height }, () => {
        wx.nextTick(() => {
          // ③ 起点已落定，这一帧才加收起类
          this.setData({ removingId: id });
          // ④ 等过渡跑完再动数据
          if (this.removeTimer) clearTimeout(this.removeTimer);
          this.removeTimer = setTimeout(() => {
            this.removeTimer = null;
            this.setData({ pinnedId: '', pinnedHeight: 0, removingId: '' }, () => this.refresh());
          }, COLLAPSE_DURATION_MS);
        });
      });
    });
  },
});
