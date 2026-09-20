import { defineSwipeSelectPage, swipeSelectData } from '../../../behaviors/swipe-select';
import type { SwipeSelectData, SwipeSelectMethods } from '../../../behaviors/swipe-select';
import { ledgerStore } from '../../../store/ledger.store';
import { settingsStore } from '../../../store/settings.store';
import { formatMoney } from '../../../utils/money';
import { daySummaryText, groupByDate } from '../../../utils/group';
import type { LedgerDayGroup } from '../../../utils/group';
import { buildMixSegments } from '../../../utils/chart';
import type { MixSegment } from '../../../utils/chart';
import { sumByCategory } from '../../../utils/stats';
import { monthOf } from '../../../utils/date';
import { currentBudgetAlert, resyncBudgetNotice } from '../../../utils/budget-alert';
import { LedgerType } from '../../../types/models';
import { createBalanceRoller } from '../../../utils/motion';
import type { BalanceRoller } from '../../../utils/motion';
import { haptic } from '../../../utils/haptics';
import { LIGHT_COLORS, applyPageTheme, attachPageTheme, detachPageTheme } from '../../../utils/theme';
import type { LedgerRecord } from '../../../types/models';

/** 分组 + 当日小计文案 */
interface DayGroupView extends LedgerDayGroup {
  summaryText: string;
}

/** 页面 data（滑动多选部分由 behaviors/swipe-select 提供） */
interface LedgerListData extends SwipeSelectData {
  groups: DayGroupView[];
  incomeText: string;
  expenseText: string;
  balanceText: string;
  balanceClass: string;
  currency: string;
  /** 本月支出分类占比（汇总卡里的占比条） */
  mixItems: MixSegment[];
  /** 本月支出合计文案 */
  mixTotalText: string;
  pageStyle: string;
  pageBg: string;
  navBarBg: string;
  navBarColor: 'black' | 'white';
}

/**
 * 页面自定义实例字段与方法
 *
 * 多选/滑删/撤销的编排全部来自 behaviors/swipe-select（SwipeSelectMethods）；
 * 页面只保留差异：结余滚动、汇总组装、导航与编辑跳转，以及两个钩子
 * visibleIds() / refresh(extra?)。
 */
interface LedgerListCustom extends SwipeSelectMethods {
  /** 结余滚动器（onLoad 创建，onUnload 取消） */
  roller: BalanceRoller | null;
  refresh(extra?: Partial<LedgerListData>): void;
  visibleIds(): string[];
  startBalance(target: number): void;
  goEdit(): void;
  goStats(): void;
  onEdit(e: { detail: { id: string } }): void;
}

/** 传给 defineSwipeSelectPage 的"页面差异部分"（共享成员由 mixin 在运行时补上） */
type LedgerListPageCustom = Omit<LedgerListCustom, keyof SwipeSelectMethods>;

/**
 * 说明：本页所有展示内容都是"格式化后的文案"，无法由 store 字段直接驱动，
 * 因此不建立 store 绑定，统一由 refresh() 计算；数据变更路径（返回本页 / 删除）
 * 都会经过 onShow 或显式 refresh()。
 */
