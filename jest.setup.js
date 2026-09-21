/**
 * jest 全局环境准备：注入 wx 运行时 mock。
 * 注意：miniprogram-api-typings 只提供类型声明，不提供运行时，
 * 因此 service 层在 jest 中调用 wx.getStorageSync 等 API 必须在此挂载实现。
 */
const memoryStore = new Map();

const wxMock = {
  getStorageSync(key) {
    return memoryStore.has(key) ? memoryStore.get(key) : '';
  },
  setStorageSync(key, value) {
    memoryStore.set(key, value);
  },
  removeStorageSync(key) {
    memoryStore.delete(key);
  },
  clearStorageSync() {
    memoryStore.clear();
  },
  getStorageInfoSync() {
    return { keys: Array.from(memoryStore.keys()), currentSize: 0, limitSize: 10240 };
  },
  showToast() {},
  showModal() {},
  showLoading() {},
  hideLoading() {},
  setClipboardData() {},
  /** 主题来源：utils/theme.ts 优先读取该接口 */
  getAppBaseInfo() {
    return { theme: 'light', platform: 'devtools', SDKVersion: '3.0.0' };
  },
  getSystemInfoSync() {
    return { theme: 'light', platform: 'devtools', SDKVersion: '3.0.0' };
  },
  getWindowInfo() {
    return { windowWidth: 375, windowHeight: 667, safeArea: { top: 0 } };
  },
  /**
   * 选择器查询（swipe-select 的 measureHeights 等用它量节点高度）
   * 默认返回 0 高度：拿不到真实值时测试里按需覆盖
   */
  createSelectorQuery() {
    const res = { scrollHeight: 0, scrollTop: 0 };
    const query = {
      selectViewport() {
        return this;
      },
      scrollOffset(cb) {
        if (typeof cb === 'function') cb(res);
        return this;
      },
      exec(cb) {
        if (typeof cb === 'function') cb([res]);
        return this;
      },
    };
    return query;
  },
  getDeviceInfo() {
    return { platform: 'devtools' };
  },
  getMenuButtonBoundingClientRect() {
    return { left: 300, top: 0, right: 375, bottom: 32, width: 75, height: 32 };
  },
  onThemeChange() {},
  offThemeChange() {},
  /** tabBar 主题同步（utils/theme.applyTabBarTheme）：记下最后一次调用，供测试断言 */
  setTabBarStyle(option) {
    if (option && typeof option.success === 'function') option.success({});
    global.__tabBarStyle = option;
  },
  setTabBarItem(option) {
    global.__tabBarItems = (global.__tabBarItems || []).concat([option]);
  },
  setBackgroundColor(option) {
    global.__windowBg = option;
  },
  navigateTo() {},
  navigateBack() {},
  switchTab() {},
  reLaunch() {},
  nextTick(fn) {
    if (typeof fn === 'function') fn();
  },
  vibrateShort() {},
  vibrateLong() {},
};

global.wx = wxMock;

/** 供测试用例直接读写底层存储 */
global.__wxStorageMock = memoryStore;
