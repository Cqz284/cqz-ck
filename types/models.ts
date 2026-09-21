/**
 * 数据模型集中定义
 * 约定：所有模型均含 id / createTime / updateTime / extra 四个基础字段；
 *      新增业务字段不得破坏既有结构，扩展能力一律放 extra。
 */

/** 收支类型 */
export enum LedgerType {
  /** 收入 */
  Income = 'income',
  /** 支出 */
  Expense = 'expense',
}

/** 记账记录（持久化结构） */
export interface LedgerRecord {
  /** 唯一 id */
  id: string
  /** 收支类型 */
  type: LedgerType
  /** 金额，单位：分（整数） */
  amount: number
  /** 自定义标签 */
  tag?: string
  /** 备注 */
  remark?: string
  /** 记账日期 YYYY-MM-DD */
  date: string
  /**
   * 记账时间 HH:mm
   * 新增记录由 service 兜底为当前时间；旧数据（升级前创建）可能为空，
   * 展示与排序时回退到 createTime 推导
   */
  time?: string
  /** 创建时间戳（毫秒） */
  createTime: number
  /** 更新时间戳（毫秒） */
  updateTime: number
  /** 扩展字段（分类 id、图片附件等后续能力） */
  extra: Record<string, unknown>
}

/** 记账输入（新增/编辑表单），金额单位为「元」 */
export interface LedgerInput {
  /** 收支类型 */
  type: LedgerType
  /** 金额，单位：元（service 内部统一转成分存储） */
  amount: number
  /** 自定义标签 */
  tag?: string
  /** 备注 */
  remark?: string
  /** 记账日期 YYYY-MM-DD */
  date: string
  /** 记账时间 HH:mm；不传时新增默认当前时间、编辑保持原值 */
  time?: string
}

/** 记账查询条件 */
export interface LedgerQueryOptions {
  /** 月份过滤 YYYY-MM */
  month?: string
  /** 关键词（匹配备注/标签） */
  keyword?: string
}

/** 月度汇总，金额单位：分 */
export interface LedgerSummary {
  /** 收入合计（分） */
  income: number
  /** 支出合计（分） */
  expense: number
  /** 结余（分，可为负） */
  balance: number
}

/** 记事类型 */
export enum NoteKind {
  /** 普通笔记 */
  Plain = 'plain',
  /** 待办 */
  Todo = 'todo',
}

/** 记事项（持久化结构） */
export interface NoteItem {
  /** 唯一 id */
  id: string
  /** 记事类型 */
  kind: NoteKind
  /** 内容文本 */
  content: string
  /** 完成状态；普通笔记恒为 false */
  done: boolean
  /**
   * 截止时间戳（毫秒）；可选，仅在待办上有意义
   * 0 / undefined = 未设置。允许是过去的时间（设了就已逾期是合理状态）
   */
  dueTime?: number
  /**
   * 标签集合；可选，空 = 无标签（持久化结构里不落空数组，语义与 dueTime 的"清除"一致）。
   * 笔记与待办都可以打标签，单条最多 10 个、每个最长 20 字（见 NotesService）
   */
  tags?: string[]
  /** 创建时间戳（毫秒） */
  createTime: number
  /** 更新时间戳（毫秒） */
  updateTime: number
  /** 扩展字段 */
  extra: Record<string, unknown>
}

/** 记事输入 */
export interface NoteInput {
  /** 记事类型 */
  kind: NoteKind
  /** 内容文本 */
  content: string
  /** 完成状态，仅待办有效 */
  done?: boolean
  /** 截止时间戳（毫秒），仅待办有效；0 表示清除 */
  dueTime?: number
  /** 标签集合；不传保持原值，传空数组 = 清除全部标签 */
  tags?: string[]
}

/** 记事查询条件 */
export interface NoteQueryOptions {
  /** 类型过滤 */
  kind?: NoteKind
  /** 完成状态过滤 */
  done?: boolean
  /** 关键词，匹配内容与标签 */
  keyword?: string
}

/** 基础设置 */
export interface BaseSettings {
  /** 货币符号 */
  currency: string
  /**
   * 是否开启震动反馈
   * 旧数据没有该字段时按"开启"处理（读取时与默认值合并）
   */
  haptics: boolean
  /**
   * 月度支出预算（单位：分）
   * 0 表示未设置——用 0 而不是可选字段，读取处就不用到处判 undefined
   */
  monthlyBudget: number
  /** 每日支出额度（单位：分）；0 表示未设置 */
  dailyBudget: number
  /** 扩展字段 */
  extra: Record<string, unknown>
}

/** 记账页快速标签的持久化结构 */
export interface QuickTagsStore {
  /** 标签列表（环序不变，新增追加尾部） */
  tags: string[]
  /** 当前停留在条带正中央的标签（循环轮转不改变环序，居中项即"顺序"状态） */
  center: string
}
