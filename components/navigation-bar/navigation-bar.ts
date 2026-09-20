Component({
  options: {
    multipleSlots: true,
  },
  properties: {
    extClass: {
      type: String,
      value: '',
    },
    title: {
      type: String,
      value: '',
    },
    background: {
      type: String,
      value: '',
    },
    color: {
      type: String,
      value: '',
    },
    back: {
      type: Boolean,
      value: true,
    },
    loading: {
      type: Boolean,
      value: false,
    },
    homeButton: {
      type: Boolean,
      value: false,
    },
    animated: {
      type: Boolean,
      value: true,
    },
    show: {
      type: Boolean,
      value: true,
      observer: '_showChange',
    },
    delta: {
      type: Number,
      value: 1,
    },
  },
  data: {
    displayStyle: '',
  },
  lifetimes: {
    attached() {
      const rect = wx.getMenuButtonBoundingClientRect();
      const platform = (wx.getDeviceInfo() || wx.getSystemInfoSync()).platform;
      const isAndroid = platform === 'android';
      const isDevtools = platform === 'devtools';
      const { windowWidth, safeArea: { top = 0 } = {} } =
        wx.getWindowInfo() || wx.getSystemInfoSync();
      this.setData({
        ios: !isAndroid,
        innerPaddingRight: `padding-right: ${windowWidth - rect.left}px`,
        leftWidth: `width: ${windowWidth - rect.left}px`,
        safeAreaTop: isDevtools || isAndroid ? `height: calc(var(--height) + ${top}px); padding-top: ${top}px` : '',
      });
    },
  },
  methods: {
    _showChange(show: boolean) {
      const { animated } = this.data;
      let displayStyle = '';
      if (animated) {
        displayStyle = `opacity: ${show ? '1' : '0'};transition:opacity 0.5s;`;
      } else {
        displayStyle = `display: ${show ? '' : 'none'}`;
      }
      this.setData({ displayStyle });
    },
    back() {
      const { delta } = this.data;
      if (delta) {
        wx.navigateBack({ delta });
      }
      this.triggerEvent('back', { delta }, {});
    },
  },
});
