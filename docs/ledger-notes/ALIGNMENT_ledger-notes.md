# ALIGNMENT - 记事记账小程序基础版

| 项 | 值 |
|---|---|
| 任务名 | ledger-notes（记事记账基础版） |
| 创建日期 | 2026-09-16 |
| 当前阶段 | Align（对齐阶段） |
| 负责人 | AI 架构师 |

---

## 1. 原始需求（用户原文摘要）

开发微信小程序：记事记账小程序（基础版，预留扩展能力）。

### 1.1 基础落地功能
1. **首页仪表盘**：本月收支汇总、待办记事数量；记账/记事快捷入口；预留插槽。
2. **记账模块**：新增收支记录（金额、收支类型、备注、日期、自定义标签）；列表按时间倒序；单条编辑/删除；数据模型预留扩展字段。
3. **记事模块**：文本笔记；待办勾选（完成/未完成）；关键词搜索；编辑/删除；区分待办/普通笔记。
4. **个人中心**：基础设置；本地数据说明；数据导出文本；预留云备份/账号/主题入口。

### 1.2 业务规则
- 当前版本数据全部保存在小程序本地 Storage，无需登录。
- 记账分为收入/支出两类。
- 记事支持待办状态。

### 1.3 扩展预留
- 页面结构、数据结构不固化，预留字段与页面位置，便于后续云存储、数据同步、统计图表、图片附件、分类管理。

### 1.4 技术诉求
- **后端 API**：本期不接入；代码层面预留请求封装。
- **状态管理**：引入 pinia 作为全局状态管理。
- **日期处理**：引入 dayjs。
- **TypeScript**：使用 TS 开发。
- **组件库**：选用 Vant Weapp。
- **组件分离**：业务组件与基础组件分离。
- **深色模式**：适配微信小程序深色模式。
- **防抖**：本地数据读取加防抖。
- **代码分层**：页面层 / 组件层 / service 业务层 / store 状态层。
- **类型定义**：数据模型单独抽离。
- **注释**：函数注释包含参数说明、返回值说明。

### 1.5 验收目标
完成基础版，实现记账/记事 CRUD 与基础统计，可直接在微信开发者工具运行；架构预留扩展能力。

---

## 2. 项目上下文分析

### 2.1 现有项目结构
```
miniprogram-1/
├── app.js                    # 空壳 App({})
├── app.json                  # Skyline + glass-easel 配置
├── app.wxss                  # 仅 .container 通用样式
├── sitemap.json              # 全站允许索引
├── project.config.json       # AppID: wxf3ec012ce512ea29
├── project.private.config.json
├── .eslintrc.js              # 含 wx/App/Page/Component 全局
├── components/
│   └── navigation-bar/       # Skyline 自定义导航栏（可复用）
└── pages/
    └── index/                # 空壳 Page({})
```

### 2.2 技术栈现状
- **渲染引擎**：Skyline（`renderer: skyline`）
- **组件框架**：glass-easel
- **基础库范围**：3.0.0 ~ 15.255.255
- **导航样式**：custom（自定义导航栏）
- **样式版本**：v2
- **懒加载**：requiredComponents
- **NPM 构建**：未启用（`packNpmRelationList: []`）
- **编译插件**：未启用（`useCompilerPlugins: false`）
- **业务代码**：无（纯模板）

### 2.3 约束与冲突
现有项目配置了 **Skyline 渲染引擎**，但用户期望使用 **Vant Weapp 组件库**。二者存在已知兼容性问题，需在 Align 阶段决策。

---

## 3. 需求理解

### 3.1 功能模块拆解
| 模块 | 核心能力 | 数据存储 |
|---|---|---|
| 首页仪表盘 | 月度汇总 + 快捷入口 + 插槽 | 只读汇总 |
| 记账 | 收支记录 CRUD + 自定义标签 | ledger:records |
| 记事 | 笔记 CRUD + 待办状态 + 搜索 | notes:items |
| 个人中心 | 设置 + 数据说明 + 导出 | settings |

### 3.2 数据模型抽象
- `LedgerRecord`：金额、类型(收入/支出)、标签、备注、日期、createTime、updateTime、扩展字段 `extra`
- `NoteItem`：内容、类型(待办/普通)、完成状态、createTime、updateTime、扩展字段 `extra`
- 所有模型预留 `extra: Record<string, any>` 字段应对未来扩展。

---

## 4. 边界确认 Scope

