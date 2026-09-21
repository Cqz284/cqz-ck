import { defineSwipeSelectPage, swipeSelectData } from '../../../behaviors/swipe-select';
import type { SwipeSelectData, SwipeSelectMethods } from '../../../behaviors/swipe-select';
import { ledgerStore } from '../../../store/ledger.store';
import { settingsStore } from '../../../store/settings.store';
import { summarize } from '../../../service/ledger.service';
import { formatMoney } from '../../../utils/money';
import { daySummaryText, groupByDate } from '../../../utils/group';
import type { LedgerDayGroup } from '../../../utils/group';
import { buildMixSegments } from '../../../utils/chart';
import type { MixSegment } from '../../../utils/chart';
import { sumByCategory } from '../../../utils/stats';
import { monthLabel, monthOf, shiftMonth } from '../../../utils/date';
import { debounce } from '../../../utils/debounce';
import type { DebouncedFn } from '../../../utils/debounce';
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

/** 搜索防抖等待时长（毫秒），与记事页同口径 */
const SEARCH_WAIT = 300;

/** 下滑自动收起搜索行的位移阈值（px）：一次明确的向下滚动才收，轻微抖动 / 回弹不打扰 */
const SEARCH_SCROLL_HIDE_PX = 24;

/**
 * 失焦自动收起的延迟（毫秒）
 *
 * 给「点导航栏图标」让路：点图标那一下输入框会先 blur，若立即收起，
 * onToggleSearch 会看到"未展开"而把它重新展开 —— 一点图标反而弹开。
 */
const SEARCH_BLUR_HIDE_MS = 180;

/** 页面 data（滑动多选部分由 behaviors/swipe-select 提供） */
interface LedgerListData extends SwipeSelectData {
  groups: DayGroupView[];
  incomeText: string;
  expenseText: string;
  balanceText: string;
  balanceClass: string;
  currency: string;
  /** 所选月份支出分类占比（汇总卡里的占比条） */
  mixItems: MixSegment[];
  /** 所选月份支出合计文案 */
  mixTotalText: string;
  /** 当前查看的月份 YYYY-MM（onLoad 定为当月，可切到任意历史月） */
  month: string;
  /** 月份文案（2026年9月） */
  monthText: string;
  /** 年月选择器的上限（当前月，禁止选未来） */
  maxMonth: string;
  /** 是否可以切到下一月（已在当前月时为 false，按钮置灰） */
  canNext: boolean;
  /** 搜索行是否展开（导航栏右侧图标开合；收起时关键词一并清空） */
  searchOpen: boolean;
  /** 搜索关键词（限当前所选月份内，匹配备注/标签） */
  keyword: string;
  /** 所选月份是否一条记录都没有（区分「该月没记账」与「搜索无结果」两种空态） */
  monthEmpty: boolean;
  /** 汇总卡标签：本月结余 / 当月结余 */
  summaryLabel: string;
  /** 占比条标题：本月支出构成 / 某月支出构成 */
  mixTitle: string;
  pageStyle: string;
  pageBg: string;
  navBarBg: string;
  navBarColor: 'black' | 'white';
}

/**
 * 页面自定义实例字段与方法
 *
 * 多选/滑删/撤销的编排全部来自 behaviors/swipe-select（SwipeSelectMethods）；
 * 搜索入口在导航栏右侧插槽（wxml 的 slot="right"），页面自己管开合与过滤；
 * 页面只保留差异：结余滚动、汇总组装、月份切换、搜索、导航与编辑跳转，
 * 以及两个钩子 visibleIds() / refresh(extra?)。
 */
