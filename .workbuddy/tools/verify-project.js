/**
 * 项目完整性复核脚本
 *
 * 为什么需要它：这个项目出现过多次"文件被外部覆盖回旧版本 / 整个文件消失"，
 * 而 `tsc --noEmit` 只查类型，查不出"某个方法被回退没了""某个 wxml 里的按钮又回来了"。
 * 因此每次改完都跑一遍：既查标记，也查页面/组件四件套与注册表是否齐全。
 *
 * 用法：
 *   node .workbuddy/tools/verify-project.js
 *   退出码非 0 表示有问题；加 --quiet 只打印问题。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const QUIET = process.argv.includes('--quiet');

/** 关键标记：[文件, 必须包含的字符串, 说明] */
const MARKERS = [
  // —— 编辑页：保存独占整行（居中），删除入口已移除 ——
  ['pages/ledger/edit/index.wxml', 'onSubmit', '记账编辑页保存按钮'],
  ['pages/ledger/edit/index.wxml', 'edit-bar', '记账编辑页吸底条'],
  ['pages/notes/edit/index.wxml', 'edit-bar', '记事编辑页吸底条'],
  ['pages/ledger/edit/index.ts', 'onSubmit()', '记账编辑页提交'],
  ['pages/notes/edit/index.ts', 'onSubmit()', '记事编辑页提交'],
  ['app.wxss', 'justify-content: center', '吸底条居中'],

  // —— 列表页：右滑进多选 / 左滑退出 ——
  ['pages/ledger/list/index.wxml', "left-width=\"{{ swipeReset || selecting || openSideMap[item.id] === 'right' ? 0 : swipeWidth }}\"", '记账列表左槽宽度（含强制收回）'],
  ['pages/ledger/list/index.wxml', "right-width=\"{{ swipeReset || openSideMap[item.id] === 'left' ? 0 : swipeWidth }}\"", '记账列表右槽宽度（含强制收回）'],
  ['pages/ledger/list/index.wxml', 'bind:open="onSwipeOpen"', '记账列表滑开事件'],
  ['pages/ledger/list/index.wxml', 'swipe-act--primary', '记账列表右滑「多选」块'],
  ['pages/ledger/list/index.wxml', 'swipe-act--muted', '记账列表多选态「退出」块'],
  ['pages/ledger/list/index.wxml', 'name="success"', '记账列表勾选图标'],
  // —— 列表页滑删/多选编排已抽到 behaviors/swipe-select.ts（两列表页共用），实现类标记指向那里 ——
  ['behaviors/swipe-select.ts', 'onSwipeOpen(e:', '滑开处理（共享）'],
  ['behaviors/swipe-select.ts', 'closeAllSwipes() {', '收回滑开态（共享）'],
  ['behaviors/swipe-select.ts', 'onCellTouchEnd(e:', '离开校验实现（共享）'],
  ['behaviors/swipe-select.ts', 'openedSwipes: [],', '滑开记录字段（共享）'],
  ['behaviors/swipe-select.ts', 'swipeActionWidth()', '滑开距离用换算值（共享）'],
  ['behaviors/swipe-select.ts', 'SWIPE_CLOSE_MS', '退出多选延迟（共享）'],
  ['behaviors/swipe-select.ts', 'clearExitTimer', '退出定时器清理（共享）'],
  ['behaviors/swipe-select.ts', 'openSideMap', '滑开侧记录（共享）'],
  ['behaviors/swipe-select.ts', 'exitMap', '退出中性色块（共享）'],
  ['behaviors/swipe-select.ts', 'collapseRemove(ids: string[], done: () => void)', '删除收起动画编排（共享）'],
  // 滑开状态跨页收口的策略（2026-09-21 定稿）：
  // 切页**不收口**（"切页时宽度归零→还原"正是"快速切页后那一行滑不动"的根源，已整个移除），
  // 滑开的行跨页保留原样；收口时机改为页面滚动（onPageScroll → closeSwipesOnScroll）。
  ['behaviors/swipe-select.ts', 'closeSwipesOnScroll() {', '滚动收口（onPageScroll 调用，切页已不收口）'],
  ['behaviors/swipe-select.ts', 'if (self.data.swipeReset) {', '滚动收口顺手还原归零残留（防整页滑不动）'],
  ['behaviors/swipe-select.ts', 'rowResetTimer: ReturnType<typeof setTimeout> | null;', '单行补清的还原定时器（只服务 forceCloseRow）'],
  ['behaviors/swipe-select.ts', 'this.clearOpenSide(id);\n          return;', '多选态错位事件也清记录（防右槽宽度永久归零）'],
  ['pages/ledger/list/index.ts', 'onPageScroll(e: { scrollTop: number })', '记账列表滚动入口（收口）'],
  ['pages/ledger/list/index.ts', 'this.closeSwipesOnScroll();', '记账列表滚动时收回滑开的行（调用点）'],
  ['pages/notes/list/index.ts', 'onPageScroll(e: { scrollTop: number })', '记事列表滚动入口（收口）'],
  ['pages/notes/list/index.ts', 'this.closeSwipesOnScroll();', '记事列表滚动时收回滑开的行（调用点）'],
  // ===== 顶部搜索：导航栏图标 + 折叠输入行（2026-09-21 第三轮定稿）=====
  // 下拉跟手那套（utils/behaviors 的 search-reveal、.pull 位移容器、capture-bind 触摸）已整体拆除：
  // 三轮迭代（阈值弹出 → 跟手 → 几何修复）后复杂度仍与"低频兜底功能"不匹配，用户拍板放弃。
  // 现在是纯点按：导航栏右侧插槽（胶囊左侧工具区）放大镜图标 → 导航栏下方折叠展开输入行
  // （height + 淡入，260ms 缓出），取消/再点收起并清词；搜索语义保持限当月（记账）与当前页签/标签（记事）。
  ['pages/ledger/list/index.wxml', 'slot="right"', '记账列表导航栏搜索图标（右侧插槽）'],
  ['pages/ledger/list/index.wxml', 'bindtap="onToggleSearch"', '记账列表搜索开合（调用点）'],
  ['pages/ledger/list/index.wxml', 'search-fold--on', '记账列表搜索折叠展开态'],
  ['pages/ledger/list/index.ts', 'onToggleSearch() {', '记账列表搜索开合（方法）'],
  ['pages/ledger/list/index.ts', 'closeSearch() {', '记账列表搜索收起清词（方法）'],
  ['pages/ledger/list/index.ts', 'searchOpen: false,', '记账列表搜索开合状态字段'],
  ['pages/notes/list/index.wxml', 'slot="right"', '记事列表导航栏搜索图标（右侧插槽）'],
  ['pages/notes/list/index.wxml', 'bindtap="onToggleSearch"', '记事列表搜索开合（调用点）'],
  ['pages/notes/list/index.wxml', 'search-fold--on', '记事列表搜索折叠展开态'],
  ['pages/notes/list/index.ts', 'onToggleSearch() {', '记事列表搜索开合（方法）'],
  ['pages/notes/list/index.ts', 'closeSearch() {', '记事列表搜索收起清词（方法）'],
  ['pages/notes/list/index.ts', 'searchOpen: false,', '记事列表搜索开合状态字段'],
  ['app.wxss', '.search-fold {', '搜索折叠容器（两页共用）'],
  ['app.wxss', '.nav-search {', '导航栏搜索图标（右侧插槽内容）'],
  // 搜索行铺满对齐 + 下滑自动收起（2026-09-21 第四轮）
  ['app.wxss', '--search-padding: 0 var(--space-page);', '搜索框内边距换成页面留白令牌（铺满对齐下方卡片）'],
  ['pages/ledger/list/index.ts', 'onSearchScrollHide(scrollTop: number) {', '记账列表下滑自动收起搜索行（方法）'],
  ['pages/ledger/list/index.ts', 'this.onSearchScrollHide(e.scrollTop);', '记账列表滚动驱动搜索行收起（调用点）'],
  ['pages/ledger/list/index.ts', 'collapseSearch() {', '记账列表滚动收起（保留关键词，方法）'],
  ['pages/notes/list/index.ts', 'onSearchScrollHide(scrollTop: number) {', '记事列表下滑自动收起搜索行（方法）'],
  ['pages/notes/list/index.ts', 'this.onSearchScrollHide(e.scrollTop);', '记事列表滚动驱动搜索行收起（调用点）'],
  ['pages/notes/list/index.ts', 'collapseSearch() {', '记事列表滚动收起（保留关键词，方法）'],
  // 导航栏标题绝对定位居中（右侧插槽放搜索图标后，flex 流内布局会把标题挤偏）
  ['components/navigation-bar/navigation-bar.wxss', 'bottom: 0;\n  height: var(--height);', '导航栏标题绝对定位居中且贴底（不随左右插槽宽度偏移，也不吃状态栏高度的亏）'],
  ['components/navigation-bar/navigation-bar.wxss', 'pointer-events: none;', '标题层禁点击（否则全宽覆盖挡住右侧图标）'],
  // 统计页分类明细：常驻折叠容器 + 实测高度过渡（切换分类不跳变）
  ['pages/stats/index.wxml', 'detail-wrap', '统计明细折叠容器（height 过渡）'],
  ['pages/stats/index.ts', 'syncDetailHeight() {', '明细高度实测写入（方法）'],
  ['pages/stats/index.ts', 'collapseDetail() {', '明细收起走高度过渡（方法）'],
  ['pages/stats/index.ts', 'detailTick: this.data.detailTick + 1,', '明细内容版本交替重播淡入'],
  ['pages/stats/index.wxss', '.detail-wrap {', '统计明细容器样式（overflow hidden + height 过渡）'],
  // 挂载点（调用点）单独钉住：编排抽走后，页面必须还挂着 mixin 与可见 id 钩子
  ['pages/ledger/list/index.ts', 'defineSwipeSelectPage<LedgerRecord', '记账列表挂共享滑删编排'],
  ['pages/ledger/list/index.ts', 'visibleIds()', '记账列表可见 id 钩子'],
  ['pages/ledger/list/index.ts', 'onHide() {', '记账列表 onHide 收回'],
  ['pages/ledger/list/index.wxml', 'bind:click="onCellTap"', '记账列表点按清位置记录'],
  ['pages/ledger/list/index.wxml', 'bind:touchend="onCellTouchEnd"', '记账列表离开校验'],
  ['pages/ledger/list/index.wxml', "openSideMap[item.id] === 'right'", '记账列表反向滑动不翻面'],
  ['pages/notes/list/index.wxml', "left-width=\"{{ swipeReset || selecting || openSideMap[item.id] === 'right' ? 0 : swipeWidth }}\"", '记事列表左槽宽度（含强制收回）'],
  ['pages/notes/list/index.wxml', "right-width=\"{{ swipeReset || openSideMap[item.id] === 'left' ? 0 : swipeWidth }}\"", '记事列表右槽宽度（含强制收回）'],
  // ===== 记账列表：月份切换 + 搜索（2026-09-21）=====
  // 汇总/占比/列表必须跟随所选月份现算，不许退回 store 的 monthSummary（那是真实当月）
  ['pages/ledger/list/index.ts', 'summarize(ledgerStore.records, month)', '记账列表汇总按所选月份现算'],
  ['pages/ledger/list/index.ts', 'if (isCurMonth) {', '额度提醒只与真实当月有关（看历史月不参与）'],
  ['pages/ledger/list/index.ts', 'onPrevMonth()', '月份切换：上一月'],
  ['pages/ledger/list/index.ts', 'onNextMonth()', '月份切换：下一月（封顶当前月）'],
  ['pages/ledger/list/index.ts', 'onPickMonth(', '月份切换：年月选择器直达'],
  ['pages/ledger/list/index.ts', 'this.commitSearch.cancel();', '搜索防抖 onUnload 取消'],
  ['pages/ledger/list/index.wxml', 'fields="month"', '年月选择器（只选月）'],
  ['pages/ledger/list/index.wxml', 'end="{{ maxMonth }}"', '选择器封顶当前月（禁止选未来）'],
  ['pages/ledger/list/index.wxml', '<van-search', '记账列表搜索入口'],
  ['pages/ledger/list/index.wxml', 'bindtap="onPrevMonth"', '上一月按钮（调用点）'],
  ['pages/ledger/list/index.wxml', 'bindtap="onNextMonth"', '下一月按钮（调用点）'],
  ['pages/ledger/list/index.wxml', 'bindchange="onPickMonth"', '年月选择器回调（调用点）'],
  ['pages/ledger/list/index.json', '"van-search"', '记账列表注册 van-search'],
  // ===== 首页四格快捷入口 + 记事页落点意图（2026-09-21）=====
  ['pages/index/index.wxml', 'column-num="4"', '首页快捷入口四格'],
  ['pages/index/index.wxml', 'bind:click="goStats"', '统计入口（调用点）'],
  ['pages/index/index.wxml', 'bind:click="goTodos"', '待办清单入口（调用点）'],
  ['pages/index/index.ts', 'notesStore.setPendingTab(1)', '待办清单落点意图（switchTab 不能带参）'],
  ['store/notes.store.ts', 'setPendingTab: action(', '落点意图 action 实现'],
  ['pages/notes/list/index.ts', 'notesStore.setPendingTab(-1)', '落点意图只生效一次（读完即清）'],
  // ===== 记事标签（2026-09-21）=====
  ['types/models.ts', 'tags?: string[]', 'NoteItem/NoteInput 标签字段'],
  ['service/notes.service.ts', 'normalizeTags(value: unknown)', '标签清洗唯一口径（备份导入共用）'],
  ['service/notes.service.ts', 'MAX_NOTE_TAGS = 10', '单条标签个数上限'],
  ['pages/notes/edit/index.ts', 'onTagAdd()', '编辑页添加标签'],
  ['pages/notes/edit/index.ts', 'tags: d.tags.slice()', '保存时整体写入标签集合'],
  ['pages/notes/edit/index.wxml', 'bindtap="onTagAdd"', '添加标签按钮（调用点）'],
  ['pages/notes/edit/index.wxml', 'catchtap="onTagRemove"', '移除标签（调用点）'],
  ['pages/notes/list/index.ts', 'onTagFilter(', '列表按标签筛选'],
  ['pages/notes/list/index.wxml', 'bindtap="onTagFilter"', '标签筛选胶囊（调用点）'],
  ['components/business/note-item/index.wxml', 'note__tags', '卡片展示标签胶囊'],
  ['utils/backup.ts', 'BACKUP_VERSION = 2', 'v2：NoteItem 增加 tags（v1 按无标签兼容）'],
  ['utils/backup.ts', 'normalizeTags(o.tags)', '备份导入清洗 tags（调用点）'],
  // ===== 空态微动效（2026-09-21）=====
  ['components/empty-state/index.wxss', 'empty-float', '空态图标轻微浮动动画'],
  ['pages/notes/list/index.wxml', 'swipe-act--primary', '记事列表右滑「多选」块'],
  ['pages/notes/list/index.wxml', 'name="success"', '记事列表勾选图标'],
  ['pages/notes/list/index.ts', 'defineSwipeSelectPage<NoteItem', '记事列表挂共享滑删编排'],
  ['pages/notes/list/index.ts', 'visibleIds()', '记事列表可见 id 钩子'],
  ['pages/notes/list/index.ts', 'onHide() {', '记事列表 onHide 收回'],
  ['pages/notes/list/index.wxml', 'bind:click="onCellTap"', '记事列表点按清位置记录'],
  ['pages/notes/list/index.wxml', 'bind:touchend="onCellTouchEnd"', '记事列表离开校验'],
  ['pages/notes/list/index.wxml', "openSideMap[item.id] === 'right'", '记事列表反向滑动不翻面'],
  ['app.wxss', '.swipe-act {', '滑开操作块几何'],
  ['app.wxss', '.swipe-act--primary {', '滑开块主色变体'],
  ['app.wxss', '.swipe-act--muted {', '滑开块中性变体'],
  ['utils/rpx.ts', 'export function rpxToPx', 'rpx → px 换算'],
  ['utils/rpx.ts', 'export function swipeActionWidth', '滑开距离（px）'],
  ['utils/hint.ts', 'hintOnce', '一次性提示工具'],

  // —— 日期口径：相对说法只留今天/昨天，且始终带月日 ——
  ['utils/group.ts', 'const dateText', '分组标签带月日'],
  ['utils/date.ts', 'const clock = format(ts', '相对时间带时分'],
  ['components/business/note-item/index.json', 'van-icon', '记事条目注册勾选图标'],
  ['components/business/note-item/index.wxss', 'box-sizing: border-box', '记事勾选圈 border-box'],
  ['app.wxss', '.pick__box {', '多选勾选圈样式'],

  // —— 统计页：按天查看 ——
  ['pages/stats/index.wxml', '<picker', '统计页日期选择器'],
  ['pages/stats/index.wxml', '{{ rangeLabel }}', '统计页范围文案'],
  ['pages/stats/index.wxml', 'onBackToMonth', '统计页「看整月」'],
  ['pages/stats/index.ts', "mode: 'month' | 'day'", '统计页粒度字段'],
  ['pages/stats/index.ts', 'goDay(date: string) {', '统计页按天跳转实现'],
  ['pages/stats/index.ts', 'const scoped = ledgerStore.records.filter', '统计页按粒度过滤'],
  ['pages/stats/index.wxml', 'bindchange="onPickDate"', '统计页日期选择器事件'],
  ['pages/stats/index.ts', 'goDay(date: string): void;', '统计页按天跳转'],
  ['pages/stats/index.wxss', '.month__date {', '统计页日期按钮样式'],
  ['pages/stats/index.wxss', '.range__back {', '统计页「看整月」样式'],
  ['utils/date.ts', 'export function shiftDate', 'date.shiftDate'],
  ['utils/date.ts', 'export function dateLabel', 'date.dateLabel'],
  ['utils/date.ts', 'export function weekdayLabel', 'date.weekdayLabel'],

  // —— 更早的功能：防止被回退（这些曾经被覆盖过） ——
  ['app.json', '"pages/stats/index"', '统计页注册'],
  ['app.json', '"renderer": "webview"', '渲染引擎锁定'],
  ['typings/index.d.ts', 'mobx-miniprogram-bindings', '类型声明'],
  ['components/navigation-bar/navigation-bar.ts', 'innerPaddingRight', '导航栏胶囊留白'],
  ['components/navigation-bar/navigation-bar.ts', 'safeAreaTop', '导航栏状态栏高度'],
  ['components/business/ledger-card/index.ts', 'onLongPress', '卡片长按编辑'],
  ['components/business/ledger-card/index.ts', 'selectable', '卡片多选态'],
  ['components/business/note-item/index.ts', 'onLongPress', '记事长按编辑'],
  ['components/business/mix-bar/index.wxml', 'mix__bar', '占比条组件'],
  ['components/undo-bar/index.wxml', 'undo__btn', '撤销条组件'],
  ['utils/motion.ts', 'measureHeights', '批量测量'],
  ['utils/haptics.ts', 'vibrateShort', '震动反馈'],
  ['utils/chart.ts', 'buildMixSegments', '占比纯计算'],
  ['service/ledger.service.ts', 'removeMany', '批量删除'],
  ['store/ledger.store.ts', 'removeMany', '批量删除 store'],

  // —— 主题：只跟随系统（手动切换已按用户要求移除） ——
  ['service/settings.service.ts', 'normalizeBudget', '设置归一化'],
  ['utils/theme.ts', 'applyTabBarTheme', 'tabBar 主题同步'],
  ['utils/theme.ts', 'export function isDarkTheme', '主题跟随系统'],
  ['utils/theme.ts', 'wx.onThemeChange', '系统主题监听'],
  ['pages/settings/index.ts', 'onPickCurrency', '设置页货币选择'],
  ['pages/settings/index.wxml', '月度支出预算', '设置页额度项'],
  // 主题变量必须落在 page 根元素上：挂在 .page 上时 .fab / .pick-bar / .edit-bar 拿不到
  ['pages/index/index.wxml', '<page-meta page-style', '首页 page-meta 主题变量'],
  ['pages/ledger/list/index.wxml', '<page-meta page-style', '记账列表 page-meta 主题变量'],
  ['pages/notes/list/index.wxml', '<page-meta page-style', '记事列表 page-meta 主题变量'],
  ['pages/notes/edit/index.wxml', '<page-meta page-style', '记事编辑 page-meta 主题变量'],
  ['pages/ledger/edit/index.wxml', 'page-style="{{pageStyle}}"', '记账编辑 page-meta 主题变量'],
  ['pages/settings/index.wxml', '<page-meta page-style', '设置页 page-meta 主题变量'],
  ['pages/profile/index.wxml', '<page-meta page-style', '我的页 page-meta 主题变量'],
  ['pages/stats/index.wxml', '<page-meta page-style', '统计页 page-meta 主题变量'],
  ['pages/about/index.wxml', '<page-meta page-style', '关于页 page-meta 主题变量'],

  // —— 额度（预算）与进度条 ——
  ['utils/budget.ts', 'budgetAlertText', '额度提醒纯计算'],
  ['utils/budget.ts', 'shouldNoticeToday', '同一天只提醒一次'],
  ['service/storage.ts', 'BudgetNotice', '额度提醒去重键'],
  ['components/business/progress-bar/index.wxml', 'pg__fill', '进度条组件'],
  ['app.wxss', '.progress-card', '进度卡片'],
  ['app.wxss', '.summary__budget', '首页额度进度区'],
  ['utils/budget.ts', 'export function budgetViews', '首页额度进度（纯计算，已下沉）'],
  ['pages/index/index.ts', 'budgetViews(records, settingsStore.settings)', '首页额度进度调用点'],
  ['pages/index/index.ts', 'noticeBudget', '进首页时额度提醒'],
  ['utils/motion.ts', 'createBalanceRoller', '结余滚动器（首页/记账列表共用）'],
  ['pages/ledger/list/index.ts', 'this.roller.roll(target)', '记账列表结余滚动调用点'],
  ['pages/index/index.ts', 'this.roller.roll(target)', '首页结余滚动调用点'],

  // —— 额度提醒：弹窗 + 每天一次（不弹 toast） ——
  ['utils/budget-alert.ts', 'export function currentBudgetAlert', '额度提醒文案计算'],
  ['utils/budget-alert.ts', 'export function showBudgetAlertOnce', '额度提醒去重与弹窗'],
  ['utils/budget-alert.ts', 'wx.showModal', '额度提醒用弹窗'],
  ['pages/index/index.ts', 'showBudgetAlertOnce(', '首页额度弹窗（调用点）'],
  ['pages/ledger/edit/index.ts', 'showBudgetAlertOnce(alert', '记账保存后额度弹窗（调用点）'],

  // —— 首页待办：完成后动画收走；记事页待办进度 ——
  ['pages/index/index.ts', 'recentTodos: pending.slice(0, RECENT_LIMIT)', '首页只列未完成待办'],
  ['pages/index/index.ts', 'buildTodoView', '首页待办完成度视图'],
  ['pages/index/index.ts', "measureHeights(this, '#todo-' + id", '首页待办收起前量高'],
  ['pages/index/index.ts', 'removingId', '首页待办收起状态'],
  ['pages/index/index.wxml', 'id="todo-{{ item.id }}"', '首页待办行可测量'],
  ['pages/index/index.wxml', 'row-collapse--out', '首页待办收起类'],
  ['pages/index/index.wxml', '{{ todoEmptyText }}', '首页待办空态文案'],
  ['pages/notes/list/index.ts', 'todoBar: todoProgressView(', '记事页待办进度真正计算'],
  ['pages/notes/list/index.wxml', 'progress-row', '记事页进度条'],

  // —— 入场过渡 ——
  ['pages/settings/index.wxml', 'animation-delay: 40ms', '设置页入场过渡（延迟压在 120ms 内）'],
  ['pages/profile/index.wxml', 'hero enter', '我的页入场过渡'],

  // —— 首页入口：直接打开编辑页 ——
  // （曾改成"切列表页 + 一次性意图"以求返回落回列表页，但那会先闪一下列表页，用户不接受，已回退；
  //   若将来要恢复，配方见技能 wechat-mini-program-interaction-polish 第 10 节）
  ['pages/index/index.ts', "wx.navigateTo({ url: '/pages/ledger/edit/index' });", '首页去记账直接打开编辑页'],
  ['pages/index/index.ts', "wx.navigateTo({ url: '/pages/notes/edit/index' });", '首页去记事直接打开新增页'],
  ['pages/index/index.ts', "wx.navigateTo({ url: '/pages/notes/edit/index?kind=todo' });", '首页加待办落到待办'],
  ['pages/notes/list/index.ts', 'editQuery', '列表新增页默认类型跟随 tab'],
  // 主题相关：tabBar 要尽早重钉；设置页数据要在首帧就位
  ['pages/index/index.ts', 'applyPageTheme(this);\n    ledgerStore.load();', '首页 onShow 先套主题（tabBar 尽早重钉）'],
  // 列表页方法体已套进 defineSwipeSelectPage 的包装（缩进多一层），标记按新缩进登记
  ['pages/ledger/list/index.ts', 'applyPageTheme(this);\n        ledgerStore.load();', '记账列表 onShow 先套主题'],
  ['pages/notes/list/index.ts', 'applyPageTheme(this);\n        notesStore.load();', '记事列表 onShow 先套主题'],
  ['pages/profile/index.ts', 'applyPageTheme(this);\n    ledgerStore.load();', '我的页 onShow 先套主题'],
  ['pages/settings/index.ts', 'settingsStore.load();\n    this.refresh();', '设置页数据在 onLoad 就位'],
  ['pages/notes/edit/index.ts', 'query?.kind === NoteKind.Todo', '记事新增页默认类型'],
  ['components/business/note-item/index.ts', 'item.kind === NoteKind.Todo', '点击待办即完成'],
  ['pages/index/index.wxml', '最近待办', '首页只展示待办'],
  // ⚠️ 只检查"方法定义存在"是不够的：曾经方法写好了、onShow 里的**调用**没落盘，
  // 表现就是"首页点去记账只停在列表页"。所以调用点也要单独列为标记。
  // 上面那条「首页去记账直接打开编辑页」用的就是**调用点原文**做锚，而不是方法名 ——
  // 这是上次"方法写好了、调用没落盘"踩出来的规矩，别再只锚方法名。
  // tabBar API 在非 tab 页调用会失败：必须在"页面显示"时重钉一次，否则从设置页返回后 tab 栏还是旧的
  ['utils/theme.ts', 'applyTabBarTheme(isDark);\n  return isDark;', 'applyPageTheme 顺手重钉 tabBar'],
  // 备份/恢复闭环（2026-09-19）：实现与调用点成对登记 —— 页面只做编排，纯逻辑都在 utils/backup.ts
  ['utils/backup.ts', 'export function buildBackup()', '备份生成（原始分值+原 id）'],
  ['utils/backup.ts', 'export function parseBackup(text: string)', '备份解析与逐条清洗'],
  ['utils/backup.ts', "applyBackup(payload: BackupPayload, mode: 'merge' | 'overwrite')", '备份应用（合并/覆盖双模式）'],
  ['utils/backup.ts', "obj.app !== BACKUP_APP", '导入校验应用标识（防外部 JSON 灌入）'],
  ['pages/profile/index.ts', 'onBackup() {', '我的页备份到文件（方法）'],
  ['pages/profile/index.wxml', 'bind:click="onBackup"', '我的页备份到文件（调用点）'],
  ['pages/profile/index.ts', 'onRestore() {', '我的页从备份恢复（方法）'],
  ['pages/profile/index.wxml', 'bind:click="onRestore"', '我的页从备份恢复（调用点）'],
  ['pages/profile/index.ts', 'wx.shareFileMessage({', '备份文件经微信转发发出'],
  ['pages/profile/index.ts', "applyParsed(parsed: ParsedBackup, mode: 'merge' | 'overwrite') {", '覆盖/合并导入前有确认弹窗'],
  // 统计页每日趋势 + 上月对比（2026-09-20）：纯计算在 utils，页面只做绘制与编排
  ['utils/stats.ts', 'export function buildDailySeries(', '每日趋势聚合（补齐整月）'],
  ['utils/stats.ts', 'export function comparePeriods(', '上月对比（上期为 0 时比例 null）'],
  ['utils/chart.ts', 'export function linePoints(', '折线坐标映射'],
  ['utils/chart.ts', 'export function nearestLineIndex(', '点折线找最近一天'],
  ['pages/stats/index.ts', 'initTrendCanvas(cb?: () => void)', '趋势画布初始化'],
  ['pages/stats/index.ts', 'onTrendTap(e: { detail: { x: number; y: number } })', '点走势选中该天（方法）'],
  ['pages/stats/index.ts', 'this.trendRect?.left ?? 0', 'tap/touch 坐标换算画布内坐标（防落点偏移）'],
  ['pages/stats/index.wxml', 'bindtap="onTrendTap"', '点走势选中该天（调用点）'],
  ['pages/stats/index.wxml', 'trend__compare--{{ compareKind }}', '对比语义色挂载'],
  ['pages/stats/index.ts', 'cmp.ratio !== null', '上期无数据时不显示百分比'],
  // 趋势卡交互补盲（2026-09-20）：两次点击模型 + 刻度行 + 选中气泡
  ['utils/stats.ts', 'export function monthTickLabels(', '趋势 X 轴刻度标签纯函数'],
  ['pages/stats/index.ts', 'jumpFromTrend(i: number)', '趋势选中后确认跳转（方法）'],
  ['pages/stats/index.ts', 'onTrendBubbleTap()', '点气泡确认跳转（方法）'],
  ['pages/stats/index.ts', 'clearTrendSel(cb?: () => void)', '选中态自动取消（实现）'],
  ['pages/stats/index.wxml', 'bindtap="onTrendBubbleTap"', '点气泡确认跳转（调用点）'],
  ['pages/stats/index.wxml', 'wx:if="{{ trendSel.enabled }}"', '选中气泡（调用点）'],
  ['pages/stats/index.wxml', 'class="trend__ticks"', 'X 轴刻度行（调用点）'],
  // 拖动虚线选择日期（2026-09-20）：拖动只选中，点气泡跳转
  ['pages/stats/index.ts', 'selectTrendIndex(i: number)', '趋势选中逻辑（抽取共用）'],
  ['pages/stats/index.ts', 'onTrendTouchMove(e: { touches: Array<{ x: number }> })', '拖动虚线跟手（方法）'],
  ['pages/stats/index.wxml', 'catchtouchmove="onTrendTouchMove"', '拖动跟手且不滚页（调用点）'],
  ['pages/stats/index.wxml', 'bindtouchstart="onTrendTouchStart"', '拖动起点（调用点）'],
  // 去记一笔带上所选日期（2026-09-21）：回看历史月份/某天时新增，编辑页默认日期应落在所看的那天
  ['pages/stats/index.ts', "params.push(`date=${this.data.month}-01`);", '历史月「去记一笔」带当月 1 号'],
  ['pages/stats/index.ts', "params.push(`date=${this.data.date}`);", '单日模式「去记一笔」带所选日期'],
  ['pages/ledger/edit/index.ts', "query?.date && /^\\d{4}-\\d{2}-\\d{2}$/.test(query.date)", '编辑页新增支持 ?date= 预设日期'],
  // 饼图配色不含绿/青绿（用户口径：支出场景绿色易被当成收入）——测试与注释双重钉住
  ['utils/chart.ts', '刻意不含绿 / 青绿色系', '配色注释：支出场景不用绿'],
  ['tests/utils/chart.test.ts', '配色不含绿 / 青绿色系', '配色禁止回归测试'],
  // 待办截止时间 + 到期横幅（2026-09-20）：实现 + 调用点成对登记
  ['utils/todo-remind.ts', 'export function dueBannerView', '到期横幅聚合纯函数'],
  ['pages/index/index.ts', 'dueBannerView(pending, Date.now())', '首页横幅数据来自纯函数'],
  ['pages/index/index.wxml', 'wx:if="{{ todoBanner.enabled }}"', '首页横幅（调用点）'],
  ['pages/index/index.wxml', 'bindtap="goNotesList"', '首页横幅点击去记事页'],
  ['pages/notes/edit/index.ts', 'composeDue(d.dueDate, d.dueHM)', '编辑页提交时显式落 dueTime'],
  ['pages/notes/edit/index.ts', 'syncDueLabel()', '编辑页截止文案同步（调用点）'],
  ['pages/notes/edit/index.wxml', "wx:if=\"{{ kind === 'todo' }}\"", '截止时间行仅待办显示'],
  ['service/notes.service.ts', 'function normalizeDueTime', '截止时间归一化（实现）'],
  ['components/business/note-item/index.ts', 'dueTagView(n, Date.now())', '待办行截止标签（调用点）'],
  ['components/business/note-item/index.wxml', 'wx:if="{{ dueEnabled }}"', '待办行截止标签（调用点）'],
  ['utils/backup.ts', 'note.dueTime = dueTime', '备份导入保留截止时间'],

  // —— 滑删收口：实例树扫描 + 数据驱动强制收回（2026-09-20 再修）——
  // 只靠 `selectComponent('#swipe-<id>')` 会静默失败（id 选择器命中不了子组件），
  // 于是"记录清了、行还开着"，那一行从此滑不动却看不出异常。实例树按组件内部 offset 找才可靠。
  ['behaviors/swipe-select.ts', 'function collectOpenCells(): SwipeCellLike[]', '按实例 offset 扫描已滑开的行'],
  ['behaviors/swipe-select.ts', 'if (typeof n.offset === \'number\' && n.offset !== 0) found.push(n as SwipeCellLike);', '扫描以内部 offset 为准'],
  ['behaviors/swipe-select.ts', 'collectOpenCells().forEach((inst) => {', 'closeAllSwipes 走实例扫描'],
  ['behaviors/swipe-select.ts', 'export const SWIPE_ROW_RESET_MS = 120;', '单行补清的还原等待'],
  ['behaviors/swipe-select.ts', 'forceCloseRow(id: string)', '单行强制收回（touchend 补清，不依赖实例）'],
  ['behaviors/swipe-select.ts', 'this.forceCloseRow(id);', 'touchend 补清改为强制收回（调用点）'],
  // 操作块的图形一律用 van-icon（删除 / 退出 / 多选三块各一个字形）。
  // 曾误判"字形在 glass-easel 下取不到、会渲染成空白方块"而改成 CSS 手绘，
  // 已核实 icon/index.wxss 里 257 个字形都在（delete-o / cross / records 均存在），故改回。
  ['pages/ledger/list/index.wxml', '<van-icon name="delete-o" size="36rpx" color="#ffffff" />', '记账列表删除块图标'],
  ['pages/ledger/list/index.wxml', '<van-icon name="cross" size="36rpx" color="#ffffff" />', '记账列表退出块图标'],
  ['pages/ledger/list/index.wxml', '<van-icon name="records" size="36rpx" color="#ffffff" />', '记账列表多选块图标'],
  ['pages/ledger/list/index.json', '"van-icon": "@vant/weapp/icon/index"', '记账列表注册 van-icon'],
  ['pages/notes/list/index.json', '"van-icon": "@vant/weapp/icon/index"', '记事列表注册 van-icon'],
  // 多选态下 note-item 的勾选圈要让位：.pick--in 插入 56rpx + 16rpx 右边距后，
  // 原来的 padding-left 32rpx + 圈 44rpx + 圈右距 24rpx 会把勾挤出卡片（被裁）
  ['pages/notes/list/index.wxml', "class=\"row-inner {{ selecting ? 'row-inner--picking' : '' }}\"", '记事行容器多选态类（勾选圈让位）'],
  ['pages/notes/list/index.wxss', '.row-inner--picking .note__check {', '多选态勾选圈让位规则'],
  ['utils/theme.ts', 'swipeExitBg', '退出块底色进主题（深色下与浅色不同）'],
  // 分段控件的选中色与按下反馈放 app.wxss：页面级选择器命中不了 van-tabs 组件内部节点
  ['app.wxss', '.segment__item.is-on-expense', '分段控件选中色（页级样式命中不了组件内部）'],
  ['app.wxss', '.segment__item--hover', '分段控件按下反馈（同上）'],
];

