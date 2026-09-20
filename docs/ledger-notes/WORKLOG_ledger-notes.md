# 工作总结与交接文档（ledger-notes）

> 覆盖范围：从需求确认 → 工程搭建 → 功能实现 → 视觉升级 → 缺陷修复的全过程。
> 相关文档：`TASK` / `CONSENSUS` / `DESIGN` / `ALIGNMENT` / `REVIEW` / `ACCEPTANCE`（同目录）

---

## 一、项目概况

| 项 | 内容 |
|---|---|
| 产品 | 记账 + 记事 微信小程序（基础版本地存储版） |
| 工作区 | `D:\WeChatProjects\miniprogram-1` |
| AppID | `wxf3ec012ce512ea29` |
| 技术栈 | 微信原生 + TypeScript + Vant Weapp 1.11.7 + mobx-miniprogram + dayjs |
| 渲染 | **Skyline（glass-easel）**，自定义导航栏 + tabBar 双主题 |
| 规模 | 6 个页面 / 4 个组件 / 109 个文件（不含依赖），34 个 `.ts`、10 个 `.wxml`、11 个 `.wxss` |
| 数据层 | 基础版纯本地 Storage（云开发留到下一期） |

**目录分层**
```
types/     数据模型（金额统一「分」）
utils/     id / date / money / export / debounce / group / theme
service/   storage（内存缓存）/ ledger / notes / settings
store/     mobx store（ledger / notes / settings）
components/  empty-state、business/ledger-card、business/note-item、navigation-bar
pages/     index、ledger/{list,edit}、notes/{list,edit}、profile
```

---

## 二、做了什么

**阶段 1 · 需求与设计**
输出 6 份文档：任务拆解（TASK）→ 共识（CONSENSUS）→ 设计（DESIGN）→ 对齐（ALIGNMENT）→ 评审（REVIEW）→ 验收（ACCEPTANCE），把「记什么、怎么记、存哪」先定死再动手。

**阶段 2 · 工程初始化**
TypeScript 配置与 jest 环境、依赖安装 + **构建 npm**、`project.config.json` 关键项（TS 插件、npm 打包路径）、tabBar 与 `theme.json` 双主题骨架。

**阶段 3 · 分层实现**
工具层 → service 层（含 StorageService 内存缓存）→ mobx store → 4 个组件 → 6 个页面。金额一律以「分」存储、展示时格式化，从根上规避浮点误差。

**阶段 4 · 验证体系**
- 单元测试 6 套件（service / store / utils）
- 模拟器自动化：`cli preview` 编译、逐页截图、真实交互（填表 → 保存 → 列表 → 汇总联动）
- **像素级验证**：把截图降采样成字符图 / 逐行剖面 / 按调色板扫描元素位置

**阶段 5 · Vant 组件化**
接入 `van-field / van-cell(-group) / van-button / van-search / van-tabs / van-grid / van-swipe-cell / van-icon`，替代原生控件；列表引入左滑删除。

**阶段 6 · 视觉升级（生活化调性）**
建立设计令牌（字号 / 间距 / 圆角 / 色彩角色 / 层次表达），配色从微信绿硬红改为柔和青绿 `#34be8c` + 珊瑚红 `#ee6c5c` + 琥珀点缀；线性 tabBar 图标（SDF + 4× 超采样渲染）；记账列表**按日期分组**并显示当日小计；结余成为视觉主角；编辑页降噪（浅底滑块分段控件、大号金额输入、常用标签胶囊、单一主按钮）。

**阶段 7 · 缺陷修复（多轮，见第四节）**

---

## 三、实现的效果

| 维度 | 结果 |
|---|---|
| 功能 | 首页汇总（结余/收支/本月笔数/待办数/最近记录）、记账增删改 + 按月汇总 + 按日期分组小计、记事增删改 + 搜索 + 类型筛选 + 待办勾选、个人中心（数据量/空间/导出/清空/占位入口） |
| 测试 | **jest 41/41 通过**（6 套件）；`cli preview` 编译通过，包体约 123 KB |
| 渲染 | 6 个页面在模拟器实拍验证通过（含空状态、带数据的分组列表） |
| 主题 | 浅色统一纯白 + 暖调中性色；深色暖黑 `#171512` / 卡片 `#211e19`，实测无白色残留、无刺眼分割线 |
| 体验 | 金额等宽数字 + 千分位、卡片首字徽标、左滑删除、勾选动效、空状态行动引导、线性图标 |

---

## 四、修复的 Bug 清单（按根因分类）

