/**
 * 分类占比条：首页 / 记账页汇总卡里的"支出构成"入口
 *
 * 只负责渲染，不碰数据：段由页面用 utils/chart 的 buildMixSegments 算好传进来，
 * 保证它和统计页环形图的分类归属、占比完全一致。
 */
Component({
  properties: {
    /** 标题，如「本月支出构成」 */
    title: { type: String, value: '支出构成' },
    /** 合计文案（如 ¥1,234.00）；为空则不显示 */
    totalText: { type: String, value: '' },
    /** 段数组：label / percent / percentText / color */
    items: { type: Array, value: [] },
  },

  methods: {
    /**
     * 点击整块 → 抛 open 事件，由页面决定跳哪里
     *
     * 事件名刻意不叫 tap：组件的 tap 会原样冒泡到宿主节点，
     * 若页面同时绑 bind:tap，一次点击会触发两次（连跳两页）。
     */
    onTap() {
      this.triggerEvent('open', {});
    },
  },
});
