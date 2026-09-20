/**
 * 主题与设计令牌（生活化调性）
 *
 * 只有一种行为：**跟随系统**。
 * （曾支持在小程序内切换「浅色 / 深色 / 跟随系统」，2026-09-19 按用户要求移除：
 *  手动模式与微信自己的 tabBar 渲染（app.json 的 darkmode + theme.json）总差一帧，
 *  页面颜色已经对了、底部 tab 还在旧配色上，收益小于维护成本。）
 *
 * 为什么颜色只走内联变量、不用 WXSS 媒体查询：
 * ① 部分环境（含开发者工具）对 prefers-color-scheme 支持不稳定；
 * ② 变量要能作用到 .fab / .pick-bar / .edit-bar / undo-bar 这些与 .page **平级**的
 *    fixed 元素——挂在 page 上的媒体查询只能靠继承，覆盖不到它们。
 * 所以 app.wxss 只保留浅色首帧兜底，真实颜色一律由这里注入。
 *
 * 为什么页面要挂 <page-meta page-style="{{pageStyle}}">：
 * 注入变量必须落在 **page 根元素**上，否则上面那些平级的 fixed 元素拿不到变量。
 *
 * 用法（页面内三行）：
 *   onLoad()  { attachPageTheme(this) }      // 应用一次 + 登记到全局监听
 *   onShow()  { applyPageTheme(this) }       // 回到前台时重取一次
 *   onUnload(){ detachPageTheme(this) }      // 注销登记
 */

/** 一套主题的配色 */
export interface ThemeColors {
  /** 页面背景 */
  pageBg: string;
  /** 卡片背景 */
  cardBg: string;
  /** 边框色 */
  borderColor: string;
  /** 主文字色 */
  textColor: string;
  /** 次要文字色 */
  subTextColor: string;
  /** 品牌主色（收入 / 主操作） */
  primary: string;
  /** 主色浅底（选中态、标签底） */
  primarySoft: string;
  /** 支出 / 危险色 */
  danger: string;
  /** 危险浅底 */
  dangerSoft: string;
  /** 暖色点缀（待办 / 提醒） */
  accent: string;
  /** 暖色浅底 */
  accentSoft: string;
  /** Vant 宫格项按下态底色 */
  gridItemActive: string;
  /** 卡片投影；深色用描边环替代投影 */
  shadowCard: string;
  /** 滑删「退出」操作块的底色（多选态左滑露出，需要与"删除"的红色明显区分） */
  swipeExitBg: string;
  /** 自定义导航栏文字色 */
  navBarColor: 'black' | 'white';
}

/** 浅色：页面纯白，暖调中性色 */
export const LIGHT_COLORS: ThemeColors = {
  pageBg: '#ffffff',
  cardBg: '#ffffff',
  borderColor: '#f2efeb',
  textColor: '#2e2a26',
  subTextColor: '#9a948d',
  primary: '#34be8c',
  primarySoft: '#e9f7f1',
  danger: '#ee6c5c',
  dangerSoft: '#fdeeeb',
  accent: '#ffb74d',
  accentSoft: '#fff4e3',
  gridItemActive: '#f7f5f2',
  shadowCard: '0 4rpx 20rpx rgba(150, 125, 95, 0.08)',
  swipeExitBg: 'rgba(120, 112, 104, 0.55)',
  navBarColor: 'black',
};

/** 深色：暖黑；卡片用描边环保底 */
export const DARK_COLORS: ThemeColors = {
  pageBg: '#171512',
  cardBg: '#211e19',
  borderColor: '#322e28',
  textColor: '#f5f2ec',
  subTextColor: '#a39c92',
  primary: '#34be8c',
  primarySoft: '#1e3a31',
  danger: '#f0836f',
  dangerSoft: '#3a2622',
  accent: '#ffc36b',
  accentSoft: '#3a2f1c',
  gridItemActive: '#2a2723',
  shadowCard: '0 0 0 1rpx #322e28',
  swipeExitBg: 'rgba(255, 255, 255, 0.18)',
  navBarColor: 'white',
};

/**
 * tabBar 图标资源
 *
 * 与 app.json / theme.json 里 tabBar 的 iconPath 完全一致。
 * 系统主题变化时微信会按 theme.json 自动换图标，但**不会**连配色一起换对，
 * 所以每次主题变化都要由 setTabBarItem / setTabBarStyle 显式钉一遍。
 */
