Component({
  properties: {
    /** 提示文案 */
    text: { type: String, value: '暂无数据' },
    /** 图标名（Vant icon） */
    icon: { type: String, value: 'notes-o' },
    /** 行动按钮文案，留空则不显示 */
    actionText: { type: String, value: '' },
  },

  methods: {
    /** 点击行动按钮 */
    onAction() {
      this.triggerEvent('action');
    },
  },
});
