# ACCEPTANCE - 记事记账小程序基础版（本地存储版）

| 项 | 值 |
|---|---|
| 任务名 | ledger-notes |
| 阶段 | Automate 执行中（N-01 ~ N-13 已完成，N-14 部分完成） |
| 日期 | 2026-09-16 |
| 存储方案 | 基础版纯本地 Storage（云开发下一期） |

---

## 1. 已完成交付物

### 1.1 工程配置（N-01 / N-02）
- `package.json` / `tsconfig.json` / `tsconfig.test.json` / `jest.config.js` / `jest.setup.js`
- `project.config.json`：启用 TypeScript 插件 + `packNpmRelationList`（新版字段 `packageJsonPath` + `miniprogramNpmDistDir`）
- 依赖：@vant/weapp 1.11.7、dayjs 1.11.23、mobx-miniprogram 6.12.3、mobx-miniprogram-bindings 7.0.0、jest 30 + ts-jest 29.4、typescript 5.6.3
- 已执行「构建 npm」，`miniprogram_npm/` 生成完整

### 1.2 架构分层
```
types/models.ts          数据模型（金额统一「分」、extra 扩展字段）
utils/                   id / date / debounce / money / export
service/                 storage（内存缓存）/ ledger / notes / settings
store/                   ledger / notes / settings（mobx-miniprogram）
components/              empty-state
components/business/     ledger-card / note-item
pages/                   index（首页）/ ledger|list,edit（记账）/ notes|list,edit（记事）/ profile
```

### 1.3 功能清单
| 模块 | 能力 | 状态 |
|---|---|---|
| 首页 | 本月收入/支出/结余、本月笔数、待办未完成数、快捷入口、最近 5 条记账、空状态 | ✅ |
| 记账 | 新增（金额/收支类型/日期/标签/备注）、列表倒序、编辑、删除（二次确认）、月度汇总 | ✅ |
| 记事 | 新增（普通/待办）、列表、搜索（300ms 防抖）、类型筛选、勾选完成、编辑、删除 | ✅ |
| 个人中心 | 数据量与占用空间、导出到剪贴板、清空数据（二次确认）、云备份/账号/主题占位 | ✅ |
| 深色模式 | `app.wxss` CSS 变量 + `@media (prefers-color-scheme: dark)`；tabBar 走 `theme.json` @变量（含两套图标） | ✅ |
| tabBar | 4 tab，16 个 81×81 自绘图标（light/dark × 选中/未选） | ✅ |

---

## 2. 验证结果

### 2.1 编译与渲染（模拟器截图验证）
| 页面 | 结果 |
|---|---|
| 首页 | ✅ 正常渲染（汇总卡、快捷入口、最近记账、tabBar 图标） |
| 记账列表 | ✅ 正常渲染 |
| 记账编辑 | ✅ 收支切换、金额/日期/标签/备注、保存/删除按钮 |
| 记事列表 | ✅ 搜索框、全部/待办/笔记筛选、悬浮新增 |
| 记事编辑 | ✅ 类型切换、多行输入、保存 |
| 个人中心 | ✅ 数据说明、导出、清空、占位入口 |
| `cli preview` | ✅ 编译通过，包体 118.2 KB |

### 2.2 单元测试（jest）
```
Test Suites: 5 passed, 5 total
Tests:       34 passed, 34 total
```
覆盖范围：
- `ledger.service`：元→分转换（19.99 → 1999 无浮点误差）、月份过滤、更新、删除、月度汇总
- `notes.service`：普通笔记 done 恒 false、待办勾选切换、toggleDone 对普通笔记无效、关键词搜索、类型过滤、未完成计数
- `storage`：缓存命中、跨进程读取、损坏数据不抛错、空 key 返回 null、写入失败抛 StorageError
- `store`：add/remove/汇总联动、toggleDone、搜索关键词过滤
- `utils`：money（含浮点边界）、uid 唯一性、debounce/throttle、月份范围、导出文本

