# 代码评审报告（ledger-notes）

> 评审对象：工作区 `D:\WeChatProjects\miniprogram-1` 全量源码（34 个 `.ts` / 10 个 `.wxml` / 11 个 `.wxss` / 全部 json 配置）
> 评审方式：逐文件静态阅读 + 工具验证（`tsc` 类型检查、`jest` 全量测试、目录体积统计）
> 结论：功能实现与分层设计是扎实的，**但存在 2 个必须立刻处理的问题**，以及若干会在数据量增大 / 接入云开发时集中爆发的隐患。

## 0. 验证记录（可复现）

| 验证项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `tsc --noEmit -p tsconfig.json` | **失败，2 个错误**（均在 `pages/notes/list/index.ts`） |
| 单元测试 | `jest --ci` | 通过，6 套件 / 41 用例 |
| 目录体积 | 递归统计 | `clean/` = **123.12 MB / 1274 文件**（异常） |
| 依赖一致性 | 比对 `package.json` 与实际安装 | **`typescript` 声明 `^7.0.2`，实际安装 `5.6.3`**（不一致） |

---

## 1. P0 — 阻断级（建议今天就修）

### P0-1 `pages/notes/list/index.ts` 遗留 `console.log` 引用未定义变量，页面生命周期直接抛错

```ts
// pages/notes/list/index.ts:57-61
this.setData({ /* ... */ });

console.log('theme changed, isDark =', isDark);
console.log('pageStyle =', pageStyle);   // ← 未定义标识符
console.log('pageBg =', pageBg);         // ← 未定义标识符
```

`pageStyle` / `pageBg` 是 `this.data` 的字段，这里却当成裸变量引用。`tsc` 实测报错：

```
pages/notes/list/index.ts(59,32): error TS2304: Cannot find name 'pageStyle'.
pages/notes/list/index.ts(60,29): error TS2552: Cannot find name 'pageBg'. Did you mean 'Page'?
```

**为什么没被拦住**：开发者工具用的是 typescript 编译插件，只做逐文件转译、不做类型检查；项目又没有 `typecheck` 脚本（见 P1-8），所以带错的 JS 照常打包。

**实际影响链**：
1. `onLoad()` 里 `this.setTheme()`（第 27 行）在抛错处中断 → **第 29-34 行的 `wx.onThemeChange` 注册代码永远不会执行**，记事列表页成为唯一不跟随系统主题切换的页面，除非重启小程序。
2. `onShow()`（第 45 行）每次调用都抛 `ReferenceError` → 控制台持续报错。
3. 三条调试日志属于遗留代码，不应出现在产物里。

**修复**：直接删掉这三行 `console.log`。若确实需要日志，改为 `this.data.pageStyle` 并收敛到统一 logger。

### P0-2 项目根目录混入 123 MB 的 npm 缓存目录 `clean/`