interface LedgerListCustom extends SwipeSelectMethods {
  /** 结余滚动器（onLoad 创建，onUnload 取消） */
  roller: BalanceRoller | null;
  /** 上一次的 scrollTop（px；-1 = 尚未滚过，滚动收起搜索行用） */
  searchLastTop: number;
  /** 失焦自动收起的延时器（点图标开合 / onUnload 时作废） */
  searchBlurHideTimer: ReturnType<typeof setTimeout> | null;
  /** 防抖后的搜索提交（onLoad 中重建，onUnload 中取消） */
  commitSearch: DebouncedFn<(kw: string) => void>;
  refresh(extra?: Partial<LedgerListData>): void;
  visibleIds(): string[];
  startBalance(target: number): void;
  goEdit(): void;
  goStats(): void;
  onEdit(e: { detail: { id: string } }): void;
  /** 月份切换：上一月 */
  onPrevMonth(): void;
  /** 月份切换：下一月（最多回到当前月） */
  onNextMonth(): void;
  /** 月份切换：点月份文字弹年月选择器直达 */
  onPickMonth(e: { detail: { value: string } }): void;
  /** 搜索框输入（防抖后过滤列表） */
  onSearch(e: { detail: string | { value?: string } }): void;
  /** 搜索开合（导航栏右侧图标）：展开输入行；已展开时再点 = 收起并清词 */
  onToggleSearch(): void;
  /** 收起搜索行并清空关键词（再次点导航栏图标；搜索行不可见时过滤不应悄悄生效） */
  closeSearch(): void;
  /** 只收起输入行、保留关键词（下滑浏览搜索结果时自动收，过滤继续生效） */
  collapseSearch(): void;
  /** 页面滚动驱动的自动收起（onPageScroll 调用）：向下滚过阈值才收 */
  onSearchScrollHide(scrollTop: number): void;
  /** 输入框失焦 → 延迟收起搜索行（保留关键词；实现里有与点图标的竞争说明） */
  onSearchBlur(e: { detail?: string | { value?: string } }): void;
  /** 作废待执行的失焦收起 */
  clearSearchBlurHide(): void;
  /**
   * 只清空选中、保留多选模式
   * 用于月份/搜索变化：列表内容变了，旧的勾选要么看不见、要么语义错位，直接重置最不容易出错
   */
  resetPick(): void;
}

/** 传给 defineSwipeSelectPage 的"页面差异部分"（共享成员由 mixin 在运行时补上） */
type LedgerListPageCustom = Omit<LedgerListCustom, keyof SwipeSelectMethods>;