/**
 * 禁止回归的写法：[文件, 不该出现的字符串, 说明]
 * 都是踩过的坑，留着它们比"忘了为什么"更贵。
 */
const FORBIDDEN = [
  // van-swipe-cell 的 left/right-width 单位是 px：写死 144 会让滑开距离是块宽的 2 倍（操作块外侧露空白）
  ['pages/ledger/list/index.wxml', 'right-width="{{ 144 }}"', '记账列表滑开距离必须用 rpxToPx 换算值'],
  ['pages/notes/list/index.wxml', 'right-width="{{ 144 }}"', '记事列表滑开距离必须用 rpxToPx 换算值'],
  // 多选态要靠"左滑"退出手势，disabled 会把整个手势一起禁掉
  ['pages/ledger/list/index.wxml', 'disabled="{{ selecting }}"', '多选态不能禁用手势'],
  ['pages/notes/list/index.wxml', 'disabled="{{ selecting }}"', '多选态不能禁用手势'],
  // 旧的类名与旧口径
  ['app.wxss', '.swipe-del {', '操作块已改名 .swipe-act'],
  ['utils/group.ts', "'前天'", 'dayLabel 不再有前天文案'],
  ['utils/date.ts', '前天 ${', 'fromNow 不再有前天文案'],
  // 统计页的刷新必须按 mode/date 过滤，不能退回"只按月"的旧实现（否则选了日期界面不动）
  ['pages/stats/index.ts', 'const monthRecords = ledgerStore.records.filter', '统计页 refresh 必须按粒度过滤'],
  // 退出多选不能靠"延迟翻转状态"（那样工具栏会明显发钝），改为即时退出 + 中性色块接力
  // （编排已抽到 behaviors/swipe-select.ts，禁止回归也跟着搬家）
  ['behaviors/swipe-select.ts', 'this.exitTimer = null;\n      this.clearPick();', '退出多选应即时生效（共享）'],
  // 首页的记事区只放待办：普通笔记混在首页会把"要去做"和"写下来"混成一锅
  ['pages/index/index.wxml', 'recentNotes', '首页只展示待办'],
  // 标题垂直定位：绝对定位参照是 inner 的内边距盒（top:0 = 整条栏最顶、含状态栏区），
  // bottom 再减一个 env(safe-area-inset-top) 会把定位带整体抬高 —— 标题浮到状态栏一带、
  // 与右侧搜索图标不在一条水平线上（2026-09-21 真机翻车）。正确写法是 bottom: 0 + height: var(--height)
  ['components/navigation-bar/navigation-bar.wxss', 'bottom: env(safe-area-inset-top)', '导航栏标题必须贴底（bottom: 0），bottom 不吃安全区高度'],
  // "我的"页的「设置」入口不再显示右侧摘要（用户要求：不要显示文字）
  ['pages/profile/index.wxml', 'settingsSummary', '我的页设置入口不显示摘要'],
  // 主题手动切换已按用户要求移除：模型 / 默认值 / 页面都不许再出现
  ['types/models.ts', 'themeMode', '设置里不再有主题模式'],
  ['utils/theme.ts', 'setThemeMode', '主题不再支持手动切换'],
  ['pages/settings/index.wxml', 'onPickTheme', '设置页不再有主题切换行'],
  // 额度提醒必须是弹窗：toast 一闪而过，用户会错过
  ['pages/index/index.ts', "title: '额度提醒", '首页额度提醒改用弹窗'],
  ['pages/ledger/edit/index.ts', "title: '额度提醒", '记账页额度提醒改用弹窗'],
  // 首页待办行不能回到"单层节点"：入场的 animation（fill-mode: both）会永久压住收起的 transform
  ['pages/index/index.wxml', 'class="card-row enter"\n      style="animation-delay: {{ 260', '首页待办行必须分内外两层'],
  // 首页待办过滤必须只留未完成项，否则做完的事会一直挂在"待办"里
  ['pages/index/index.ts', 'const todos = notesStore.items.filter((n) => n.kind === NoteKind.Todo);\n    const doneCount', '首页待办需要区分未完成'],
  // 整页收口不许再出现"归零一帧再还原"的写法：两次 setData 挤在同一批次时，
  // Vant 的 swipeMove(0) 会被宽度 observer 的 swipeMove(newWidth) 覆盖，行停在半开位
  ['behaviors/swipe-select.ts', 'SWIPE_RESET_FALLBACK_MS', '整页收口不再走"归零→还原"（改终止型）'],
  ['behaviors/swipe-select.ts', 'swipeResetTimer', 'swipeResetTimer 已并入单行的 rowResetTimer'],
  // 切页收口（"归零→还原"的 resetSwipes/restoreSwipeWidth）已于 2026-09-21 整个移除，
  // 滑开状态跨页保留原样；谁再把它加回来就会复现"快速切页后那一行滑不动"
  ['behaviors/swipe-select.ts', 'resetSwipes', '切页收口已移除：滑开状态跨页保留，收口走滚动'],
  ['behaviors/swipe-select.ts', 'restoreSwipeWidth', '同上：切页不再有宽度归零/还原环节'],
  // 两个列表页不许直接调 closeAllSwipes 收口：统一走 behaviors 的 closeSwipesOnScroll（含守卫）
  ['pages/ledger/list/index.ts', 'this.closeAllSwipes();', '记账列表滚动收口统一走 closeSwipesOnScroll'],
  // .row-collapse 平时不能 overflow: hidden：会裁掉卡片 box-shadow，
  // 浅色主题下记录卡失去立体感（2026-09-21 用户反馈）；裁剪只在 --out 收起动画时需要
  ['app.wxss', '.row-collapse {\n  overflow: hidden;', '行收起容器平时不裁剪阴影'],
  // ===== 搜索：下拉跟手方案已废弃（2026-09-21 第三轮定稿为导航栏图标 + 折叠输入行）=====
  // 三轮 bug 史：阈值弹出没手感 → 跟手版几何错误（自定义导航栏下"视口外"不成立）→ 修裁切。
  // 谁把下面任何一种写法加回来，都会复现其中至少一个问题：
  ['pages/ledger/list/index.wxml', 'search-slot', '旧结构（.search-slot 绝对定位槽）已拆除，现用 .search-fold 折叠行'],
  ['pages/notes/list/index.wxml', 'search-slot', '旧结构（.search-slot 绝对定位槽）已拆除，现用 .search-fold 折叠行'],
  // 「取消」按钮与 row 包裹层已移除（2026-09-21 第四轮）：搜索行铺满整行与下方卡片对齐，
  // 收起走导航栏图标再点 / 下滑自动收起（collapseSearch 保留关键词）
  ['pages/ledger/list/index.wxml', 'search-fold__cancel', '搜索行不再带「取消」按钮（铺满对齐）'],
  ['pages/notes/list/index.wxml', 'search-fold__cancel', '搜索行不再带「取消」按钮（铺满对齐）'],
  ['pages/ledger/list/index.wxml', 'search-fold__row', '搜索行不再包一层 row（van-search 直接铺满）'],
  ['pages/notes/list/index.wxml', 'search-fold__row', '搜索行不再包一层 row（van-search 直接铺满）'],
  // 统计明细不许退回 wx:if 卸载式显隐：切换分类时整块消失重现、高度跳变（用户报的"割裂感"）
  ['pages/stats/index.wxml', 'class="detail" wx:if', '统计明细不再用 wx:if 卸载（改折叠容器高度过渡）'],
  ['pages/ledger/list/index.wxml', 'searchPullStyle', '跟手位移容器已拆除（纯点按不需要位移）'],
  ['pages/notes/list/index.wxml', 'searchPullStyle', '跟手位移容器已拆除（纯点按不需要位移）'],
  ['pages/ledger/list/index.wxml', 'capture-bind:touchmove="onSearchTouchMove"', '贴顶下拉触摸手势已拆除（开合靠点按）'],
  ['pages/notes/list/index.wxml', 'capture-bind:touchmove="onSearchTouchMove"', '贴顶下拉触摸手势已拆除（开合靠点按）'],
  ['pages/ledger/list/index.wxml', 'wx:if="{{ searchShown }}"', '旧显隐字段已不存在（现为 searchOpen 折叠行）'],
  ['pages/notes/list/index.wxml', 'wx:if="{{ searchShown }}"', '旧显隐字段已不存在（现为 searchOpen 折叠行）'],
  ['app.wxss', '.pull {', '下拉位移容器样式已拆除'],
  ['pages/ledger/list/index.wxss', '.pull {', '列表页 .pull 包裹层已拆除（.page 恢复自带顶部留白）'],
  ['pages/notes/list/index.wxss', '.pull {', '列表页 .pull 包裹层已拆除（.page 恢复自带顶部留白）'],
  ['pages/ledger/list/index.wxss', 'overflow: hidden;', '.page 不再需要裁切收起态搜索栏（还会裁卡片阴影）'],
  ['pages/notes/list/index.wxss', 'overflow: hidden;', '.page 不再需要裁切收起态搜索栏（还会裁卡片阴影）'],
];

