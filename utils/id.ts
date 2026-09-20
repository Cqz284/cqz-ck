/**
 * ID 生成工具
 */

/** 同毫秒内的自增序列，弥补随机串的碰撞概率 */
let seq = 0;

/**
 * 生成唯一 id：时间戳 36 进制 + 定长随机串 + 同毫秒自增序列
 *
 * 旧实现只用 `Math.random().toString(36).slice(2, 10)`，
 * 该写法有两处不稳：① 随机结果的 36 进制长度不定（如 0.5 → "0.i"，切出来只有 1 位）；
 * ② 同一毫秒内没有序列号兜底，只能依赖随机性。
 *
 * @returns 唯一 id 字符串
 */
export function uid(): string {
  const timePart = Date.now().toString(36);
  const randPart = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  seq = (seq + 1) % 100000;
  return `${timePart}${randPart}${seq.toString(36)}`;
}
