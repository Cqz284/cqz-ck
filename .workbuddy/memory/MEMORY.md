# 项目长期记忆（ledger-notes 小程序）

> 只记跨会话仍然成立的事实与约定，日常改动记录在同目录 `YYYY-MM-DD.md`。

## 环境与工具链
- 微信小程序（TS 编译插件 + glass-easel + Vant Weapp）；2026-09-21 已初始化 git 仓库
- 本机 bash 残缺：`cat/head/tail/sed/wc/rm` 不可用。写文件用编辑工具，看内容用 Read；
  删文件用 `node -e "fs.unlinkSync(...)"`；Bash 内联 node 传含反引号中文会被 shell 解释
- 类型检查：`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
- 测试：`node node_modules/jest/bin/jest.js --ci`（`jest.setup.js` 有手写 `wx` mock，新用 `wx.*` 要补）
- 每次改动落地后必须跑 `node .workbuddy/tools/verify-project.js` 复核（关键标记/禁止回归/
  页面组件四件套/json 组件注册/WXML 配平），不能只看 tsc
- ⚠️ **一条消息里同一文件只改一次**（多个 Edit 基于同一快照互相覆盖，回执成功但内容丢失）。
  多处要改就分多条消息，或一次 Write 写整份。标记要成对登记：「方法存在」+「调用点存在」。

## 项目约定
- 卡片类组件不带外边距，页面留白由行容器（`.card-row`/`.row-collapse`）提供
- ⚠️ `van-swipe-cell` 的 left/right-width 单位是 **px**（wxss 是 rpx），必须传 `utils/rpx.ts` 的 `swipeActionWidth()`
- **一次 setData 原则**：列表增删+状态翻转必须合并成一次 setData（`refresh(extra)`）；即时反馈优先，
  状态立刻翻转，视觉冲突用"接力"（`exitMap`）解决，别延迟翻转
- Vant 滑删只通知"滑开"，收口记录自己维护，`bind:touchend`（读实例 offset）与 `bind:click` 两处补清；
  Vant 过渡 0.6s 写死，换内容的翻转必须等 `SWIPE_CLOSE_MS`
- 勾选圈：`box-sizing: border-box` + `van-icon name="success"`，别用字体 ✓ 字形；操作块图标用 van-icon
  （glass-easel 下渲染空白的旧结论是错的），**别改成 CSS 手绘**（用户明确要求改回）
- 时间口径：相对说法只有「今天/昨天」且始终带月日，无「前天」；更早 `M月D日`（跨年带年份）；
  带时分写 `M月D日 HH:mm`，判断按自然日
- 金额以「分」存储计算，展示用 `formatMoney`；不使用行内 type 修饰符（DevTools 内置 TS 旧），
  类型导入写独立 `import type`
- 纯计算抽 `utils/*.ts` 纯函数配单测；动效走 `utils/motion.ts`、触觉走 `utils/haptics.ts`
- 设置归一化**逐字段拷贝**，不要展开 `...s`（未知字段会被写回存储漂下去），见 `settings.service.ts`
- 页级 wxss 命不中组件内部节点（apply-shared 只到组件根），van-tabs 页签样式必须写 `app.wxss` 并删页面同名规则
- `.workbuddy/tools/verify-project.js` 认 `index.*` 与 `<目录名>.*` 两种组件命名

## 主题
- **只跟随系统**，无手动切换（2026-09-19 已移除三态切换，手动模式与 tabBar 渲染差一帧无法消除）
- **饼图/占比条配色（PIE_COLORS）不含绿/青绿**（用户口径：支出场景绿色易被当成收入）；`--primary: #34be8c` 是应用主色，不在此口径内，别动
- 主题变量挂 page 根：`<page-meta page-style>` 必须是页面第一个节点（fixed 平级元素要拿变量）；
  `app.wxss` **不许**再写 `@media (prefers-color-scheme: dark)` 兜底块
- tab 页 `onShow` 第一行 `applyPageTheme(this)`（内含 applyTabBarTheme 重钉，非 tab 页调用 setTabBar* 会静默失败）

## 额度与提醒
- 月预算与每日额度独立互不换算，可只设其一（0=未设）；≥80% 进度条转暖色，≥100% 才提醒
- 额度提醒=**弹窗**（`wx.showModal` 仅「知道了」），每天最多一次（`StorageKeys.BudgetNotice`）；
  编排在 `utils/budget-alert.ts`，首页与记账页共用；记账页弹窗后等关闭再 navigateBack
- 待办到期提醒=**首页横幅**（常驻不打扰），与额度弹窗口径不同是用户刻意选择，别统一

## 待办
- 首页「最近待办」只列未完成；完成走"勾选→量高钉住→下一帧收起→刷新"；进度条按全部待办统计
- NoteItem.dueTime（毫秒，0=清除）；逾期=已过点且截止日在更早自然日，今天内过点算「今天到期」

## 记事标签（2026-09-21）
- NoteItem.tags: string[] 可选；**清洗后无有效标签就不落字段**（与 dueTime 清除语义一致）；
  清洗唯一口径 `notes.service.normalizeTags`（去空格/截断 20/去重/限 10 个），备份导入共用
- 搜索（service list + store visibleItems）同时命中内容与标签；列表标签筛选是**页面本地状态**
  （activeTag + tagOptions，不进 store）；tagOptions 从全部记事收集，列表为空也保留
- 备份 BACKUP_VERSION=2：v1 备份无 tags，导入按无标签兼容

## 记账列表月份口径（2026-09-21）
- data.month 是"正在查看的月份"（可切历史月）；汇总用 `summarize(records, month)` 现算，
  **不许退回 store 的 monthSummary**（那是真实当月）；搜索只过滤列表、不动汇总数字
- 额度提醒（currentBudgetAlert/resyncBudgetNotice）只与真实当月有关，看历史月时不参与（isCurMonth 闸）
- 月份切换：‹ › 逐月 + picker fields="month" 直达，end 封顶当前月；交互与统计页同款

## 跨页落点意图
- 首页「待办清单」→ 记事页待办 tab：`notesStore.setPendingTab(1)` + switchTab（不能带参），
  记事页 onShow 读一次立即清（-1）。仅用于 tab 落点；去编辑页仍直连（勿引入 nav-intent，用户定稿）

## 交互约定（用户确认）
- 编辑记录=长按（首次误点 `hintOnce` 教一次）；多选=右滑进入（顺带选中）、多选态左滑退出
- 删除唯一路径：左滑/多选批量，"整行收起→落库→底部 5 秒撤销"；编辑页无删除入口，吸底条只放全宽「保存」
- 首页：记账区+记事区（记事区只显示待办，点整条即完成）；汇总卡放额度进度条（无支出构成占比条）
- 记事页新增默认类型跟随当前 tab；「我的」页设置入口不显示右侧摘要
- **首页入口返回落点（定稿）**：`去记账/去记事/加待办` 直接 navigateTo 编辑页，别再引入 nav-intent
  （微信不允许 navigateTo tab 页，折中方案用户不接受）

## 滑删编排（behaviors/swipe-select.ts；收口策略 2026-09-21 定稿，详见技能第 7.1 节）
- 两列表页滑删/多选/删除/撤销编排全在 behaviors，页面只留 config 与 visibleIds()/refresh()
- 页面挂载必须走 `defineSwipeSelectPage(config, page)`，别 Object.assign 直传 Page()（丢 this 类型）
- 收行主力=实例树扫描 `collectOpenCells()`（selectComponent 会静默返回 null）
- ⚠️ **切页不收口（用户定稿）**：滑开的行跨页保留原样，"就不动它"。
  曾经的"切页时两槽宽度归零→下一帧还原"会把两次 setData 挤进同一批次，
  Vant 的 `swipeMove(0)` 被 observer 的 `swipeMove(newWidth)` 覆盖 → 行卡半开位
  （"快速切页后滑不动"的根源），`resetSwipes`/`restoreSwipeWidth` 已整个删除（verify 有禁止回归）
- ⚠️ **收口时机=页面滚动**：页面 `onPageScroll(e: { scrollTop })` → behaviors 的 `closeSwipesOnScroll()`
  （多选态直接返回；什么都没开时空操作，守卫便宜；宽度归零残留顺手还原）。
  滚动收口走 `closeAllSwipes()`（实例扫描 + close()，0.6s 过渡，用户正看着页面，不能用宽度归零闪没）
- 单行 `forceCloseRow`（touchend 补清）必须还原（`rowResetTimer` 120ms），别推广到其它场景
- `openSideMap` 是"哪一侧归零"的唯一依据，残留会让左滑永久失效；任何提前 return 前先清记录
- 多选态行首 `.pick--in` 占 72rpx，卡片内边距要收窄（`.row-inner--picking`，不用 `:has()`），
  别缩勾选圈本身；记账页 ledger-card 无自带勾选圈，别顺手改

## 顶部搜索「导航栏图标 + 折叠输入行」（2026-09-21 第四轮定稿，详见技能第 7.4 节）
- **下拉跟手方案已整体废弃**：三轮迭代（阈值弹出 → 跟手吸附 → 几何修复）后 bug 不断，用户拍板
  「搜索栏不做了，换成其他形式」。`utils/search-reveal.ts`、`behaviors/search-reveal.ts`、
  `.pull` 位移容器、页面根 capture-bind 触摸四件套、swipe-select 的 `hideSearchIfShown` 钩子
  **全部删净**（verify 已登记禁止回归，谁加回来就复现三轮 bug 史）
- 现方案（纯点按，两页统一）：**导航栏右侧插槽**（`navigation-bar` 本就开了 multipleSlots，
  `<slot name="right">` 一直在、落在胶囊左侧标准工具区）放 `van-icon name="search"` 放大镜
  （颜色由模板按 `navBarColor` 传）；点开在导航栏下方展开一行输入框，再点图标收起并清词
- 折叠容器 `.search-fold`（app.wxss）：`height 0 ↔ var(--search-slot-h, 96rpx)` + 淡入 +
  `translateY(-8rpx)→0`，260ms 缓出；收起态**必须 overflow: hidden**；`data.searchOpen`
  一个布尔驱动，无手势无位移；`focus="{{ searchOpen }}"` 展开即自动聚焦
- **铺满对齐（第四轮）**：没有「取消」按钮、没有 row 包裹层，van-search 直接铺满整行；
  根节点的左右内边距靠 `--search-padding: 0 var(--space-page)` 穿透组件继承换成页面留白令牌，
  搜索框圆角边缘正好与下方卡片对齐
- **下滑自动收起（第四轮）**：`onPageScroll` → `onSearchScrollHide(e.scrollTop)`（两页同款），
  向下滚一次位移 > `SEARCH_SCROLL_HIDE_PX`(24px) 才收（轻微抖动/回弹不打扰，向上滚不收）；
  **`collapseSearch()` 只收输入行、保留关键词**——结果还在下面，清词会让列表跳回全部；
  防抖不作废（收起后照常落库，输入框与过滤一致）。实例字段 `searchLastTop`（-1=未滚过）
  必须登记进页面 Custom 接口（defineSwipeSelectPage 选项类型封闭）
- `closeSearch()`（图标再点）收起时**必须先 `commitSearch.cancel()`** 再清词刷新
  （否则防抖还会把关键词写回来）。搜索语义不变：限当月（记账）、跟随页签/标签（记事）
- 经验教训：**给低频功能配复杂手势（下拉跟手/吸附）性价比极低**——动效要求越高、失败面越大；
  入口类功能优先用「点按入口 + 简单过渡」。另外 `navigation-bar` 有现成 right slot，别再重造
- **导航栏标题居中（第四轮，第五轮修正垂直定位）**：`__center` 改绝对定位（left/right 0）——
  左侧 leftWidth 内联固定宽 vs 右侧插槽图标不对称，flex 流内 `flex:1` 会被挤偏；
  ⚠️ 垂直定位必须 **`bottom: 0 + height: var(--height)`**，不能 top/bottom 各
  `env(safe-area-inset-top)`（绝对定位参照 inner 的内边距盒，top:0 含状态栏区、
  内容带贴底；bottom 多减一次安全区高会把标题抬到状态栏一带，2026-09-21 真机翻车）；
  ⚠️ `__center` 必须加 `pointer-events: none`（全宽覆盖会挡住 right 插槽图标点击），
  `__right` 要 `flex:1 + justify-content: flex-end`（center 脱流后 right 不撑开会挤在中间）
- 回退点（历史方案仅存 git）：跟手版 `d0eddf7`；「阈值弹出/高度撑开」版基线 `8732595`

## 统计页分类明细「折叠容器高度过渡」（2026-09-21 第四轮）
- **不许退回 `wx:if` 卸载式显隐**：切分类时整块消失重现、高度跳变（用户报的"割裂感"），
  verify 已登记禁止回归
- 结构：常驻 `.detail-wrap`（`wx:if="{{ hasData }}"` + 内联 `height: {{detailH}}px`，
  overflow hidden + height/opacity 过渡）→ 内层 `.detail detail--t{{detailTick % 2}}`
- `detailH` 由 `syncDetailHeight()` 在 setData 回调里**实测** `.detail` 的 border-box 高度写入
  （展开 0→h、切换 旧h→新h、收起 →0 三个方向同一条过渡）；⚠️ 外边距全部挂 wrap 上、
  内层不能带 margin（实测的是 border-box，带 margin 底部会被裁掉一条）
- 内容淡入靠 `detailTick+1` 奇偶交替 `detail--t0/t1`（引用**不同名** keyframes，同名动画换
  class 不重播）；`detail-wrap--closed`（detailH===0）收起时整块淡出
- `collapseDetail()` 收起不清内容（留在容器里被裁掉），refresh() 重置时直接 detailH:0

## 备份恢复
- 唯一实现在 utils/backup.ts，导入逐条清洗；合并=id 去重补入+标签仅未自定义时导入+设置不动；
  覆盖=四项全替，quickTags null 时删 key 回落默认；改字段结构同步升 BACKUP_VERSION

## 入场过渡
- 统一 `.enter`（app.wxss）+ 内联 animation-delay，错峰延迟压 ~120ms 以内；
  收容器与入场节点分内外两层（animation-fill-mode: both 会压住 transition 的 transform）
- `.row-collapse`（列表行收起容器）平时**必须 `overflow: visible`**：hidden 会裁掉卡片 box-shadow，
  浅色主题下记录卡失去立体感（2026-09-21 修）；裁剪只在 `.row-collapse--out` 收起动画期间需要
