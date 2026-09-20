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

## 交互约定（用户确认）
- 编辑记录=长按（首次误点 `hintOnce` 教一次）；多选=右滑进入（顺带选中）、多选态左滑退出
- 删除唯一路径：左滑/多选批量，"整行收起→落库→底部 5 秒撤销"；编辑页无删除入口，吸底条只放全宽「保存」
- 首页：记账区+记事区（记事区只显示待办，点整条即完成）；汇总卡放额度进度条（无支出构成占比条）
- 记事页新增默认类型跟随当前 tab；「我的」页设置入口不显示右侧摘要
- **首页入口返回落点（定稿）**：`去记账/去记事/加待办` 直接 navigateTo 编辑页，别再引入 nav-intent
  （微信不允许 navigateTo tab 页，折中方案用户不接受）

## 滑删编排（behaviors/swipe-select.ts，收口四修定稿见技能第 7.1~7.3 节）
- 两列表页滑删/多选/删除/撤销编排全在 behaviors，页面只留 config 与 visibleIds()/refresh()
- 页面挂载必须走 `defineSwipeSelectPage(config, page)`，别 Object.assign 直传 Page()（丢 this 类型）
- 收行主力=实例树扫描 `collectOpenCells()`（selectComponent 会静默返回 null）
- ⚠️ 整页收口**终止型：只归零不还原**（`resetSwipes`），宽度恢复由 onShow 下一帧 `restoreSwipeWidth()`
  完成；"归零一帧→下一帧还原"会被 Vant observer 覆盖导致半开卡死。单行 `forceCloseRow` 则必须还原（120ms）
- 页面接线定稿：onShow=`resetSwipes(); wx.nextTick(restoreSwipeWidth)`；onHide=`resetSwipes()`
- `openSideMap` 是"哪一侧归零"的唯一依据，残留会让左滑永久失效；任何提前 return 前先清记录
- 多选态行首 `.pick--in` 占 72rpx，卡片内边距要收窄（`.row-inner--picking`，不用 `:has()`），
  别缩勾选圈本身；记账页 ledger-card 无自带勾选圈，别顺手改

## 备份恢复
- 唯一实现在 utils/backup.ts，导入逐条清洗；合并=id 去重补入+标签仅未自定义时导入+设置不动；
  覆盖=四项全替，quickTags null 时删 key 回落默认；改字段结构同步升 BACKUP_VERSION

## 入场过渡
- 统一 `.enter`（app.wxss）+ 内联 animation-delay，错峰延迟压 ~120ms 以内；
  收容器与入场节点分内外两层（animation-fill-mode: both 会压住 transition 的 transform）