### 2.3 端到端流程验证（模拟器自动化执行真实操作）
脚本：`tools/e2e-final.js` / `tools/verify2.js`（模拟输入、点击保存、读取 storage）

| 步骤 | 结果 |
|---|---|
| 记账编辑页填表：金额 25.5 / 标签 餐饮 / 备注 中午的牛肉面 → 保存 | ✅ |
| 记账列表 | ✅ 记录数 1，支出 ¥25.50，结余 ¥25.50 |
| 再记一笔收入：8800 / 工资 | ✅ |
| 记事编辑页：类型待办、内容「周报还没写」→ 保存 | ✅ |
| 记事列表 | ✅ 条数 1，未完成待办 1 |
| 首页汇总 | ✅ 收入 ¥8800.00 / 支出 ¥25.50 / 结余 ¥8774.50 / 本月 2 笔 / 待办未完成 1 / 最近 2 条 |
| Storage 持久化 | ✅ 记账 2 条（工资 880000 分、餐饮 2550 分）；记事 1 条（todo，未完成） |

结论：金额「元→分」转换正确、跨页面数据一致、写入本地存储可持久化。

### 2.4 仍需人工确认项
- [ ] 系统切换深色模式后的整体观感（含 tabBar 图标切换）
- [ ] 导出数据 → 粘贴到记事本确认内容完整
- [ ] 真机预览效果

---

### 2.5 组件渲染验证（像素探针法）
自动化选择器无法选中自定义组件（连必然渲染的 `navigation-bar` 也返回 0），因此改用**像素探针**验证：
给组件临时加唯一色边框（ledger-card 品红 / note-item 青色）→ 截图 → 统计该色像素数 → 验证后移除。

| 页面 | 探针色像素 | 结论 |
|---|---|---|
| 记账列表 | 4320 | ✅ ledger-card 已渲染 |
| 首页（最近记账） | 3769 | ✅ ledger-card 已渲染 |
| 记事列表 | 2197 | ✅ note-item 已渲染 |

探针已全部移除（复核：品红/青像素均为 0），四个页面最终截图内容像素量 21000~25000，渲染正常。

---

## 2.6 本轮修复记录

| # | 问题 | 原因 | 修复 |
|---|---|---|---|
| 1 | 模拟器报 `module '.../types/models.js' is not defined`、`app.js is not defined`、Page 未注册 | 误删 `app.json` 的 `lazyCodeLoading: "requiredComponents"`，导致本 IDE 版本不编译非页面 TS 模块 | 恢复该字段 |
| 2 | 组件导入路径少一级（`../../types/models` 实际指向 `components/types/models`） | 组件位于 `components/business/xxx/`，需上跳三级 | 改为 `../../../types/models` 等（全项目 69 处相对导入已校验，0 异常） |
| 3 | 首页/记事列表卡片不渲染 | `wx:for` 直接写在自定义组件标签上 | 改为外层包裹 `<view wx:for>`，组件写在内部 |

> 排错经验：组件 WXSS 热编译存在滞后，**改动后需等一次全量重编译（或重开项目窗口）再验证**，否则会得到假阴性结论。

---

## 2.7 Vant Weapp 组件化改造（已完成）

已确认 **Vant Weapp 在 glass-easel 组件框架下渲染正常**（验证方式：Vant 卡片边框色 `#ebedf0` 像素数 >2000/页，主色按钮绿色像素 >8000）。

| 页面 | 使用的 Vant 组件 |
|---|---|
| 首页 | `van-grid` + `van-grid-item`（快捷入口） |
| 记账列表 | `van-swipe-cell`（左滑删除，替代原「删除」文字按钮） |
| 记账编辑 | `van-cell-group` / `van-field`（金额digit、标签、备注textarea）/ `van-cell`（日期）/ `van-button`（保存、删除） |
| 记事列表 | `van-search`（搜索）/ `van-tabs` + `van-tab`（全部·待办·笔记）/ `van-swipe-cell`（左滑删除） |
| 记事编辑 | `van-cell-group` / `van-field`（textarea + 字数统计）/ `van-button` |
| 个人中心 | `van-cell-group` / `van-cell`（带图标）/ `van-button` |