- `D:\WeChatProjects\miniprogram-1\clean\` = **1274 个文件 / 123.12 MB**，内含 `_cacache/`（npm 缓存内容寻址存储）与 `_logs/`（npm debug 日志）。
- 这显然是一次 `npm install --cache ./clean` 之类操作把缓存写进了工程根目录，属于误产物。
- 项目**没有 `.gitignore`**（已确认缺失），因此该目录连同 `node_modules`（69.70 MB）都在版本管理与备份范围内。
- `project.config.json` 的 `packOptions.ignore` 为空数组，存在被开发者工具纳入打包范围的风险（会直接顶穿 2 MB 主包上限）。

**修复**：确认无脚本依赖后删除该目录；补齐 `.gitignore`（至少 `node_modules/`、`miniprogram_npm/`、`clean/`、`*.log`）；按需把无关目录写进 `packOptions.ignore`。

---

## 2. P1 — 高（影响正确性 / 可维护性）

### P1-1 `wx.offThemeChange()` 无参调用，会注销**所有**页面的主题监听

3 处调用均未传 handler：

```
pages/index/index.ts:41        wx.offThemeChange();
pages/ledger/edit/index.ts:64  wx.offThemeChange();
pages/notes/list/index.ts:39   wx.offThemeChange();
```

小程序类型声明的原文是：**"onThemeChange 传入的监听函数。不传此参数则移除所有监听函数。"** 即任一页面 `onUnload` 都会把其他页面的监听一起干掉。

同时方向上也反了：`onThemeChange` 的注册在 `onLoad`，注销在 `onUnload`——但首页 / 记事列表是 tabBar 页，**几乎不会触发 `onUnload`**，所以是"该注销的不注销、注销时误伤别人"。

**修复**：把 handler 存成实例字段，按引用注销：
```ts
this.themeHandler = () => this.setTheme();
wx.onThemeChange(this.themeHandler);
// onUnload
if (this.themeHandler) { wx.offThemeChange(this.themeHandler); this.themeHandler = null; }
```
更彻底的做法是把主题逻辑抽成 Behavior / 公共 Page mixin，六页共用一份。

### P1-2 `ledger-card` 的 observer 没有真正监听 `currency`，货币设置是"半接线"状态

```ts
// components/business/ledger-card/index.ts:18-33
observers: {
  record(record: LedgerRecord, currency: string) {   // ← key 只有 record
    ...
    amountText: (isIncome ? '+' : '-') + formatMoney(record.amount, currency),
  },
},
```
微信 `observers` 的 key 才是"被监听的字段列表"，回调收到的是**这些字段的新值**。key 写成 `record`，只监听 `record`，第二个参数拿不到 `currency` 的当前值（实际为 `undefined`，靠 `formatMoney` 的默认参数 `'¥'` 兜住）。

**影响**：`<ledger-card currency="{{ currency }}">` 这个传参是失效的——父级货币符号变化不会触发重算。

**修复**：`observers: { 'record, currency'(record, currency) { ... } }`。

### P1-3 货币符号只在一半地方生效

- `utils/theme.ts` / 首页 / 列表 / 导出都走 `settingsStore.settings.currency`；
- 但 **`pages/ledger/edit/index.wxml:13` 把 `¥` 写死在模板里**：
  ```html
  <text class="amount-box__symbol ...">¥</text>
  ```
- 结果是：一旦用户把货币符号改成 `$`，编辑页仍显示 `¥`，与列表/首页/导出不一致。

**修复**：模板改用 `{{ currency }}`，并把 `settingsStore` 绑到该页。

### P1-4 导出文本的"结余"丢负号（WORKLOG 已修过的同类 bug，导出路径漏了）

```ts
// utils/export.ts:23
lines.push('本月(' + month + ') 结余：' + formatMoney(s.balance, currency));
```
`formatMoney` 默认 `withSign = false`，内部又对金额取 `Math.abs`，所以**支出大于收入时，导出的结余会显示成正数**。这正是 WORKLOG 第四节 D1 记录过、并且在页面层修好的问题，但导出函数当时没同步。

**修复**：`formatMoney(s.balance, currency, true)`。

### P1-5 业务层完全没有入参校验，脏数据可以落库

- `LedgerService.create/update` 直接 `toFen(input.amount)`，不做任何检查。
- `toFen(NaN)` 会**静默返回 `NaN`**（`NaN.toFixed(2)` → `"NaN"` → `Number("NaN")` → `NaN`）。
- 后续展示时 `formatMoney(NaN)` 会渲染出 **`¥NaN.undefined`**（`NaN.toFixed(2).split('.')` 长度为 1，`parts[1]` 为 `undefined`）。
- 唯一的防线是页面层的 `isValidAmount`，绕开页面直接调 service（测试、未来的云同步、批量导入）即可写入脏数据。
- 另外 `isValidAmount` **没有上限**：`/^\d+(\.\d{1,2})?$/` 允许 `99999999999999`，前端会渲染成超长数字并击穿布局。

**修复**：在 service 层加 `assert`（有限数、> 0、两位小数、上限如 1e10 分），并在 `toFen` 里对非法输入直接抛错而非返回 `NaN`。

### P1-6 `StorageService` 的缓存一致性：先写缓存再落盘，且 `get` 返回内部引用

```ts
// service/storage.ts:74-82
static set(key, value) {
  cache.set(key, value);          // ① 先改缓存
  try { wx.setStorageSync(key, value); }
  catch (err) { throw new StorageError(...); }   // ② 落盘失败，缓存已被污染
}
```
落盘失败抛错，但缓存已经更新 → **内存与磁盘不一致**，且后续读操作会一直读到那个"写失败的值"。

同时 `get` 返回的是缓存中的**同一个对象引用**，而 `LedgerService.create` 直接对它做原地修改：
```ts
// service/ledger.service.ts:57-59
const all = StorageService.get(StorageKeys.LedgerRecords) ?? [];
all.unshift(record);              // ← 直接改了缓存里的数组
StorageService.set(StorageKeys.LedgerRecords, all);
```
这使得"缓存"实际上成了可变共享状态，任何调用方的误改都会穿透到全局。

**修复**：`set` 改为"先落盘成功再更新缓存"，失败时不动缓存；`get` 返回深/浅拷贝，service 内部改为不可变更新（`[record, ...all]`）。

### P1-7 手写的 ambient 类型声明把 `mobx` 全家退化成了 `any`

`typings/index.d.ts` 为 `mobx-miniprogram` 和 `mobx-miniprogram-bindings` 手写了 `declare module`，并把 `observable` / `action` / `createStoreBindings` 等**全部标注为 `any`**：

```ts
declare module 'mobx-miniprogram' {
  export const observable: any;
  export const action: any;
  ...
}
```
但这两个包**本身自带 `.d.ts`**（`node_modules/mobx-miniprogram-bindings/types/` 确实存在）。本地 ambient 声明优先于包的 `types` 字段，等于**主动关掉了类型检查**。

后果直接体现在代码里：`store/*.ts` 里 15 处 `function (this: any)`、页面里 `(this as any).bindings`、`(r: any)`、`items: [] as any[]` 遍地——observable 的字段拼错、action 签名不匹配，编译器都不会报。

**修复**：删除 `typings/index.d.ts` 中这两个 `declare module`，改用包自带类型；若确需补充，只补缺失的成员而不是整体 `any`。

### P1-8 没有 lint、没有类型检查脚本，这是上面几个 bug 漏过的根本原因

- `package.json` 只有 `test` / `test:watch`，**没有 `typecheck`、没有 `lint`**。
- `.eslintrc.js` 里 `extends: 'eslint:recommended'` 被注释掉、`rules: {}`、且**没有配 `@typescript-eslint` parser**——等于完全没有在 lint TypeScript。

**修复**：
1. 加 `"typecheck": "tsc --noEmit"`，并在 `test` 前串上；
2. 装 `@typescript-eslint/parser` + `plugin`，打开 `no-undef` / `no-unused-vars` / `no-console`（P0-1 用 `no-undef` 一跑就现形）；
3. 补 `.gitignore`，条件允许时接一个 pre-commit 钩子。

### P1-9 `package.json` 依赖声明与实际安装不一致，环境不可复现

| 依赖 | 声明 | 实际安装 |
|---|---|---|
| `typescript` | `^7.0.2` | **5.6.3** |

`ts-jest@29` 官方支持范围是 TypeScript 5.x。按当前 `package.json` 在新机器上 `npm install` 会拉 TS 7，存在与 `ts-jest` 不兼容、进而 `npm test` 全挂的风险。建议把 `typescript` 锁到实际可用的 `~5.6.3`，并提交 `package-lock.json` 保证一致。

---

## 3. P2 — 中（性能与设计债，数据量上来会集中爆发）

### P2-1 `clearAll()` 是 O(n²) 次 Storage 写入

```ts
// store/ledger.store.ts:67-70（notes.store.ts:88-91 同构）
clearAll: action(function (this: any) {
  this.records.forEach((r) => LedgerService.remove(r.id));   // 每条都全量读+filter+全量写
  this.records = [];
}),
```
`LedgerService.remove` 每次都要读全量数组、过滤、再写回。清空 1000 条 = 1000 次全量落盘。应改为一次 `StorageService.set(key, [])`。

### P2-2 首页/列表的汇总逻辑重复两份，且每次访问都重算全表

- `ledgerStore.monthSummary` / `monthCount` 用 `monthOf(r.date)`（**每条记录一次 dayjs 解析**）遍历全量；
- `LedgerService.summary(month)` 是**同一套业务逻辑的第二份实现**；
- 首页 `onShow` + `refresh()` + mobx 响应式会多次触发，等于同一份计算跑好几遍。

建议：store 里改存派生值（写入时增量维护），或至少让 store 复用 `LedgerService.summary`，并预解析日期避免逐条 dayjs。

### P2-3 页面绑定了自己用不到的 store 字段 → 多余的 setData 全量推送

```ts
// pages/ledger/list/index.ts:37
createStoreBindings(this, { store: ledgerStore, fields: ['records', 'monthSummary'] }),
```
但该页 WXML 只用 `groups` / `incomeText` 等，**从未渲染 `records` / `monthSummary`**。于是每次记录变更都会把**整个记录数组**再 setData 一遍，白付一次大对象传输 + diff 开销。首页同样绑了 `records` / `monthSummary` / `pendingCount` / `settings` 四个字段，却又在 `refresh()` 里手工算了一遍字符串——**两条并行的响应式路径**，是后续"数据改了但界面没变/变两次"类 bug 的温床。

建议：绑定字段与 WXML 实际消费的字段严格对齐，统一走一条响应式路径。

### P2-4 列表全量渲染，无分页 / 无虚拟列表

`groups` 一次性把全部记录（含 `items` 数组）拼好 setData。这是当前**最大的体验瓶颈**：几百条记录时尚可，上千条时首屏与滑动都会明显卡顿。WORKLOG 已把它列为待办，建议提前排期（`recycle-view` 或触底分页）。

### P2-5 项目里有 `debounce` 却没人用，记事列表自己手搓了一个（还没清理）

```ts
// pages/notes/list/index.ts:75-82
if ((this as any).searchTimer) clearTimeout((this as any).searchTimer);
(this as any).searchTimer = setTimeout(() => { ... }, 300);
```
- `utils/debounce.ts` 的 `debounce` 在生产代码里 **0 引用**；
- 手写的这个 `searchTimer` **没有在 `onUnload` 里清理**，页面卸载后仍会 `setData`（触发"页面上不存在该数据"类告警）。

### P2-6 死代码：若干工具函数只被测试"养着"

以下导出在生产代码中零引用，仅出现在 `tests/` 中：

| 符号 | 位置 | 建议 |
|---|---|---|
| `throttle` | `utils/debounce.ts:28` | 删除或用起来 |
| `debounce` | `utils/debounce.ts:11` | 用于 P2-5 |
| `monthRange` | `utils/date.ts:51` | 删除（`summary` 已按字符串过滤月份，不需要时间戳区间） |
| `isCurrentMonth` | `utils/date.ts:62` | 删除 |
| `colorsOf` | `utils/theme.ts:80` | 删除或统一到 `buildThemeStyle` 内部 |

"为测试而存在"的代码会误导后续维护者以为它被使用。`colorsOf` 还额外用了已废弃的 `wx.getSystemInfoSync`。

### P2-7 `wx.getSystemInfoSync()` 仍在 5 处使用，且注释与代码自相矛盾

```
app.ts:2                      // 修复 wx.getSystemInfoSync 弃用告警：按需取窗口信息   ← 注释这么说
app.ts:12                     const theme = (wx.getSystemInfoSync() as any).theme;  ← 代码还在用
utils/theme.ts:81             const t = theme || (wx.getSystemInfoSync() as any).theme || ...
pages/index/index.ts:52       const isDark = (wx.getSystemInfoSync() as any).theme === 'dark';
pages/ledger/edit/index.ts:73  同上
pages/notes/list/index.ts:49   同上
```
`components/navigation-bar/navigation-bar.ts:54-57` 已经正确改用了 `wx.getDeviceInfo()` / `wx.getWindowInfo()`，说明只是没同步回去。建议统一收敛到一个 `getIsDark()` 工具（`wx.getAppBaseInfo().theme`），顺便消掉 5 处重复。

### P2-8 提交后 `setTimeout` 不清理，可能多退一层页面

```ts
// pages/ledger/edit/index.ts:118、pages/notes/edit/index.ts:74
setTimeout(() => wx.navigateBack(), 500);
```
若用户在这 500ms 内自己按了返回，定时器仍会再执行一次 `navigateBack` → **多退一层**。应保存 timer id 并在 `onUnload` 清理。

### P2-9 `onSubmit` 没有异常兜底

两处 `onSubmit` 都直接 `store.edit()/add()` 后立刻 `showToast('已保存')`，没有 try/catch。service 抛错（如 `update` 找不到记录 `throw new Error`）时，用户既看不到成功也看不到失败，表现为"点了保存没反应"，且 toast 与导航都不会执行。

### P2-10 编辑页表单校验不完整

- `ledger/edit` 的 `onSubmit` **不校验 `date` 是否为空**（若 `picker` 未触发，`date` 为空串也会入库）；
- 「标签」输入框**没有 `maxlength`**（备注有 200，标签没有），记事内容的 2000 也是前端唯一约束；
- 常用标签里 `工资` 属于收入语义，却在支出模式下同样展示。

### P2-11 设置默认值有两份，且 `get()` 是浅拷贝会污染默认值

```ts
// store/settings.store.ts:10       手写了一份默认值
settings: { currency: '¥', extra: {} } as BaseSettings,
// service/settings.service.ts:8     这里又定义了一份 DEFAULT_SETTINGS
export const DEFAULT_SETTINGS: BaseSettings = { currency: '¥', extra: {} };
```
且 service 里三处 `{ ...DEFAULT_SETTINGS }` 都是**浅拷贝**，`extra` 与常量共享同一引用——调用方一旦改 `settings.extra.xxx`，会污染全局默认值。应复用常量并深拷贝（`{ ...DEFAULT_SETTINGS, extra: {} }`）。

### P2-12 主题三处真相源已经开始漂移

主题色同时存在于 `utils/theme.ts`、`app.wxss`、`theme.json`，需要人工同步，实测已经出现不一致：

| 漂移点 | 详情 |
|---|---|
| `app.wxss` 深色块 | **漏了 `--primary`**（靠浅色同值 `#34be8c` 侥幸正确，一旦将来分主题配色就会静默失效） |
| `theme.json` | 深色 `bgColor: "#1a1a1a"` 与 `pageBg: "#171512"` 不一致；浅色 `textPrimary: "#333333"` 与令牌 `#2e2a26` 不一致 |
| `theme.json` 死配置 | `pageBg` / `cardBg` / `textPrimary` / `bgColor` / `bgTxtStyle` 这 5 个键 **在 `app.json` 中从未被引用** |

建议：至少加一条"三处一致性"的测试（读三份文件比对关键色值），把人工同步变成机器校验。

### P2-13 文档与实现的已知差异（补记）

WORKLOG 第五节第 5 条记了 `TASK` 写"summary 返回元"、实现用「分」。本次评审未发现新的功能性文档偏差，但上面 P1-3 / P1-4 属于**同类偏差**（货币符号与负号在部分路径未落地），建议合并进同一批修复。

---

## 4. P3 — 低（清洁度 / 一致性）

### P3-1 样式大量重复，且已有数值不一致

| 重复内容 | 位置 | 备注 |
|---|---|---|
| `.page` | 6 份，每页一份 | 仅 `padding-bottom` 不同 |
| `.summary*`（约 40 行） | `pages/index/index.wxss:9-58` 与 `pages/ledger/list/index.wxss:9-68` | 几乎逐字重复 |
| `.segment__pill` | `ledger/edit` 与 `notes/edit` | 仅选中态类名不同 |
| `.swipe-del` | `ledger/list` 与 `notes/list` | **宽度 130 vs 140、min-height 136 vs 140 已不一致** |
| `.row-divider` | profile / ledger-edit / notes-edit | 3 份 |
| `.van-*` 覆盖（含 `!important`） | 页面 wxss 内 | 依赖 Vant 的 `addGlobalClass`，脆弱 |

建议把共用块上提到 `app.wxss`（或用 `@import` 抽公共样式文件），`.swipe-del` 的宽度与 `van-swipe-cell` 的 `right-width` 应绑同一个变量，避免再次对不上。

### P3-2 模板里硬编码布局值与货币符号

```html
<!-- pages/ledger/edit/index.wxml:14 -->
<input style="height: 56rpx; display: block; box-sizing: border-box" .../>
```
`56rpx` 正好等于 `app.wxss` 里的 `--font-amount-input: 56rpx`，但这里绕过了令牌直接写内联样式；按钮宽度也是 `custom-style="width: 80%;"`（记事编辑）与 `width: 100%;`（记账编辑 / 个人中心）混用，WORKLOG 已记录，建议统一。

### P3-3 遗留手改痕迹

```css
/* pages/ledger/list/index.wxss:80-81 */
/* 新增圆角 */
border-radius:30rpx;
```
`30rpx` 不在 `--radius-*` 令牌体系内，注释也是过程性留言。同类还有 `pages/notes/list/index.wxss:12-16` 那个把 `background` 设成和上面完全相同的空操作媒体查询。

### P3-4 导出模块用字符串字面量代替枚举

```ts
// utils/export.ts:27、33
const sign = r.type === 'income' ? '+' : '-';
const prefix = n.kind === 'todo' ? (n.done ? '[已完成]' : '[待办]') : '[笔记]';
```
应使用 `LedgerType.Income` / `NoteKind.Todo`。现在若有人改动枚举取值，这里不会报编译错，只会静默输出错误结果。

### P3-5 `uid()` 的随机部分长度不固定

```ts
// utils/id.ts:11
const randPart = Math.random().toString(36).slice(2, 10);
```
`Math.random().toString(36)` 的结果长度不定（如 `0.5` → `"0.i"`，切出来只有 1 位），且没有同毫秒计数器兜底。当前 1000 次抽样不重复，但属于"测试通过≠安全"。建议补一个自增序列或改用 `wx.getRandomValues` 风格更强的随机源。

### P3-6 测试存在恒真断言与覆盖盲区

```ts
// tests/store/stores.test.ts:34
expect(notesStore.pendingCount).toBeGreaterThanOrEqual(0);   // pendingCount 恒 >= 0，永远通过
```
- 该断言（第 32 行同款）**没有任何验证价值**，会让"功能坏了"的情况仍然绿灯；
- 未覆盖：`fromNow`（含 P2-x 提到的"26 小时显示昨天"边界）、`utils/theme.ts`、`StorageService.usage`、两个 `clearAll`、`isValidAmount` 的边界（`NaN` / 空串 / 超长数字）、页面层逻辑；
- `jest --ci` 通过但输出里夹着 `service/storage.ts` 的 `console.error` 堆栈，建议断言时静音或改用显式错误通道。

### P3-7 `fromNow` 的"昨天"判定按小时而非自然日

```ts
// utils/date.ts:77
if (diff < 48 * 60 * minute) return `昨天 ${format(ts, 'HH:mm')}`;
```
间隔 26 小时（如今天 01:00 看前天 23:00）实际是**前天**，却显示"昨天"。记事列表全站使用该函数，属可见文案错误。建议先按自然日差计算，再决定"昨天/前天"。

### P3-8 工程配套缺失

- 无 `.gitignore`（P0-2 已述）；
- 无 `README.md`（新人上手只能读 `docs/`）；
- 无 `App.onError` / `wx.onUnhandledRejection` 兜底，异常无法集中上报；
- `StorageService.usage()` 只统计三个业务 key 且按 `JSON.stringify` 长度估算，与"占用空间"的实际含义（含索引开销）有偏差，展示时建议标注"约"。

---

## 5. 修复优先级建议

| 批次 | 内容 | 理由 |
|---|---|---|
| **第一批（当天）** | P0-1 删日志、P0-2 清 `clean/` + 补 `.gitignore`、P1-8 加 `typecheck`/lint、P1-9 锁 TS 版本 | 5 分钟内可做完，且立刻恢复"错误能被工具拦住"的能力 |
| **第二批（本轮迭代）** | P1-1 主题监听、P1-2 observer、P1-3 货币符号、P1-4 导出负号、P1-5 入参校验 | 都是明确的正确性缺陷 |
| **第三批（云开发前）** | P1-6 缓存一致性、P1-7 类型声明、P2-1 ~ P2-3 | 直接影响云端替换与数据规模增长后的稳定性 |
| **第四批（清洁度）** | P2-4 列表性能、P2-6 死代码、P3 全部 | 可随迭代顺手清理 |

---

## 6. 值得肯定的部分

评审中同时确认了这些设计是**做对了**的，后续重构不要破坏：

1. **金额统一以「分」存储、展示层格式化**——从根上规避浮点误差，`toFen` 的 `toFixed(2)` 处理到位。
2. **分层清晰**（`types → utils → service → store → components → pages`），store 只依赖 service，页面只与 store 交互；将来把本地 Storage 换成 `request.ts` 上云，页面层确实不需要改动。
3. **`StorageService` 的内存缓存思路正确**（读缓存 + 写时同步），注释也把"为什么读操作不做防抖"讲清楚了。
4. **`app.json` 的 `lazyCodeLoading` 保留着**，且 `wx:for` 外包 `<view>`、Vant 布尔属性用 `{{true}}` 这些踩过的坑都已固化在代码里，没有回退。
5. **测试覆盖了 service / store / utils 三层**，`storage.test.ts` 连"数据损坏不抛错""写入失败抛 StorageError"这类异常路径都覆盖了，超出一般项目水平。

---

## 附：本次评审使用的命令

```bash
# 类型检查（发现 P0-1）
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json

# 单元测试
node node_modules/jest/bin/jest.js --ci      # 6 suites / 41 tests passed

# 目录体积（发现 P0-2）
node -e "..."                                 # clean/ = 123.12 MB, 1274 files

# 依赖版本一致性（发现 P1-9）
node -e "..."                                 # typescript: 声明 ^7.0.2 / 实际 5.6.3
```
