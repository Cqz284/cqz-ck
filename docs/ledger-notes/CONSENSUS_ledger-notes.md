# CONSENSUS - 记事记账小程序基础版

| 项 | 值 |
|---|---|
| 任务名 | ledger-notes（记事记账基础版） |
| 创建日期 | 2026-09-16 |
| 当前阶段 | Align 输出（待进入 Architect） |
| 负责人 | AI 架构师 |
| 上游文档 | [ALIGNMENT_ledger-notes.md](./ALIGNMENT_ledger-notes.md) |

---

## 0. 修订记录（v2，2026-09-16 评审后）

依据 `REVIEW_ledger-notes.md` 评审结果修订。以下决策**覆盖**后文对应内容：

| # | 修订项 | 修订后决策 |
|---|---|---|
| R-01 | 数据存储 | **基础版纯本地 Storage**；云开发/云备份/账号列为下一期目标。service 层抽象保持不变，后续仅替换内部实现即可上云 |
| R-02 | 深色模式 | `theme.json` **仅**用于 tabBar 的 `@变量`；业务 UI 的 CSS 变量定义在 `app.wxss`，用 `@media (prefers-color-scheme: dark)` 切换（原方案 WXSS 取不到 theme.json 变量，会整体失效） |
| R-03 | Storage 防抖 | **取消读防抖**，改为内存缓存；防抖只用于搜索输入（300ms）与高频写入 |
| R-04 | TS 迁移 | 先删除/重命名旧 `app.js`、`pages/index/index.js` 等 .js 文件，避免与同名 .ts 冲突 |
| R-05 | npm 构建 | 增加「构建 npm」步骤；`packNpmRelationList` 用新版字段 `packageJsonPath` + `miniprogramNpmDistDir` |
| R-06 | 依赖 | 不单独安装 `mobx`，仅装 `mobx-miniprogram` + `mobx-miniprogram-bindings`，避免双实例 |
| R-07 | 测试环境 | 新增 `jest.setup.js` 注入 `global.wx` mock（`miniprogram-api-typings` 仅提供类型，不提供运行时） |
| R-08 | 金额单位 | 内部统一「分」整数存储，仅展示层格式化为元；转换用 `toFixed(0)` 规避浮点误差 |
| R-09 | tabBar 资源 | 需准备 4 tab × 2 态 × 2 主题 = 16 个 81×81 png 图标 |
| R-10 | 任务粒度 | 27 个原子任务压缩为 14 个，先端到端跑通再补关键单测 |

---

## 1. 已确认决策（用户审批结果）

| 决策项 | 选择 | 影响范围 |
|---|---|---|
| 渲染引擎 | 切换为 WebView，移除 Skyline 配置 | app.json / 全部页面 |
| 组件库 | 完整使用 Vant Weapp（@vant/weapp） | 全部页面 UI |
| 状态管理 | mobx-miniprogram + mobx-miniprogram-bindings | store 层 / 页面绑定 |
| 单元测试 | 仅 service/store 层 jest 测试 | tests/ 目录 |
| TypeScript | 启用 useCompilerPlugins: ['typescript'] | tsconfig.json / 全代码 |
| 日期处理 | dayjs（npm 构建） | utils/date.ts |
| 深色模式 | app.json `darkmode: true` + theme.json + CSS 变量 | 全局样式 |
| 本地存储 | wx.*StorageSync，分 key 持久化 | service/storage.ts |
| 请求封装 | service/request.ts 预留 Promise 化封装 | service 层（不实际调用） |

---

## 2. 需求描述（最终）

### 2.1 业务目标
开发一个微信小程序记事记账基础版，实现：
- 记账/记事的完整 CRUD
- 本地 Storage 持久化
- 月度统计与待办概览
- 深色模式适配
- 可直接在微信开发者工具运行
- 架构层面预留云存储、数据同步、统计图表、图片附件、分类管理等扩展能力

### 2.2 功能模块

#### 模块 A：首页仪表盘
- 展示本月收入/支出汇总、结余
- 展示待办记事数量（未完成）
- 提供记账/记事快捷跳转入口
- 页面预留插槽（slot）位置，后续可放图表/快捷卡片