/** 排除目录（与 project.config.json 的 packOptions.ignore 思路一致） */
const SKIP_DIRS = new Set([
  'node_modules',
  'miniprogram_npm',
  '.git',
  '.workbuddy',
  'docs',
  '.reasonix',
  'attachments',
]);

const problems = [];
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 1) 标记复核
MARKERS.forEach(([file, needle, label]) => {
  if (!exists(file)) {
    problems.push(`文件缺失: ${file}（${label}）`);
    return;
  }
  if (!read(file).includes(needle)) problems.push(`标记丢失: ${file} :: ${label}（找不到 ${needle}）`);
});

// 1b) 禁止回归的写法
FORBIDDEN.forEach(([file, needle, label]) => {
  if (!exists(file)) return; // 文件缺失已由上面的标记检查报出
  if (read(file).includes(needle)) problems.push(`禁止回归: ${file} :: ${label}（仍含 ${needle}）`);
});

// 2) 页面四件套
const app = JSON.parse(read('app.json'));
app.pages.forEach((pg) => {
  ['ts', 'wxml', 'wxss', 'json'].forEach((ext) => {
    if (!exists(`${pg}.${ext}`)) problems.push(`页面缺件: ${pg}.${ext}`);
  });
});

// 3) 组件四件套（components 下的组件目录）
const compDirs = [];
(function walk(rel) {
  const abs = path.join(ROOT, rel);
  fs.readdirSync(abs, { withFileTypes: true }).forEach((e) => {
    if (!e.isDirectory()) return;
    const child = `${rel}/${e.name}`;
    // 两种命名约定都要认：index.* 与 <目录名>.*
    // （navigation-bar 用的是后者——它的 .ts 曾被删掉却没被审计发现，就是因为这里只认 index.json）
    if (exists(`${child}/index.json`) || exists(`${child}/${e.name}.json`)) compDirs.push(child);
    else walk(child);
  });
})('components');
compDirs.forEach((dir) => {
  const base = exists(`${dir}/index.json`) ? `${dir}/index` : `${dir}/${path.basename(dir)}`;
  ['ts', 'wxml', 'wxss', 'json'].forEach((ext) => {
    if (!exists(`${base}.${ext}`)) problems.push(`组件缺件: ${base}.${ext}`);
  });
});

