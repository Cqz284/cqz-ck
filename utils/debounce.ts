/**
 * 防抖工具（纯函数，无副作用）
 */

/** 带回退能力的防抖函数 */
export interface DebouncedFn<T extends (...args: never[]) => void> {
  /** 调用（在 wait 毫秒内的重复调用只保留最后一次） */
  (...args: Parameters<T>): void;
  /** 取消尚未执行的调用（页面卸载时必须调用，避免 setData 落到已销毁的页面） */
  cancel(): void;
}

/**
 * 防抖：在 wait 毫秒内重复调用只执行最后一次
 *
 * 页面里请务必在 onUnload 中调用返回函数的 `cancel()`，
 * 否则定时器会在页面销毁后继续触发回调。
 *
 * @param fn 目标函数
 * @param wait 等待毫秒数，默认 300
 * @returns 包装后的函数（含 cancel）
 */
export function debounce<T extends (...args: never[]) => void>(fn: T, wait = 300): DebouncedFn<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const wrapper = function (this: unknown, ...args: Parameters<T>): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  } as DebouncedFn<T>;

  wrapper.cancel = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return wrapper;
}