#### 模块 B：记账模块
- 新增收支记录：金额、类型（收入/支出）、备注、日期、自定义标签
- 列表按时间倒序展示
- 单条记录支持编辑/删除
- 数据模型预留 `extra` 扩展字段
- **自定义标签基础版仅支持任意字符串输入；标签管理（CRUD、预设标签、颜色）为扩展预留，本期不实现**

#### 模块 C：记事模块
- 新增文本笔记
- 标记待办状态（普通笔记/待办）
- 待办支持勾选完成/未完成
- 列表支持关键词搜索、编辑、删除
- 区分待办与普通笔记视图

#### 模块 D：个人中心
- 基础设置入口
- 本地数据说明（存储位置、容量）
- 数据导出为文本（wx.setClipboardData 或文件下载）
- 预留云备份、账号、主题入口（按钮占位）
- **深色模式基础版跟随系统主题（app.json `darkmode: true`）；应用内手动切换为扩展预留，本期不实现**

---

## 3. 验收标准

### 3.1 功能验收
| 编号 | 验收点 | 验证方式 |
|---|---|---|
| F-01 | 首页正确显示本月收支汇总与待办数量 | 添加数据后回到首页，数据更新 |
| F-02 | 记账新增/编辑/删除可正常操作并持久化 | 退出小程序重进数据仍在 |
| F-03 | 记事新增/编辑/删除/搜索可正常操作 | 关键词搜索过滤正确 |
| F-04 | 待办勾选状态切换正确持久化 | 完成状态切换后重进保持 |
| F-05 | 个人中心数据导出生成文本 | 导出内容包含全部数据 |
| F-06 | 深色模式下界面文字、背景可读 | 系统切换深色后 UI 自适应 |
| F-07 | 个人中心"清空数据"必须二次确认 | 点击清空弹出 Dialog，确认后才执行 |

### 3.2 架构验收
| 编号 | 验收点 |
|---|---|
| A-01 | 渲染引擎切换为 WebView，移除 Skyline 配置后无编译错误 |
| A-02 | Vant Weapp 组件按需引入并正常渲染 |
| A-03 | TypeScript 编译通过，无 any 滥用 |
| A-04 | mobx-miniprogram store 正常驱动页面更新 |
| A-05 | service/store/pages/components 分层清晰，无循环依赖 |
| A-06 | 数据模型预留 `extra` 字段，types/models.ts 集中定义 |
| A-07 | service/request.ts 请求封装预留可复用 |
| A-08 | 深色模式通过 CSS 变量适配，新增页面无需额外处理 |
| A-09 | Storage 读取加防抖，列表/详情加载无明显卡顿 |

### 3.3 代码质量验收
| 编号 | 验收点 |
|---|---|
| Q-01 | service/store 层 jest 单元测试通过 |
| Q-02 | 所有公共函数含参数/返回值注释（5S 规范） |
| Q-03 | ESLint 通过 |
| Q-04 | 无硬编码敏感信息（如 API Key、AppSecret） |
| Q-05 | 文档（ALIGNMENT/CONSENSUS/DESIGN/TASK/ACCEPTANCE）完整可追溯 |

---

## 4. 技术方案与约束

### 4.1 渲染引擎迁移
- `app.json` 移除字段：`renderer`、`rendererOptions`
- 保留 `componentFramework: "glass-easel"`（与新组件框架兼容，Vant Weapp 支持）
- `navigationStyle` 保留 `custom`（自定义导航栏组件可复用）
- 自定义 navigation-bar 组件本身不依赖 Skyline，可保留

### 4.2 状态管理接入
- 安装：`mobx`、`mobx-miniprogram`、`mobx-miniprogram-bindings`
- store 层位置：`store/`
- store 文件按业务域拆分：`ledger.store.ts` / `notes.store.ts` / `settings.store.ts`
- 页面/组件通过 `mobx-miniprogram-bindings` 的 `storeBindings` 绑定