配套改动：
- `van-field` / `van-search` 的 `change` 事件 `detail` **就是值本身**（非 `detail.value`），已加 `pickValue()` 统一兼容两种形态
- `van-tabs` 的 `change` 事件 `detail.index` 映射为 `all / todo / plain`
- `note-item` 组件移除内置「删除」文字，统一走左滑
- `app.wxss` 增加 Vant CSS 变量深色覆盖（cell / field / search / tabs / grid / button）

改造后回归验证：
| 项 | 结果 |
|---|---|
| 记账新增（页面实例驱动 onSubmit） | ✅ 66.66 → 6666 分，存储 3 条 |
| 记事新增待办 | ✅ 存储 2 条 |
| 首页汇总联动 | ✅ 收入 ¥66.66 / 支出 ¥1246.34 / 结余 ¥1179.68 / 本月 3 笔 / 待办 2 |
| van-tabs 切换到「待办」 | ✅ filter=todo, activeTab=1, 过滤后 2 条 |
| 六页渲染 | ✅ 全部正常 |
| jest 单测 | ✅ 34/34 通过 |

> 说明：Vant 控件位于自定义组件内部，自动化工具无法选中（原生 `<input>` 可以），因此表单提交回归改为在页面实例上直接 `setData` + 调用 `onSubmit`；Vant 事件契约通过读取 `miniprogram_npm/@vant/weapp/field/index.js` 源码确认。

---

## 2.8 统一纯白背景 + 主题机制收敛（已完成）

### 背景
原先 3 个页面（首页 / 记账编辑 / 记事列表）各自实现了一套内联主题：`wx.onThemeChange` → `setTheme()` → 拼 CSS 变量字符串绑到根节点。
浅色配色写的是 `--bg-color:#f5f5f5`（灰底），且**未包含 Vant 变量**，导致深色下 Vant 组件仍是白底（此前用 `!important` 粗暴覆盖 van-grid 内部元素来临时绕过）。

### 改动
1. 新增 `utils/theme.ts`，集中定义两套配色与变量生成：
   - `LIGHT_COLORS`：页面 `#ffffff`、卡片 `#ffffff`（纯白）
   - `DARK_COLORS`：页面 `#121212`、卡片 `#1e1e1e`（沿用原有深色观感）
   - `buildThemeStyle(isDark)`：输出**业务变量 + Vant 变量**的完整内联样式
2. 三个页面改为调用该工具（删除各自的重复实现）
3. `theme.json`（pageBg/cardBg）与 `app.wxss`（深色默认值）对齐到同一套配色

### 验证（像素级实测）
| 主题 | 结果 |
|---|---|
| 浅色 | 六个页面主背景色均为 **`#ffffff`**（采样点 100% 纯白；残留 `#f5f5f5` 仅 0.8%，为文字抗锯齿边缘像素） |
| 深色（临时强制深色实测） | 六个页面主色 **`#121212`** + 卡片/Vant cell **`#1e1e1e`**，绿红点缀正常，**无白色残留块**（van-grid 白块问题随之消失） |

> 深色验证方式：临时把 `buildThemeStyle(isDark)` 强制为 `true`、并把 WXSS 的 `prefers-color-scheme: dark` 临时换成 `light`，截图测量后自动还原（脚本 `tools/dark-verify.js`，支持 force/restore）。

### 后续可选清理
`pages/index/index.wxss` 中针对 van-grid 内部元素的 `!important` 覆盖（注释为「暴力覆盖…解决两块白块」）在引入主题化 Vant 变量后已非必需，可择机简化。

---

## 2.9 视觉升级：生活化调性（已完成）

调性定档：**生活化** —— 暖调中性色、大圆角、浅投影、线性图标。

