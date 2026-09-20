/**
 * 主题测试（只跟随系统）
 *
 * 2026-09-19：主题切换（浅色 / 深色 / 跟随系统）已按用户要求移除，
 * 所以这里只剩两条要钉住的行为：
 * 1. 深浅完全由**系统**决定，没有手动覆盖；
 * 2. 系统主题变化时，tabBar 与所有已挂载页面要一起刷新。
 */
import {
  DARK_COLORS,
  LIGHT_COLORS,
  applyPageTheme,
  applyTabBarTheme,
  attachPageTheme,
  buildThemeStyle,
  detachPageTheme,
  isDarkTheme,
  systemIsDark,
} from '../../utils/theme';

/** 让 wx.getAppBaseInfo 返回指定系统主题 */
function mockSystemTheme(theme: 'light' | 'dark'): void {
  (wx as unknown as Record<string, unknown>).getAppBaseInfo = () => ({ theme, platform: 'devtools' });
}

/** tabBar 相关 API 的 spy */
const setTabBarStyle = jest.fn();
const setTabBarItem = jest.fn();

/**
 * 记下注册进来的系统主题监听
 *
 * 注意不要在 beforeEach 里清空：theme.ts 的监听是**进程级只注册一次**的，
 * 清掉之后就再也拿不到了（第二次 attach 不会重复注册）。
 */
let themeHandler: (() => void) | null = null;

/** 造一个只实现 setData 的页面替身 */
function makePage(): { data: Record<string, unknown>; setData(d: Record<string, unknown>): void } {
  const page = {
    data: {} as Record<string, unknown>,
    setData(d: Record<string, unknown>) {
      Object.assign(page.data, d);
    },
  };
  return page;
}

beforeEach(() => {
  const w = wx as unknown as Record<string, unknown>;
  w.setTabBarStyle = setTabBarStyle;
  w.setTabBarItem = setTabBarItem;
  w.onThemeChange = (fn: () => void) => {
    themeHandler = fn;
  };
  mockSystemTheme('light');
  setTabBarStyle.mockClear();
  setTabBarItem.mockClear();
});

describe('主题解析：只跟随系统', () => {
  test('系统浅色即浅色', () => {
    mockSystemTheme('light');
    expect(systemIsDark()).toBe(false);
    expect(isDarkTheme()).toBe(false);
  });

  test('系统深色即深色', () => {
    mockSystemTheme('dark');
    expect(systemIsDark()).toBe(true);
    expect(isDarkTheme()).toBe(true);
  });

  test('取不到系统主题时按浅色兜底（不能因为一个异常把页面刷成深色）', () => {
    (wx as unknown as Record<string, unknown>).getAppBaseInfo = () => {
      throw new Error('not supported');
    };
    expect(systemIsDark()).toBe(false);
  });
});

describe('tabBar 与页面同步', () => {
  test('applyTabBarTheme 同时设置配色与对应主题的图标', () => {
    applyTabBarTheme(true);

    expect(setTabBarStyle).toHaveBeenCalledTimes(1);
    const style = setTabBarStyle.mock.calls[0][0] as Record<string, string>;
    expect(style.backgroundColor).toBe(DARK_COLORS.pageBg);
    expect(style.color).toBe(DARK_COLORS.subTextColor);
    expect(style.selectedColor).toBe(DARK_COLORS.primary);

    // 4 个 tab 的图标都要换成深色版
    expect(setTabBarItem).toHaveBeenCalledTimes(4);
    const first = setTabBarItem.mock.calls[0][0] as { index: number; iconPath: string; selectedIconPath: string };
    expect(first.index).toBe(0);
    expect(first.iconPath).toContain('assets/tabbar/dark/');
    expect(first.selectedIconPath).toContain('dark');
  });

  test('切到浅色用浅色图标', () => {
    applyTabBarTheme(false);
    const style = setTabBarStyle.mock.calls[0][0] as Record<string, string>;
    expect(style.backgroundColor).toBe(LIGHT_COLORS.pageBg);
    const first = setTabBarItem.mock.calls[0][0] as { iconPath: string };
    expect(first.iconPath).toContain('assets/tabbar/light/');
  });

  test('applyPageTheme 会顺手重钉 tabBar（从二级页返回时 tab 栏才不会停在旧配色）', () => {
    const page = makePage();
    mockSystemTheme('dark');
    applyPageTheme(page);

    expect(String(page.data.pageStyle)).toContain(DARK_COLORS.pageBg);
    // 深色下导航栏文字要转成白色，否则黑底黑字看不见
    expect(page.data.navBarColor).toBe(DARK_COLORS.navBarColor);
    expect(setTabBarStyle).toHaveBeenCalled();
  });
});

describe('系统主题变化', () => {
  test('已挂载的页面会一起刷新', () => {
    const page = makePage();
    mockSystemTheme('light');
    attachPageTheme(page);
    expect(String(page.data.pageStyle)).toContain(LIGHT_COLORS.pageBg);
    expect(themeHandler).toBeTruthy();

    // 系统切成深色并触发监听
    mockSystemTheme('dark');
    themeHandler!();
    expect(String(page.data.pageStyle)).toContain(DARK_COLORS.pageBg);

    // 注销之后不再被打扰
    detachPageTheme(page);
    const before = String(page.data.pageStyle);
    mockSystemTheme('light');
    themeHandler!();
    expect(String(page.data.pageStyle)).toBe(before);
  });
});

describe('buildThemeStyle', () => {
  test('两套主题各自输出自己的变量', () => {
    expect(buildThemeStyle(false)).toContain('--bg-color:' + LIGHT_COLORS.pageBg + ';');
    expect(buildThemeStyle(true)).toContain('--bg-color:' + DARK_COLORS.pageBg + ';');
  });
});