const TAB_ICONS: Record<'light' | 'dark', Array<{ iconPath: string; selectedIconPath: string }>> = {
  light: [
    { iconPath: 'assets/tabbar/light/home.png', selectedIconPath: 'assets/tabbar/light/home-active.png' },
    { iconPath: 'assets/tabbar/light/ledger.png', selectedIconPath: 'assets/tabbar/light/ledger-active.png' },
    { iconPath: 'assets/tabbar/light/notes.png', selectedIconPath: 'assets/tabbar/light/notes-active.png' },
    { iconPath: 'assets/tabbar/light/profile.png', selectedIconPath: 'assets/tabbar/light/profile-active.png' },
  ],
  dark: [
    { iconPath: 'assets/tabbar/dark/home.png', selectedIconPath: 'assets/tabbar/dark/home-active.png' },
    { iconPath: 'assets/tabbar/dark/ledger.png', selectedIconPath: 'assets/tabbar/dark/ledger-active.png' },
    { iconPath: 'assets/tabbar/dark/notes.png', selectedIconPath: 'assets/tabbar/dark/notes-active.png' },
    { iconPath: 'assets/tabbar/dark/profile.png', selectedIconPath: 'assets/tabbar/dark/profile-active.png' },
  ],
};

/** 系统主题监听是否已注册（全局只需要一个） */
let listening = false;

/** 页面实例只需具备 setData 能力即可套用主题 */
export interface ThemeAwarePage {
  setData(data: Record<string, unknown>): void;
}

/** 已挂载的页面：系统主题变化时立刻重刷，不必等各自 onShow */
const mountedPages = new Set<ThemeAwarePage>();

/**
 * 系统当前是否为深色
 * 优先使用 wx.getAppBaseInfo（getSystemInfoSync 已废弃），并对低版本做兜底。
 * @returns boolean
 */
export function systemIsDark(): boolean {
  try {
    if (typeof wx.getAppBaseInfo === 'function') {
      return wx.getAppBaseInfo().theme === 'dark';
    }
    return (wx.getSystemInfoSync() as { theme?: string }).theme === 'dark';
  } catch {
    // 取不到主题时按浅色处理
    return false;
  }
}

/**
 * 当前是否深色主题（始终跟随系统）
 * @returns boolean
 */
export function isDarkTheme(): boolean {
  return systemIsDark();
}

/**
 * 生成页面根节点内联样式（业务变量 + Vant 组件变量）
 * @param isDark 是否深色
 * @returns CSS 变量字符串，可直接绑定到根节点 style
 */
export function buildThemeStyle(isDark: boolean): string {
  const c = isDark ? DARK_COLORS : LIGHT_COLORS;

  const business =
    '--bg-color:' + c.pageBg + ';' +
    '--card-bg:' + c.cardBg + ';' +
    '--border-color:' + c.borderColor + ';' +
    '--text-color:' + c.textColor + ';' +
    '--sub-text-color:' + c.subTextColor + ';' +
    '--primary:' + c.primary + ';' +
    '--primary-soft:' + c.primarySoft + ';' +
    '--danger:' + c.danger + ';' +
    '--danger-soft:' + c.dangerSoft + ';' +
    '--accent:' + c.accent + ';' +
    '--accent-soft:' + c.accentSoft + ';' +
    '--swipe-exit-bg:' + c.swipeExitBg + ';' +
    '--shadow-card:' + c.shadowCard + ';';

  const vant =
    '--background-color:' + c.pageBg + ';' +
    '--cell-background-color:' + c.cardBg + ';' +
    '--cell-text-color:' + c.textColor + ';' +
    '--cell-value-color:' + c.subTextColor + ';' +
    '--cell-label-color:' + c.subTextColor + ';' +
    '--cell-border-color:' + c.borderColor + ';' +
    '--cell-group-title-color:' + c.subTextColor + ';' +
    '--field-input-text-color:' + c.textColor + ';' +
    '--field-placeholder-text-color:' + c.subTextColor + ';' +
    '--field-label-color:' + c.textColor + ';' +
    '--search-background-color:' + c.cardBg + ';' +
    '--tabs-nav-background-color:' + c.pageBg + ';' +
    '--tab-text-color:' + c.subTextColor + ';' +
    '--tab-active-text-color:' + c.primary + ';' +
    '--grid-item-content-background-color:' + c.cardBg + ';' +
    '--grid-item-content-active-color:' + c.gridItemActive + ';' +
    '--grid-item-text-color:' + c.textColor + ';' +
    '--button-primary-background-color:' + c.primary + ';' +
    '--button-primary-border-color:' + c.primary + ';' +
    '--button-danger-background-color:' + c.danger + ';' +
    '--button-danger-border-color:' + c.danger + ';' +
    '--button-default-background-color:' + c.cardBg + ';' +
    '--button-default-color:' + c.textColor + ';' +
    '--button-default-border-color:' + c.borderColor + ';';

  return business + vant;
}