### 4.3 TypeScript 接入
- `project.config.json` 启用：`"useCompilerPlugins": ["typescript"]`
- 根目录新建 `tsconfig.json`
- 安装 `miniprogram-api-typings` 作为开发依赖
- `typings/` 目录扩展声明

### 4.4 Vant Weapp 接入
- `package.json` 依赖：`@vant/weapp`
- `project.config.json` 配置 `packNpmRelationList`：`[{ package: '/package.json', miniprogramNpmDistName: 'miniprogram_npm', miniprogramNpmPath: '/miniprogram_npm/' }]`
- 用微信开发者工具「构建 npm」生成 `miniprogram_npm/`
- 各页面 `usingComponents` 按需声明 Vant 组件
- `app.json` `style` 字段需设为 `"v2"`（已有）

### 4.5 dayjs 接入
- `package.json` 依赖：`dayjs`
- `utils/date.ts` 统一封装：格式化、相对时间、月份范围

### 4.6 深色模式接入
- `app.json` 新增 `"darkmode": true`、`"themeLocation": "theme.json"`
- 新建 `theme.json`：定义 light/dark 两套 CSS 变量
- `app.wxss` 使用 `var(--bg-color)` 等变量
- 各页面 wxss 复用全局变量，不写死颜色

### 4.7 Storage 与防抖
- `service/storage.ts` 封装：`get`、`set`、`remove`、`clear`
- 读操作加防抖（默认 200ms），写操作立即执行
- key 命名空间：`ledger:` / `notes:` / `settings:`
  - `ledger:records` → 记账记录数组
  - `notes:items` → 记事项数组
  - `settings:base` → 基础设置

### 4.8 请求封装预留
- `service/request.ts` 提供 `request<T>(options): Promise<T>` 接口
- 当前实现走本地 storage 模拟，后续接云函数/后端时仅需替换内部实现
- 业务 service（如 `ledger.service.ts`）依赖 `request` 抽象，不直接调用 wx API

### 4.9 数据模型类型定义
- `types/models.ts` 集中定义所有数据模型
- 每个模型包含 `id`、`createTime`、`updateTime`、`extra: Record<string, unknown>`
- 新增字段不破坏现有结构

### 4.10 代码分层
```
pages/         页面层（WXML/WXSS/TS）仅负责视图与交互
components/    基础组件层（无业务逻辑）
components/business/  业务组件层（含 store 绑定）
service/       业务层（数据读写、业务规则）
store/         状态层（mobx observable，跨页面共享）
utils/         工具层（date、debounce、export 等纯函数）
types/         类型层（数据模型、API 契约）
```

依赖方向：`pages → components → store → service → utils/types`，单向无循环。

---

## 5. 验收外的扩展预留位

| 预留点 | 位置 | 说明 |
|---|---|---|
| 云存储 | service/request.ts | 替换内部实现即可上云 |
| 数据同步 | store/*.store.ts | 增加 sync 方法不影响现有 |
| 统计图表 | 首页 slot | 预留 chart slot |
| 图片附件 | types/models.ts 的 extra 字段 | 数据结构已支持 |
| 分类管理 | types/models.ts 的 extra.categoryId | 数据结构已支持 |
| 主题切换 | 个人中心入口 | 按钮占位，深色模式已就绪 |
| 账号登录 | 个人中心入口 | 按钮占位 |
| 云备份 | 个人中心入口 | 按钮占位 |

---

## 6. 约束与风险

| 项 | 说明 |
|---|---|
| 微信基础库最低 3.0.0 | Vant/Skyline 已要求；切 WebView 后向下兼容更好 |
| Storage 单 key 1MB / 总 10MB | 数据分 key + 后续迁移云存储预案 |
| `miniprogram-api-typings` 版本对齐 | 与微信开发者工具基础库版本匹配 |
| Vant Weapp 自带 TS 类型 | 无需额外 @types |

---

## 7. 进入下一阶段

进入阶段 2 Architect，生成 `DESIGN_ledger-notes.md`：整体架构图、分层设计、核心组件、模块依赖图、接口契约、数据流向、异常处理策略。