### A. 工程与编译类
| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| A1 | 组件静默不渲染 | 业务组件被写进页面 `json` 顶层而非 `usingComponents` 内 | 修正层级 |
| A2 | 模拟器报 `module '../types/models.js' is not defined`、`app.js is not defined`、页面未注册（而 `cli preview` 却成功） | **误删了 `app.json` 的 `lazyCodeLoading: "requiredComponents"`**，导致该版本 IDE 不把非页面 TS 模块（types/service/store/utils/app）编译进调试包 | 恢复该字段（**不可删**） |
| A3 | 组件报找不到模块 | 组件位于 `components/business/xxx/`，相对导入少跳一级（`../../types/models` 实际指向 `components/types/models`） | 改为 `../../../`；已脚本全量校验 69 处相对导入 |
| A4 | 首页与记事列表卡片不渲染 | `wx:for` 直接写在自定义组件标签上 | 改为外层 `<view wx:for>` 包裹 |
| A5 | jest 无法运行 | `beforeEach` 写在 `setupFiles` 阶段（此时测试框架未装载） | 清理逻辑移入各测试文件 |
| A6 | 测试互相污染 | 批量替换把测试内的 `clearCache()` 误改成 `clear()`，把刚写的数据清掉 | 区分「清缓存」与「清数据」 |

### B. Vant 组件行为类（同一个坑的不同表现）
| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| B1 | 按钮不通栏、cell 组没有卡片感 | WXML 中**裸写布尔属性**（`block` / `round` / `inset` / `is-link` / `autosize` / `show-word-limit`）传进去是空字符串 → 被判为 `false` | 全部改为 `{{true}}`（脚本全量校验 0 残留） |
| B2 | 改成 `{{true}}` 后按钮仍不通栏 | **`block` 是 WXML 保留字**（`<block>` 标签），作为属性名被忽略 | 改用 `custom-style="width: 100%; margin: 0;"`（内联样式优先级最高） |
| B3 | 深色下首页「去记账/去记事」仍是白块 | Vant grid 实际读的是 **`--grid-item-content-background-color`**，我写成了 `--grid-item-background-color` | 补正确变量名（含 `--grid-item-content-active-color`） |
| B4 | 深色下 cell 行分隔线非常刺眼 | `.van-cell:after { border-bottom: 1px solid #ebedf0 }` **颜色硬编码**，不读任何 CSS 变量；`van-field` 内部就是 `van-cell` | 关闭原生线（`border="{{false}}"`）+ 自绘 `.row-divider`（`var(--border-color)`） |
| B5 | 深色下分组卡片上下边缘露出浅色缝隙 | `van-hairline--top-bottom:after` 同样**硬编码 `#ebedf0`** | `custom-class="cell-card"` + `.cell-card::after { border-color: var(--border-color) !important }` |

### C. 布局与样式类
| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| C1 | `.actions` 上写 `gap` 不生效 | `gap` 只对 flex / grid 容器生效，该容器是普通块级 | 改为 `display:flex; flex-direction:column; gap:40rpx` |
| C2 | flex 容器里按钮不拉伸 | 原生 `<button>` 自带 `margin: 0 auto`，**flex 中的 auto 外边距会阻止拉伸** | 定宽写进行内样式：`custom-style="width: 100%; margin: 0;"` |
| C3 | 快捷标签整块高度为 0 | 补丁脚本的替换锚点与实际文件不匹配，`quickTags` 未写入 `data` | 修正 data（补丁前先 Read 核对真实内容） |

### D. 逻辑类
| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| D1 | 本月结余在「支出 > 收入」时仍显示为正 | `formatMoney(fen, currency)` 第三参 `withSign` 未传，负数丢符号 | 传 `true` 并加 `balanceClass`（负值用支出色） |
| D2 | 深色下除首页外页面标题仍是黑色 | 4 个页面硬编码 `color="black"` | 走主题：`{{navBarColor}}` 或 `color="var(--text-color)"` |

---

## 五、必须避开的坑（含原因）

**小程序平台**
1. **`app.json` 的 `lazyCodeLoading: "requiredComponents"` 不能删** —— 删了之后本 IDE 版本不会编译非页面 TS 模块，整个 app 注册不起来（而 `cli preview` 仍会成功，极具迷惑性）。
2. **WXML 属性里别用裸布尔值** —— 裸写等于空字符串 = `false`；必须 `attr="{{true}}"`。
3. **`block` 是 WXML 保留字** —— 作为组件属性名会被忽略，需换实现路径（如 `custom-style`）。
4. **`wx:for` 不要直接写在自定义组件标签上** —— 可能不渲染，包一层 `<view>` 最稳。
5. **`usingComponents` 必须写在页面/组件 json 的该字段内** —— 位置错了组件静默不生效。
6. **金额一律用「分」存储** —— 元做浮点运算会出现 19.99×100 = 1998.9999 这类误差。

**Vant Weapp**
7. **它的 CSS 变量覆盖不完整** —— 多处颜色是硬编码（`#ebedf0`、`#fff` 等）。遇到"改了变量没效果"，直接去读 `miniprogram_npm/@vant/weapp/<组件>/index.wxss` 确认变量名或是否写死。
8. **变量名要抄准确** —— `--grid-item-content-background-color` ≠ `--grid-item-background-color`。
9. **组件内部节点无法从页面选择器命中** —— 但 **`custom-class` 外部类可用**，覆盖硬编码值的正确姿势是「外部类 + 伪元素/属性覆盖 + `!important`」。
10. **原生 `<button>` 默认 `margin:0 auto`** —— 在 flex 容器里会阻止拉伸，定宽必须带 `margin: 0`。