### 2.9.1 设计令牌（`app.wxss` + `utils/theme.ts`）
| 类别 | 取值 |
|---|---|
| 主色 | `#34be8c`（柔和青绿，替代原 `#07c160`）；浅底 `#e9f7f1` |
| 支出色 | `#ee6c5c`（珊瑚红，替代原 `#ee0a24`）；浅底 `#fdeeeb` |
| 点缀色 | `#ffb74d` 琥珀，用于待办标记 |
| 中性色（浅） | 页面纯白 `#ffffff`／卡片 `#ffffff`／边框 `#f2efeb`／主文字 `#2e2a26`／次要 `#9a948d` |
| 中性色（深） | 页面 `#171512`（暖黑）／卡片 `#211e19`／边框 `#322e28` |
| 字号阶梯 | 40 / 32 / 28 / 24 / 22 rpx（金额输入 56rpx） |
| 间距刻度 | 8 的倍数：页面 32 · 卡片内 32 · 卡片间 16 · 分区间 48 rpx |
| 圆角 | 卡片 24 · 控件 16 · 胶囊 999 rpx |
| 层次 | 浅色：`0 4rpx 20rpx rgba(150,125,95,.08)`；**深色：`0 0 0 1rpx #322e28` 描边环**（深色下投影不可见） |

### 2.9.2 结构调整
- **记账列表按日期分组**：今天／昨天／前天／M月D日（跨年带年份），每组带当日小计「支出 ¥xx · 收入 ¥xx」；新增 `utils/group.ts`（纯函数，已单测）
- **结余成为视觉主角**：首页与记账列表的汇总卡改为「本月结余」大字 + 收入/支出两列次要
- **记账编辑降噪**：分段控件改为「浅底轨道 + 白色滑块 + 彩色文字」；金额独立成大号输入框；新增常用标签胶囊；页面只保留一个填充主按钮，删除降级为文字链接
- **组件升级**：ledger-card 增加首字徽标（收入浅绿／支出浅红）+ 等宽数字金额（千分位）；note-item 勾选圈加过渡、待办用小琥珀胶囊标记；empty-state 去掉 emoji 改用 Vant 线性图标 + 圆形浅底 + 行动按钮
- **tabBar 图标**：程序生成的几何图形 → **线性图标**（房子／钱包／便签／人像），未选中暖灰线框、选中主色加粗；用 SDF + 4× 超采样渲染，8 个形状 × 2 主题 = 16 张 PNG
- **等宽数字**：金额统一 `font-variant-numeric: tabular-nums`，并加千分位（`¥1,234.00`）

### 2.9.3 本轮修掉的三个坑
| # | 现象 | 根因 | 处理 |
|---|---|---|---|
| 1 | 按钮不通栏、cell 组无卡片感 | WXML 中**裸写的布尔属性**（`block` / `round` / `inset` / `is-link` / `autosize`）传进去是空字符串，被 Vant 判为 `false` | 全部改为 `{{true}}`（已脚本全量校验，0 残留） |
| 2 | 改成 `{{true}}` 后按钮仍不通栏 | `block` 是 WXML 保留字（`<block>` 标签），作为属性名被忽略 | 改用 Vant 的 `custom-style="width: 100%;"`（内联样式，优先级最高）—— 按钮从 180px 变为 413px 通栏 |
| 3 | 常用标签整块高度为 0 | 补丁脚本的替换锚点与实际文件不匹配，`quickTags` 未写入 data | 修正 data（`h=80`） |

### 2.9.4 验证
| 项 | 结果 |
|---|---|
| 分组列表渲染（临时造 4 条数据） | ✅ 3 张支出卡（浅红徽标）+ 1 张收入卡（浅绿徽标）+ 2 个日期分组标题，校验后数据已清除 |
| 空状态 | ✅ 浅绿圆形 + 线性图标 + 「记一笔」行动按钮 |
| 主按钮宽度（`custom-style`） | ✅ 413px 通栏（此前 180px） |
| 浅色配色 | ✅ 页面纯白，六页一致 |
| 深色配色（强制深色实测） | ✅ 页面 `#171512` + 卡片 `#211e19` + 主色按钮 `#34be8c`，无白色残留 |
| jest 单测 | ✅ 41/41 通过（6 个套件，新增分组与千分位用例） |

