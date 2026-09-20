/**
 * 金额工具
 * 约定：所有持久化与计算均使用「分」（整数），仅展示层转换为「元」。
 */

/** 单笔金额上限：100 万元（= 100,000,000 分），用于拦截误输入的天文数字 */
export const MAX_YUAN = 1000000;

/** 金额相关错误 */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * 元转分（规避浮点误差，如 19.99 * 100 = 1998.9999...）
 *
 * 与旧实现的区别：非法输入不再静默返回 NaN（那会在展示层渲染出 `¥NaN.undefined`），
 * 而是直接抛错，让问题在写入存储之前就暴露出来。
 *
 * @param yuan 金额（元）
 * @returns 金额（分，整数）
 * @throws {MoneyError} 入参不是有限数字，或超出安全整数范围
 */
export function toFen(yuan: number): number {
  const n = Number(yuan);
  if (!Number.isFinite(n)) {
    throw new MoneyError(`金额不是有效数字：${String(yuan)}`);
  }
  const fen = Math.round(Number(n.toFixed(2)) * 100);
  if (!Number.isSafeInteger(fen)) {
    throw new MoneyError(`金额超出可表示范围：${String(yuan)}`);
  }
  return fen;
}

/**
 * 分转元（用于计算与展示，保留两位小数）
 * @param fen 金额（分）
 * @returns 金额（元）
 */
export function toYuan(fen: number): number {
  const n = Number(fen);
  if (!Number.isFinite(n)) return 0;
  return Number((n / 100).toFixed(2));
}

/**
 * 格式化为带千分位的展示文本，如 ¥12.30 / -¥12.30
 *
 * 容错策略：入参非有限数字时返回「货币符号 + 0.00」而不是 `¥NaN.undefined`。
 * 真正的数据校验应在 service 层完成（见 toFen / LedgerService），此处只做兜底。
 *
 * @param fen 金额（分）
 * @param currency 货币符号，默认 ¥
 * @param withSign 负数是否显示负号
 * @returns 展示字符串
 */
export function formatMoney(fen: number, currency = '¥', withSign = false): string {
  const n = Number(fen);
  const safe = Number.isFinite(n) ? Math.abs(n) : 0;
  const parts = toYuan(safe).toFixed(2).split('.');
  const int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = withSign && Number.isFinite(n) && n < 0 ? '-' : '';
  return sign + currency + int + '.' + parts[1];
}

/**
 * 校验金额输入是否合法（正数、最多两位小数、不超上限）
 * @param input 用户输入
 * @returns boolean
 */
export function isValidAmount(input: unknown): boolean {
  if (input === null || input === undefined) return false;
  const text = String(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return false;

  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return false;
  return n <= MAX_YUAN;
}