**自动化与调试**
11. **热编译有滞后** —— 改完组件的 WXML/WXSS 立刻验证会得到假阴性（我曾误判"组件没渲染"）。正确做法：`cli close --project` + `cli open --project` 触发全量重编译后再验证。
12. **automator 选不中自定义组件** —— 连必定渲染的 `navigation-bar` 都返回 0，别把 0 当"没渲染"；替代方案：`mp.evaluate` 里用 `wx.createSelectorQuery().boundingClientRect()`（能选中自定义组件）+ 像素分析。
13. **自动化桥不稳定** —— 偶发 `Cannot destructure property 'rawPath' of getPageMetaByWebviewId`、超时；脚本要带重试，动作要少而紧凑。
14. **不要反复强杀开发者工具** —— 我早期为了拿干净测试窗口反复 taskkill，直接导致使用者侧 IDE 闪退。用 `cli close/open` 或 `cli quit` 优雅退出。
15. **直接写 `wx.setStorageSync` 造数据会绕过 StorageService 内存缓存** —— 页面读不到；造数要走页面自身方法（`p.onContent()` + `p.onSubmit()`）。
16. **像素分析是可靠替代** —— `tools/ascii-crop.js`（区域字符图）、`row-profile.js`（逐行剖面）、`palette-scan.js`（按调色板定位）、`seam-check.js`（孤立亮线）。注意：文字抗锯齿会产生约 0.8% 的灰像素，别误判为背景或线条；判断背景色用"出现最多的颜色"而非单点采样。

**环境**
17. **开发者工具的「服务端口」必须开启**，否则自动化链路失效（端口 9420）。
18. **装完依赖必须执行「构建 npm」**，否则 `miniprogram_npm` 不生成、Vant 组件报找不到。
19. **文档与服务端配置**：接入 `wx.request` 前需在小程序后台配置域名白名单，且必须 HTTPS。

---

## 六、需要注意的事项

- **主题机制是双轨的**：3 个页面（首页 / 记账编辑 / 记事列表）走 `utils/theme.ts` 的 JS 内联变量 + `wx.onThemeChange`；另外 3 页走 `app.wxss` 的 CSS 变量 + `@media (prefers-color-scheme: dark)` 兜底。**改配色要同时改 `utils/theme.ts`、`app.wxss`、`theme.json` 三处**，否则会出现页面间不一致。
- **`theme.json` 的 tabBar 颜色不跟随模拟器强制深色**（它取系统主题），做深色验证时别把它当 bug。
- **自动化深色验证技巧**：临时把 `buildThemeStyle(isDark)` 强制为 `true` 并把媒体查询反转，截图量测后自动还原（`tools/dark-verify.js force|restore`）。
- 自有组件（`empty-state` / `ledger-card` / `note-item`）的样式依赖 `app.wxss` 里的令牌（`--space-*` / `--radius-*` / `--font-*`），这些令牌是全局的，改动会影响所有页面。
- 按钮宽度目前**不统一**：记事编辑页为 80%（使用者选择），记账编辑与个人中心为 100%（`custom-style` 控制）。
- 列表目前**全量读取 + 内存缓存**，无分页；数据量大时需要加触底加载。
- 我（AI）为验证造的临时数据统一用 `tag: '样式验证'`，脚本会按此清理；**不会动使用者自己的数据**。

---

## 七、下一步待办

1. **云开发接入**：`service/request.ts` 待实现；业务 service 已按抽象分层，替换内部实现即可上云，页面层无需改动。
2. **真机验证**：iOS / Android 各测一遍（Skyline 在真机的表现、深色模式、键盘遮挡）。
3. **发布前检查**：隐私协议、域名白名单、包体积（当前 123 KB，余量充足）、sitemap。
4. 可选优化：列表分页 / 虚拟列表、tabBar 图标替换为设计稿、结算页（收入-支出按标签统计）、Vant `dialog` 替代原生 `showModal`。
5. 文档描述与实现的一处差异：`TASK` 原文写"summary 返回元"，实现统一为「分」，展示层格式化。

---

## 八、可用工具速查（`WorkBuddy/…/tools/`）

| 脚本 | 用途 |
|---|---|
| `run-jest.js` | 运行单元测试并落盘输出 |
| `reopen-project.js` | `cli close` + `cli open`，触发全量重编译 |
| `vant-final.js` | 逐页截图 + 指标统计 |
| `ascii-crop.js` / `row-profile.js` | 截图的字符化 / 逐行剖面（判读布局） |
| `palette-scan.js` / `seam-check.js` / `seam-scan.js` | 按调色板定位元素 / 孤立亮线检测 / 逐行颜色 dump |
| `measure-rects.js` | 用 `wx.createSelectorQuery` 量元素精确矩形 |
| `dark-verify.js` | 强制深色（含自动还原）以验证深色主题 |
| `probe-with-data.js` | 造临时数据并截图，可 `clean` 清理 |
| `gen-icons2.js` / `icon-preview.js` | 生成线性 tabBar 图标 / ASCII 自查形状 |
