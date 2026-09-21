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

## 顶部搜索栏「跟手下拉 + 松手吸附」（2026-09-21 第二轮定稿，详见技能第 7.4 节）
- 位移模型：搜索栏**绝对定位在 `.pull` 上方一个槽位高**处，`.pull`（包住搜索栏与全部内容）
  用内联 `transform: translate3d(0, Npx, 0)` 把它带进视口 —— 手指下拉多少就下移多少（1:1），
  观感是"搜索框从上方滑入、内容整体下移"，而不是"高度从 0 撑开"（后者把搜索框压扁着展开）
  ⚠️ `.pull` 的 transform 会给后代创建包含块，页面里不能有依赖它定位的 `position: fixed` 元素
  （fab / 多选操作条 / 撤销条都在 `.page` 之外，安全）
- **位移与 transition 必须拼进同一次 setData**（`pullStyleOf`）：跟手期间 `transition: none`，
  松手换成吸附曲线；拆成两个字段会让"关过渡"与"改位移"落不同帧 → 跟手第一段被曲线吃掉、慢半拍。
  `applyPullOffset(offset, shown)` 是位移/展开态的**唯一出口**，并顺带丢弃未完成的手势
- 手感参数（utils/search-reveal.ts 顶部）：激活死区 `PULL_ACTIVATE_PX=6`（横向滑删的纵向漂移不误抖，
  越过后仍严格 1:1）、阻尼 `PULL_OVERSHOOT_DAMPING=0.35` 且封顶 `PULL_MAX_RATIO=1.6`、
  吸附门槛 `PULL_SNAP_RATIO=0.4` / 速度 `PULL_SNAP_VELOCITY=0.3`（速度优先于距离）、
  吸附曲线 `PULL_SETTLE_EASING` 的 y>1 制造轻微过冲 ＝ iOS 橡皮筋感
- 收起口径不变：往下翻或空闲 5s 收回；有输入 / 聚焦中不收；多选态一律收起
  （swipe-select 的 `enterSelect` 调可选钩子 `hideSearchIfShown?.()`）
- 驱动仍有两路，各管一段（缺一路就出"进页直接下拉没反应、得先上滑再拉"）：
  ① `onPageScroll(e)` → `closeSwipesOnScroll()` + `onPageScrollSearch(e.scrollTop)`（中部方向判定，
  仅 scrollTop ≤ 150px 时露出——中部上滑撑开会把下方内容整体下移，叠在手指位移上像"内容自己跳"）；
  ② 页面根挂 `capture-bind:touchstart/touchmove/touchend/touchcancel`（贴顶跟手那一路）
- ⚠️ 触摸那一路**必须 capture-bind**：van-swipe-cell 有 `catchtouchmove`（拖动中阻断冒泡），换 `bind`
  就收不到"手指落在卡片上"的 move，而贴顶下拉恰好全落在卡片上。`top` 要在 touchmove 里**现读**
  `searchLastTop`（不能用 touchstart 快照：中部拉回顶部时手指还没松）；接管判定惰性放在 touchmove
  （要接"从中部一路拉回顶部"的手势，dy 只从贴顶那一帧起算，位移才不会突变）
- `onSearchTouchEnd` 的**回弹一支不走 `hideSearch`**：会被"正在使用/不可滚动"拦下 → 位移卡在半路。
  唯一例外：`searchUnscrollable` 时回弹成露出（也是常驻栏被多选态藏起来后唯一能找回的路径）
- **不用 enablePullDownRefresh**（会带微信原生转圈，且整页下移回弹 + 搜索栏撑开是双重位移）
- 槽位高度用确定值：app.wxss 的 `--search-slot-h` ↔ `utils/search-reveal.ts` 的 `SEARCH_SLOT_HEIGHT_RPX`
  必须同步（JS 要用它判断"内容能不能滚动"与"拉出量过没过吸附门槛"）
- **内容短到不能滚动时搜索栏常驻**（否则用户永远做不出"下拉"这个动作）：`checkSearchRevealFit()` 在
  refresh 末尾调用；比较时**减掉搜索栏自身占位**（否则"撑开→能滚动→收起→又不能滚动"振荡），另有 24px 余量
- 编排接入方式：页面选项里 `...searchRevealMixin`（带 ThisType 的对象字面量），页面 Custom 接口 extends
  `SearchRevealFields, SearchRevealMethods`。**别用 Object.assign**（丢 this 类型），也不必改
  defineSwipeSelectPage 签名
- 回退点：跟手版 `d0eddf7`；旧「阈值弹出 / 高度撑开」版基线 `8732595`

## 备份恢复
- 唯一实现在 utils/backup.ts，导入逐条清洗；合并=id 去重补入+标签仅未自定义时导入+设置不动；
  覆盖=四项全替，quickTags null 时删 key 回落默认；改字段结构同步升 BACKUP_VERSION

## 入场过渡
- 统一 `.enter`（app.wxss）+ 内联 animation-delay，错峰延迟压 ~120ms 以内；
  收容器与入场节点分内外两层（animation-fill-mode: both 会压住 transition 的 transform）
- `.row-collapse`（列表行收起容器）平时**必须 `overflow: visible`**：hidden 会裁掉卡片 box-shadow，
  浅色主题下记录卡失去立体感（2026-09-21 修）；裁剪只在 `.row-collapse--out` 收起动画期间需要