Page<LedgerListData, LedgerListCustom>(
  defineSwipeSelectPage<LedgerRecord, LedgerListData, LedgerListPageCustom>(
    {
      enterHintKey: 'ledger-swipe-enter',
      enterHintText: '右滑记录可多选',
      exitHintKey: 'ledger-swipe-exit',
      exitHintText: '左滑记录可退出多选',
      noPickToast: '先选择要删除的记录',
      undoText: (n) => `已删除 ${n} 条记录`,
      removeItems: (ids) => ledgerStore.removeMany(ids),
      restoreItems: (items) => ledgerStore.restore(items),
    },
    {
      /** 结余滚动器（onLoad 创建） */
      roller: null,

      data: {
        ...swipeSelectData(),
        groups: [] as DayGroupView[],
        incomeText: '¥0.00',
        expenseText: '¥0.00',
        balanceText: '¥0.00',
        balanceClass: '',
        currency: '¥',
        mixItems: [] as MixSegment[],
        mixTotalText: '',
        pageStyle: '',
        pageBg: LIGHT_COLORS.pageBg,
        navBarBg: LIGHT_COLORS.pageBg,
        navBarColor: 'black',
      },

      onLoad() {
        this.roller = createBalanceRoller((v) =>
          this.setData({
            balanceText: formatMoney(v, this.data.currency, true),
            balanceClass: v < 0 ? 'amount--expense' : '',
          })
        );
        attachPageTheme(this);
      },

      onUnload() {
        this.roller?.cancel();
        this.roller = null;
        if (this.removeTimer) {
          clearTimeout(this.removeTimer);
          this.removeTimer = null;
        }
        this.clearExitTimer();
        detachPageTheme(this);
      },

      onShow() {
        // 先套主题（内部会重钉 tabBar）：系统 tabBar 可能在页面切换时被框架按 theme.json 重画过，
        // 越早钉，越不容易看到"tab 栏先错一下再变对"
        applyPageTheme(this);
        ledgerStore.load();
        settingsStore.load();
        // 从编辑页回来时退出多选，避免选中集合与重新加载的数据对不上
        if (this.data.selecting) this.clearPick();
        // 撤销条只在本次操作后短暂停留，切页即作废
        if (this.data.undoVisible) {
          this.stash = [];
          this.setData({ undoVisible: false });
        }
        this.refresh();
        // 滑开的删除块不能跨页存活：本页是 tab 页，切走不会卸载，回来仍是展开状态。
        // resetSwipes 是**终止型**收口（清记录 + 两槽宽度归零，当帧不还原）：
        // 之所以不"归零一帧再还原"，是因为两次 setData 落在同一批次时，
        // Vant 的 swipeMove(0) 会被宽度 observer 的 swipeMove(newWidth) 覆盖，
        // 行反而停在半开位（现象：能看到一小部分删除块往回缩、该行再也滑不动）。
        // 宽度恢复交给下一帧的 restoreSwipeWidth()：那时 Vant 的 observer 已经真的跑过、offset 已归零。
        this.resetSwipes();
        wx.nextTick(() => this.restoreSwipeWidth());
        this.hintSwipe();
      },

      onHide() {
        // 切 tab / 跳去编辑页时立刻收回滑开的行（只靠 onShow 收会在返回瞬间闪一下展开态）。
        // 这里同样用终止型收口而不是 closeAllSwipes：隐藏时不需要宽度，也就不必承担
        // "归零 → 还原"的批次竞争风险；回到本页时 onShow 会先还原宽度再刷新。
        this.resetSwipes();
        // 待执行的"退出多选"一并作废：回到本页时 onShow 会自己收口
        this.clearExitTimer();
      },

      /**
       * 刷新汇总与分组列表
       * @param extra 需要与本次刷新合并进**同一次 setData** 的字段
       *   （分两次写会在两帧之间露出"该行又回来了"的中间态，列表看着闪一下）
       */
      refresh(extra: Partial<LedgerListData> = {}) {
        const s = ledgerStore.monthSummary;
        const cur = settingsStore.settings.currency;
        const groups: DayGroupView[] = groupByDate(ledgerStore.records).map((g) =>
          Object.assign({}, g, { summaryText: daySummaryText(g, cur) })
        );
        // 占比条与统计页同源：都按月、按支出聚合
        const month = monthOf();
        const monthRecords = ledgerStore.records.filter((r) => r.date.slice(0, 7) === month);
        const mixItems = buildMixSegments(
          sumByCategory(monthRecords, LedgerType.Expense).map((c) => ({
            label: c.label,
            value: c.value,
          }))
        );
        const patch: Partial<LedgerListData> = {
          incomeText: formatMoney(s.income, cur),
          expenseText: formatMoney(s.expense, cur),
          currency: cur,
          groups,
          mixItems,
          mixTotalText: mixItems.length ? formatMoney(s.expense, cur) : '',
        };
        // 合并 extra 后一次写完：删除时若"先清收起态、下一帧才移除该行"，
        // 那一行会先复原一帧，其余行跟着上下跳
        this.setData(Object.assign(patch, extra));
        this.startBalance(s.balance);

        // 数据会变动的路径（切回本页 / 删除 / 撤销）都会经过 refresh，所以顺手校准额度提醒的去重记录：
        // 删掉超支那笔之后已经不超额，就要把"今天已提醒"作废 ——
        // 否则用户"删了再记一笔重新超额"时不会再收到提醒（这就是被反馈的那个 bug）。
        resyncBudgetNotice(
          currentBudgetAlert({
            records: ledgerStore.records,
            dailyBudget: settingsStore.settings.dailyBudget,
            monthlyBudget: settingsStore.settings.monthlyBudget,
            currency: cur,
          })
        );
      },

      /**
       * 结余数字滚动（状态与取消逻辑在 utils/motion 的滚动器里）
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

      /** 新增记账 */
      goEdit() {
        haptic('light');
        wx.navigateTo({ url: '/pages/ledger/edit/index' });
      },

      /** 分类统计（占比条点击入口） */
      goStats() {
        haptic('light');
        wx.navigateTo({ url: '/pages/stats/index' });
      },

      /**
       * 长按卡片进入编辑
       * @param e ledger-card 冒泡的 edit 事件
       */
      onEdit(e: { detail: { id: string } }) {
        wx.navigateTo({ url: '/pages/ledger/edit/index?id=' + e.detail.id });
      },

      /** 当前列表可见记录 id（按展示顺序：分组顺序 → 组内顺序） */
      visibleIds(): string[] {
        const ids: string[] = [];
        this.data.groups.forEach((g) => g.items.forEach((r) => ids.push(r.id)));
        return ids;
      },
    }
  )
);