> 量测手段：`wx.createSelectorQuery` 直接量元素矩形（可选中自定义组件，比 automator 可靠）；`tools/row-profile.js`＋`tools/ascii-crop.js` 把截图转成剖面/字符图判读布局；`tools/palette-scan.js` 按调色板统计元素位置。

---

## 2.10 三项缺陷整改（已完成）

| # | 现象 | 根因 | 处理 |
|---|---|---|---|
| 1 | 本月结余在「支出 > 收入」时仍显示为正 | `formatMoney(fen, cur)` 第三参 `withSign` 未传，负数丢符号 | 首页与记账列表改为 `formatMoney(s.balance, cur, true)`，并新增 `balanceClass`：结余为负时用支出色 |
| 2a | 深色下首页「去记账 / 去记账」两块仍是白色 | 我写的是 `--grid-item-background-color`，而 Vant 实际读的是 **`--grid-item-content-background-color`** | 两个变量名都补上（含 `--grid-item-content-active-color` 按压态），theme.ts 与 app.wxss 同步 |
| 2b | 深色下除首页外，其余页面标题仍是黑色 | 4 个页面硬编码 `color="black"` | 记事列表改 `{{navBarColor}}`（走 JS 主题）；记账列表 / 记事编辑 / 个人中心改 `color="var(--text-color)"`（走 app.wxss + 媒体查询） |
| 2c | 深色下「日期 / 标签 / 备注」的行分隔线非常刺眼 | **Vant 的 `.van-cell:after` 颜色硬编码 `#ebedf0`**，完全不读 `--cell-border-color`；深色卡片上就是一道浅灰亮线 | 关闭 Vant 原生线（`border="{{false}}"`，`van-field` 内部即 `van-cell`），改为自绘 `.row-divider`（1rpx + `var(--border-color)`），涉及记账编辑、记事编辑、个人中心三页 |

### 验证（像素级实测）
| 项 | 结果 |
|---|---|
| 结余符号 | ✅ 支出合计 ¥1.00 / 收入 ¥0.00 → 首页与列表均显示 **`-¥1.00`**，并带支出色（临时造数验证过支出 ¥1,339.40 的场景：`-¥839.40`） |
| 深色 grid | ✅ 首页内容区白色像素归零（仅剩标签栏，属强制测试下 theme.json 仍取系统浅色的正常现象） |
| 深色导航标题 | ✅ 六页标题文字素均为浅色（300~480 px） |
| 深色分隔线 | ✅ 记一笔页 `#ebedf0` 像素从遍布降至 **7 px**（仅导航栏区域），分隔线改用主题色 |
| 分隔线结构 | ✅ 记一笔页两条分隔线存在（w=334，位于 y=401 / 446） |
| jest 单测 | ✅ 41/41 通过 |

> 临时验证数据（tag 为「样式验证」）已全部清除，仅保留使用者本人的 1 条记录。

---

## 2.11 按钮区微调（已完成）

| 项 | 结论 |
|---|---|
| 「保存 / 删除」间距 | 由 `.btn-del { margin-top: 24rpx }` 改为 **`.actions` 纵向 flex + `gap: 40rpx`** 统一控制（实测 45rpx）。此前在 `.actions` 上写 `gap` 无效——`gap` 只对 flex / grid 容器生效 |
| 按钮宽度 | 按使用者选择保留 **80%**（`.act-btn` 的 `width:100%` 被 `custom-style` 内联样式覆盖）。实测 331px / 容器 418px ≈ 80% |
| 附带统一 | 记事编辑页的「普通笔记 / 待办」由整块绿色填充（旧样式）改为与「记一笔」一致的**浅底轨道 + 白色滑块 + 彩色文字** |
| 踩坑 | 原生 `<button>` 自带 `margin: 0 auto`，**在 flex 容器里 auto 外边距会阻止拉伸**；需要定宽时把 `margin: 0` 一并写进行内样式（`custom-style="width: 100%; margin: 0;"`） |