### 4.1 In Scope（基础版必做）
- 4 个核心页面（首页/记账/记事/个人中心）
- 记账/记事完整 CRUD
- 本地 Storage 持久化
- TypeScript + Vant Weapp + dayjs 集成
- 全局状态管理
- 深色模式适配
- service/store/页面/组件分层
- 请求封装预留（无实际调用）
- 数据模型类型定义
- 防抖优化

### 4.2 Out of Scope（扩展预留，本期不做）
- 真实后端 API 对接
- 云存储/数据同步
- 账号登录
- 统计图表（仅留插槽位置）
- 图片附件
- 分类管理（仅留数据字段）
- 主题切换（仅留入口位置）
- 云备份（仅留入口位置）

---

## 5. 关键技术决策点（待用户确认）

### 5.1 【冲突1】Skyline 与 Vant Weapp 兼容性
- **现状**：项目已配置 Skyline 渲染引擎。
- **冲突**：Vant Weapp 官方主要适配 WebView 渲染引擎，对 Skyline 支持不完整。部分组件（如 Toast、Dialog、Popup）在 Skyline 下可能样式异常或行为不符合预期。
- **影响面**：所有页面 UI 渲染。
- **可选方案**：
  - A：切换为 WebView 渲染引擎，完整使用 Vant Weapp（开发效率高，性能略降）
  - B：保留 Skyline，自行封装基础组件（不用 Vant，性能最优，工作量大）
  - C：保留 Skyline 为主，仅在必要页面降级为 WebView 渲染（架构复杂，不推荐）

### 5.2 【冲突2】Pinia 在微信小程序不可用
- **现状**：用户期望使用 Pinia。
- **冲突**：Pinia 强依赖 Vue 的响应式系统（reactive/ref/computed），微信小程序运行时无 Vue，**无法直接使用**。
- **影响面**：全局状态层架构。
- **可选方案**：
  - A：改用 `mobx-miniprogram` + `mobx-miniprogram-bindings`（微信官方推荐，observable 风格与 Pinia 思想接近，迁移成本低）
  - B：自行实现轻量 store 模式（无第三方依赖，类 Pinia API 风格，可控性最高）
  - C：使用 `miniprogram-state` 等社区方案（小众，长期维护风险）

### 5.3 【决策3】单元测试方案
- **背景**：5S 规则强制要求"接口文档 -> 单元测试 -> 功能实现"流程。
- **冲突**：微信小程序单元测试需引入 `miniprogram-simulator` 框架，对纯逻辑层可用 `jest`。
- **影响面**：开发流程与交付物。
- **可选方案**：
  - A：service/store 层使用 jest 单测 + 页面层用 miniprogram-simulator 组件测试（最完整，符合 5S）
  - B：仅对 service/store 层纯 JS 逻辑做 jest 测试（轻量，平衡效率与规范）
  - C：暂不写单测，仅做功能验收（违背 5S 规则，不推荐）

---

## 6. 其他已自动决策的事项

| 项 | 决策 | 依据 |
|---|---|---|
| TS 配置 | 启用 useCompilerPlugins: ['typescript'] + tsconfig.json | 小程序原生 TS 方案 |
| Vant Weapp 接入 | npm 安装 + 构建npm + 按需引入 | Vant 官方文档 |
| dayjs 接入 | npm 安装 + 构建npm | dayjs 兼容小程序 |
| 深色模式 | app.json `darkmode: true` + theme.json + CSS 变量 | 微信官方深色模式方案 |
| Storage 分 key | ledger / notes / settings 独立 key | 单 key 1MB 限制 |
| 请求封装 | service 层 `request.ts` 预留 Promise 化封装 | 后续接云函数复用 |
| 数据模型 | `types/models.ts` 集中定义，预留 `extra` 字段 | 扩展性 |

---

## 7. 风险与约束

| 风险 | 应对 |
|---|---|
| Skyline + Vant 兼容隐患 | 待用户决策后选择对应路径 |
| Storage 10MB 总量上限 | 数据分 key + 后续迁移云存储预案 |
| TS + Vant 类型匹配 | 安装 @vant/weapp 自带 d.ts |
| 基础库 3.0.0 最低版本 | 已满足 Vant/Skyline 要求 |

---

## 8. 待用户确认问题清单

1. Skyline 与 Vant Weapp 冲突如何处理？（5.1）
2. Pinia 不可用，状态管理替代方案选哪个？（5.2）
3. 单元测试方案选哪个？（5.3）

---

## 9. 下一步

收到用户答复后，生成 `CONSENSUS_ledger-notes.md`，进入阶段 2 Architect。
