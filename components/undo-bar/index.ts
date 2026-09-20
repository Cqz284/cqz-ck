/** 组件内部字段（不参与渲染，因此不放 data）：倒计时句柄 */
interface UndoBarInternal {
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * 取出内部字段视图
 * @param inst 组件实例（this）
 * @returns 带 timer 的实例视图
 */
function asInternal(inst: unknown): UndoBarInternal {
  return inst as UndoBarInternal;
}

Component({
  properties: {
    /** 是否展示（由页面控制；组件只负责进出动画与倒计时） */
    show: {
      type: Boolean,
      value: false,
      observer: 'onShowChange',
    },
    /** 提示文案 */
    text: { type: String, value: '' },
    /** 可撤销时长（毫秒） */
    duration: { type: Number, value: 5000 },
  },

  data: {},

  lifetimes: {
    detached() {
      this.clearTimer();
    },
  },

  methods: {
    /**
     * 展示状态变化：开始 / 停止倒计时
     * @param show 是否展示
     */
    onShowChange(show: boolean) {
      this.clearTimer();
      if (!show) return;
      const self = asInternal(this);
      self.timer = setTimeout(() => {
        self.timer = null;
        // 超时后由页面收起并丢弃暂存数据
        this.triggerEvent('expire', {});
      }, this.data.duration);
    },

    /** 清空倒计时 */
    clearTimer() {
      const self = asInternal(this);
      if (self.timer) {
        clearTimeout(self.timer);
        self.timer = null;
      }
    },

    /** 点击撤销 */
    onUndo() {
      this.clearTimer();
      this.triggerEvent('undo', {});
    },

    /** 吞掉点击，避免冒泡到页面触发别的操作 */
    noop() {},
  },
});