> 注：记账编辑页与个人中心的按钮仍为通栏 100%，如需与记事编辑页统一为 80%，改对应的 `custom-style` 即可。

---

## 2.12 分组卡片「缝隙」修复（已完成）

**现象**：深色模式下，每个 `van-cell-group` 卡片的**上下边缘露出一条浅灰细线**（像一条缝）。

**根因**：Vant 的 `cell-group` 在 `border` 为真时给容器加上 `van-hairline--top-bottom`，而该类的伪元素写法是
```css
.van-hairline--top-bottom:after { border: 0 solid #ebedf0; border-width: 1px 0; transform: scale(.5) }
```
颜色 **`#ebedf0` 是硬编码的**，不读任何 CSS 变量；深色下与卡片底色混合后就是 `rgb(186,187,184)` 的亮线（实测定位到卡片上边缘 y=465/466 两行）。

**修法**：给分组加外部类 + 覆盖伪元素边框色，不改结构：
```wxml
<van-cell-group inset="{{true}}" custom-class="cell-card" ...>
```
```css
/* app.wxss */
.cell-card::after { border-color: var(--border-color) !important; }
```
覆盖后：浅色 `#f2efeb`（暖调、柔和发丝线）、深色 `#322e28`（不再刺眼）。

**验证**
| 项 | 结果 |
|---|---|
| 深色孤立亮线检测（记账编辑 / 记事编辑） | ✅ 0 条（此前卡片边缘为 `rgb(186,187,184)` 亮线） |
| 深色 profile | ✅ 仅剩 y=887 一行（标签栏上边框；强制深色测试下标签栏仍取系统浅色，属正常） |
| 浅色发丝线色彩 | ✅ 呈现暖调混合色 `rgb(245,243,240)` 等，偏冷的 `#ebedf0` 完全消失 |
| jest 单测 | ✅ 41/41 通过 |

> 本次确认：**Vant 组件的外部类（`custom-class`）在本环境可用**（另一处证据是个人中心「清空全部数据」用 `custom-class="cell-danger"` 上色成功）。此前 `block` 属性失效导致按钮不通栏，与外部类机制无关。

---

## 3. 已知问题与后续项

| # | 问题 | 说明 / 计划 |
|---|---|---|
| 1 | ~~未使用 Vant Weapp~~ | **已完成**（见 2.7）。原生组件仅保留：自定义导航栏、金额统计卡、悬浮新增按钮、类型切换条 |
| 2 | 金额内部统一「分」 | 与 TASK 原描述「summary 返回元」不同，现统一为「分」，展示层用 `utils/money.ts` 格式化，规避浮点误差 |
| 3 | 列表未分页 | 全量读取 + 内存缓存；数据量小无影响，后续可加触底加载 |
| 4 | **`lazyCodeLoading: "requiredComponents"` 必须保留** | 移除后本 IDE 版本不会把 `types/models.ts`、`app.ts`、`service/*.ts` 等非页面模块编译进调试包，运行时报 `module '../types/models.js' is not defined` / `app.js is not defined`，整个 app 无法注册。已恢复并验证 |
| 5 | 自动化截图依赖 IDE 服务端口 | 若手动关闭服务端口，模拟器自动验证链路会失效，需重新开启 |
| 6 | tabBar 图标为程序生成 | 造型较简单，后续可替换为设计稿图标（替换 `assets/tabbar/` 下同名文件即可） |

---

## 4. 下一期（云开发）

`service/request.ts` 需补充实现；业务 service 已按抽象分层，替换内部实现即可上云，页面层无需改动。