/**
 * 把当前主题写入页面 data（pageStyle / pageBg / navBarBg / navBarColor），并顺手钉一次 tabBar
 *
 * 为什么这里也要钉 tabBar：
 * 系统 tabBar 不在页面视图内，**页面显示时它可能被框架按 theme.json / 上一次的状态重新渲染**
 * （典型场景：在「设置」二级页里呆了很久再回 tab 页 —— 页面颜色立刻对了，tab 栏却还是旧的）。
 * 每次页面显示都重钉一次，代价只有几个轻量 API 调用（幂等，重复调用无副作用），
 * 换的是"从任何页面回来，tab 栏一定与页面主题一致"。
 *
 * @param page 页面实例
 * @returns 本次是否为深色
 */
export function applyPageTheme(page: ThemeAwarePage): boolean {
  const isDark = isDarkTheme();
  const c = isDark ? DARK_COLORS : LIGHT_COLORS;
  page.setData({
    pageStyle: buildThemeStyle(isDark),
    pageBg: c.pageBg,
    navBarBg: c.pageBg,
    navBarColor: c.navBarColor,
  });
  applyTabBarTheme(isDark);
  return isDark;
}

/**
 * 同步系统 tabBar 的配色与图标
 * @param isDark 是否深色
 */
export function applyTabBarTheme(isDark: boolean): void {
  const c = isDark ? DARK_COLORS : LIGHT_COLORS;
  const onFail = () => {
    // 非 tabBar 场景（二级页）或低版本不支持：静默降级，回到 tab 页时还会再钉一次
  };

  try {
    wx.setTabBarStyle({
      color: c.subTextColor,
      selectedColor: c.primary,
      backgroundColor: c.pageBg,
      borderStyle: isDark ? 'white' : 'black',
      fail: onFail,
    });
    TAB_ICONS[isDark ? 'dark' : 'light'].forEach((icon, index) => {
      wx.setTabBarItem({ index, iconPath: icon.iconPath, selectedIconPath: icon.selectedIconPath, fail: onFail });
    });
  } catch {
    // 老版本 API 不存在时忽略
  }

  try {
    // 窗口背景（下拉/滚动越界时露出的底色）也跟着，避免深色页面被白边包住
    wx.setBackgroundColor({
      backgroundColor: c.pageBg,
      backgroundColorTop: c.pageBg,
      backgroundColorBottom: c.pageBg,
      fail: onFail,
    });
  } catch {
    // 忽略
  }
}

/**
 * 重刷主题：tabBar + 所有已挂载页面
 *
 * 系统主题变化时调用（本小程序只跟随系统，没有手动切换入口）。
 */
export function refreshTheme(): void {
  const isDark = isDarkTheme();
  applyTabBarTheme(isDark);
  mountedPages.forEach((page) => applyPageTheme(page));
}

/** 注册全局的系统主题监听（只注册一次） */
function ensureSystemListener(): void {
  if (listening) return;
  listening = true;
  try {
    wx.onThemeChange(() => refreshTheme());
  } catch {
    listening = false;
  }
}

/**
 * 应用主题、登记该页面并（首次）注册系统主题监听
 * @param page 页面实例
 */
export function attachPageTheme(page: ThemeAwarePage): void {
  mountedPages.add(page);
  ensureSystemListener();
  applyPageTheme(page);
}

/**
 * 注销该页面的主题刷新
 *
 * 注意：系统监听是全局唯一的，注销单个页面时**不能**去 offThemeChange——
 * 那会把其它页面的刷新一起废掉。
 * @param page 页面实例
 */
export function detachPageTheme(page: ThemeAwarePage): void {
  mountedPages.delete(page);
}