// 4) 页面注册的组件是否真实存在
app.pages.forEach((pg) => {
  const j = JSON.parse(read(`${pg}.json`));
  Object.entries(j.usingComponents || {}).forEach(([name, rel]) => {
    if (rel.startsWith('@')) return;
    const target = rel.replace(/^\//, '');
    if (!exists(`${target}.json`) && !exists(`${target}.ts`) && !exists(`${target}.js`)) {
      problems.push(`注册的组件不存在: ${pg}.json -> ${name} (${rel})`);
    }
  });
});

// 5) WXML 标签配平（模板语法错会整页白屏，值得单独查）
/* 不需要闭合的内置标签；canvas 不在其中——本项目用的是 <canvas></canvas> 显式闭合 */
const VOID_TAGS = new Set([
  'image',
  'input',
  'import',
  'include',
  'wxs',
  'progress',
  'checkbox',
  'radio',
  'slider',
  'switch',
  'audio',
  'video',
  'camera',
  'live-player',
  'live-pusher',
  'open-data',
  'web-view',
  'ad',
  'official-account',
]);
const wxmlFiles = [];
(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
      return;
    }
    if (e.name.endsWith('.wxml')) wxmlFiles.push(path.join(dir, e.name));
  });
})(ROOT);

wxmlFiles.forEach((abs) => {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  const raw = fs.readFileSync(abs, 'utf8');
  // 注释必须成对闭合：漏一个 `-->` 会让"被注释掉的标签"参与配平，
  // 报出来的却是"标签不匹配"，把排查方向带偏（本工具自己就被这么绕过一次）。
  const openComments = (raw.match(/<!--/g) || []).length;
  const closeComments = (raw.match(/-->/g) || []).length;
  if (openComments !== closeComments) {
    problems.push(`WXML 注释未闭合: ${rel}（<!-- ×${openComments}，--> ×${closeComments}）`);
  }
  // 再去注释：注释里出现的标签名不该参与配平
  const src = raw.replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const stack = [];
  let m;
  while ((m = re.exec(src))) {
    const closing = m[1];
    const tag = m[2];
    const selfClose = m[4];
    if (closing) {
      const top = stack.pop();
      if (top !== tag) {
        problems.push(`WXML 标签不匹配: ${rel}（期望 </${top}>，实际 </${tag}>）`);
        return;
      }
    } else if (!selfClose && !VOID_TAGS.has(tag)) {
      stack.push(tag);
    }
  }
  if (stack.length) problems.push(`WXML 未闭合: ${rel} :: ${stack.join(' > ')}`);
});

// 6) 文件数概览（顺带发现"整个文件消失"）
let fileCount = 0;
(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
      return;
    }
    if (/\.(ts|wxml|wxss|json)$/.test(e.name) && !e.name.endsWith('.d.ts')) fileCount++;
  });
})(ROOT);

if (!QUIET) {
  console.log(`标记检查: ${MARKERS.length} 项 | 禁止回归: ${FORBIDDEN.length} 项`);
  console.log(`页面: ${app.pages.length} 个 | 组件目录: ${compDirs.length} 个 | 源码文件: ${fileCount} 个`);
  console.log(`渲染引擎: ${app.renderer || '(未声明)'}`);
}

if (problems.length) {
  console.log(`\n发现 ${problems.length} 个问题：`);
  problems.forEach((p) => console.log('  ✗ ' + p));
  process.exit(1);
}
console.log('\n✓ 全部通过：标记齐全、页面/组件/注册无缺件');