/**
 * 说明：本页所有展示内容都是"格式化后的文案"，无法由 store 字段直接驱动，
 * 因此不建立 store 绑定，统一由 refresh() 计算；数据变更路径（返回本页 / 删除）
 * 都会经过 onShow 或显式 refresh()。
 *
 * 月份口径（2026-09-21 定稿）：data.month 是"正在查看的月份"，可以是任意历史月；
 * 汇总卡 / 占比条 / 分组列表都跟着它走（用 summarize(records, month) 现算，
 * 不能再用 store 的 monthSummary——那永远是真实当月）。
 * 额度提醒仍然只与真实当月有关，看历史月时不参与。
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
      /** 上一次的 scrollTop（px；-1 = 尚未滚过，首次滚动不做方向判定） */
      searchLastTop: -1,
      /** 失焦自动收起的延时器（点图标开合 / onUnload 时作废） */
      searchBlurHideTimer: null,
      /** 防抖后的搜索提交（onLoad 中重建，onUnload 中取消） */
      commitSearch: debounce((_kw: string) => {}, SEARCH_WAIT),

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
        month: '',
        monthText: '',
        maxMonth: '',
        canNext: false,
        searchOpen: false,
        keyword: '',
        monthEmpty: true,
        summaryLabel: '本月结余',
        mixTitle: '本月支出构成',
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
        this.commitSearch = debounce((kw: string) => {
          this.setData({ keyword: kw });
          this.refresh();
          this.resetPick();
        }, SEARCH_WAIT);
        // 默认查看当月；maxMonth 供年月选择器封顶（禁止选未来）
        const month = monthOf();
        this.setData({ month, maxMonth: month });
        attachPageTheme(this);
      },

      onUnload() {
        this.roller?.cancel();
        this.roller = null;
        // 取消未执行的防抖，避免页面销毁后仍触发 setData
        this.commitSearch.cancel();
        if (this.removeTimer) {
          clearTimeout(this.removeTimer);
          this.removeTimer = null;
        }
        this.clearSearchBlurHide();
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
        // 切页**不**收口（2026-09-21 定稿）：滑开的删除块跨页保留原样，"就不动它"。
        // 之前的"切页时宽度归零→还原"正是"快速切页后那一行滑不动"的根源，已整个移除；
        // 收口时机改为页面滚动（onPageScroll → closeSwipesOnScroll）。
        this.hintSwipe();
      },

      onHide() {
        // 切页 / 跳去编辑页都不收回滑开的行：跨页保留原样（用户定稿）。
        // 只作废待执行的"退出多选"提示块：回到本页时 onShow 会自己收口
        this.clearExitTimer();
      },

      /**
       * 页面滚动：收回滑开的行；搜索行展开时向下滚过阈值自动收起（保留关键词）
       */
      onPageScroll(e: { scrollTop: number }) {
        this.closeSwipesOnScroll();
        this.onSearchScrollHide(e.scrollTop);
      },

      /**
       * 刷新汇总与分组列表
       * @param extra 需要与本次刷新合并进**同一次 setData** 的字段
       *   （分两次写会在两帧之间露出"该行又回来了"的中间态，列表看着闪一下）
       */
      refresh(extra: Partial<LedgerListData> = {}) {
        const cur = settingsStore.settings.currency;
        const month = this.data.month || monthOf();
        const isCurMonth = month === monthOf();

        // 所选月份的全部记录：汇总与占比条的口径（不看搜索词）
        const monthRecords = ledgerStore.records.filter((r) => r.date.slice(0, 7) === month);
        // 搜索只过滤列表、不动汇总数字：汇总卡始终回答"这个月收支如何"，
        // 搜"早餐"时结余突然变成"早餐的结余"反而让人怀疑数据错了
        const kw = this.data.keyword.trim().toLowerCase();
        const listed = kw
          ? monthRecords.filter(
              (r) =>
                (r.remark ?? '').toLowerCase().includes(kw) ||
                (r.tag ?? '').toLowerCase().includes(kw)
            )
          : monthRecords;
        const groups: DayGroupView[] = groupByDate(listed).map((g) =>
          Object.assign({}, g, { summaryText: daySummaryText(g, cur) })
        );

        // 汇总按所选月份现算（summarize 是全项目唯一的收支汇总实现）
        const summary = summarize(ledgerStore.records, month);
        // 占比条与统计页同源：按所选月份、按支出聚合
        const mixItems = buildMixSegments(
          sumByCategory(monthRecords, LedgerType.Expense).map((c) => ({
            label: c.label,
            value: c.value,
          }))
        );

        const patch: Partial<LedgerListData> = {
          monthText: monthLabel(month),
          canNext: !isCurMonth,
          monthEmpty: monthRecords.length === 0,
          summaryLabel: isCurMonth ? '本月结余' : '当月结余',
          mixTitle: isCurMonth ? '本月支出构成' : `${monthLabel(month)}支出构成`,
          incomeText: formatMoney(summary.income, cur),
          expenseText: formatMoney(summary.expense, cur),
          currency: cur,
          groups,
          mixItems,
          mixTotalText: mixItems.length ? formatMoney(summary.expense, cur) : '',
        };
        // 合并 extra 后一次写完：删除时若"先清收起态、下一帧才移除该行"，
        // 那一行会先复原一帧，其余行跟着上下跳
        this.setData(Object.assign(patch, extra));
        this.startBalance(summary.balance);

        // 额度提醒只与"真实当月"有关（currentBudgetAlert 内部自己按当月算）。
        // 回看历史月时不参与：看去年的账单不该影响"今天是否已提醒过超额"的去重记录。
        if (isCurMonth) {
          resyncBudgetNotice(
            currentBudgetAlert({
              records: ledgerStore.records,
              dailyBudget: settingsStore.settings.dailyBudget,
              monthlyBudget: settingsStore.settings.monthlyBudget,
              currency: cur,
            })
          );
        }
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

      /** 上一月 */
      onPrevMonth() {
        haptic('light');
        this.setData({ month: shiftMonth(this.data.month || monthOf(), -1) });
        this.refresh();
        this.resetPick();
      },

      /** 下一月（最多回到当前月，YYYY-MM 零 padded 字符串可直接比较） */
      onNextMonth() {
        const cur = monthOf();
        const next = shiftMonth(this.data.month || cur, 1);
        if (next > cur) return;
        haptic('light');
        this.setData({ month: next });
        this.refresh();
        this.resetPick();
      },

      /**
       * 点月份文字弹年月选择器（picker fields="month"，end 封顶当前月）
       * @param e picker 的 change 事件，detail.value 为 YYYY-MM
       */
      onPickMonth(e: { detail: { value: string } }) {
        const month = String(e.detail.value ?? '').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month) || month === this.data.month) return;
        haptic('light');
        this.setData({ month });
        this.refresh();
        this.resetPick();
      },

      /** 搜索框输入（van-search 的 change；防抖后过滤列表） */
      onSearch(e: { detail: string | { value?: string } }) {
        const kw = typeof e.detail === 'string' ? e.detail : e.detail?.value ?? '';
        this.commitSearch(kw);
      },

      /** 搜索开合：展开输入行（自动聚焦）；已展开时再点 = 收起并清词 */
      onToggleSearch() {
        haptic('light');
        // 作废待执行的"失焦收起"：点图标那一下会先触发输入框 blur（见 onSearchBlur）
        this.clearSearchBlurHide();
        if (this.data.searchOpen) {
          this.closeSearch();
          return;
        }
        this.setData({ searchOpen: true });
      },

      /** 收起搜索行并清空关键词（再次点导航栏图标；搜索行不可见时，过滤不应还悄悄生效） */
      closeSearch() {
        // 先作废失焦收起再判早退：哪怕行已收起，也不能让残留延时器之后再动一次
        this.clearSearchBlurHide();
        if (!this.data.searchOpen) return;
        // 作废未执行的防抖，否则关掉后它还会把关键词写回来
        this.commitSearch.cancel();
        this.setData({ searchOpen: false, keyword: '' });
        this.refresh();
        this.resetPick();
      },

      /** 只收起输入行、保留关键词：下滑浏览搜索结果时自动收起，列表过滤继续生效 */
      collapseSearch() {
        if (!this.data.searchOpen) return;
        this.setData({ searchOpen: false });
      },

      /**
       * 滚动驱动的搜索行收起
       * 只认"明确的向下滚动"（一次位移超过 SEARCH_SCROLL_HIDE_PX），
       * 轻微抖动 / iOS 回弹不打扰；向上滚动不收（用户可能想回去改词）。
       * 防抖中的关键词不作废：收起后它照常落库，过滤结果与输入框保持一致。
       */
      onSearchScrollHide(scrollTop: number) {
        const prev = this.searchLastTop;
        this.searchLastTop = scrollTop;
        if (!this.data.searchOpen) return;
        if (prev >= 0 && scrollTop - prev > SEARCH_SCROLL_HIDE_PX) this.collapseSearch();
      },

      /**
       * 失焦自动收起（van-search 的 blur：点了页面其它地方 / 键盘「完成」）
       * 口径：只在输入框为空时收起 —— 有关键词时用户多半是在浏览结果，
       * 收掉输入行反而打断（点图标能随时重新展开）。空着失焦才收。
       * 只收输入行、保留关键词（过滤结果还在下面，清词会让列表跳回全部）。
       * 延迟 SEARCH_BLUR_HIDE_MS 是给「点导航栏图标」让路 —— 点图标那一下
       * input 先 blur，立即收起的话 onToggleSearch 会看到"未展开"而把它重新展开。
       * blur 事件 detail 就是当前输入值（vant 透传），用它判断可避开防抖落库延迟。
       */
      onSearchBlur(e: { detail?: string | { value?: string } }) {
        if (!this.data.searchOpen) return;
        const d = e?.detail;
        const raw = typeof d === 'string' ? d : d?.value ?? '';
        if (String(raw).trim() || this.data.keyword.trim()) return;
        if (this.searchBlurHideTimer) clearTimeout(this.searchBlurHideTimer);
        this.searchBlurHideTimer = setTimeout(() => {
          this.searchBlurHideTimer = null;
          this.collapseSearch();
        }, SEARCH_BLUR_HIDE_MS);
      },

      /** 作废待执行的失焦收起（点图标开合 / onUnload 时调用） */
      clearSearchBlurHide() {
        if (!this.searchBlurHideTimer) return;
        clearTimeout(this.searchBlurHideTimer);
        this.searchBlurHideTimer = null;
      },

      /** 只清空选中、保留多选模式（月份/搜索变化时用） */
      resetPick() {
        if (!this.data.selecting) return;
        this.pickedOrder = [];
        this.setData({ pickMap: {}, pickedCount: 0, allPicked: false });
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
