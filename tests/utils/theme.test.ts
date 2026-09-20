/**
 * 主题一致性回归测试
 *
 * 背景：配色同时存在于三处（utils/theme.ts、app.wxss、theme.json），需要人工同步，
 * 此前已经漂移过（app.wxss 的深色块漏了 --primary、theme.json 的色值与令牌不一致）。
 * 这里把"人工同步"变成机器校验，任何一处改动忘记同步都会立刻失败。
 *
 * 2026-09-19 变更：app.wxss 里"跟随系统深色"的媒体查询块已**移除**
 * （它会让"系统深色 + 应用内浅色"时切 tab 闪屏），所以这里改成断言"它不再存在"。
 * 颜色的唯一来源改为 utils/theme.ts 经 <page-meta page-style> 注入的内联变量，
 * app.wxss 只保留浅色首帧兜底。
 */
import * as fs from 'fs';
import * as path from 'path';
import { LIGHT_COLORS, DARK_COLORS, buildThemeStyle } from '../../utils/theme';
import type { ThemeColors } from '../../utils/theme';

const ROOT = path.resolve(__dirname, '../..');
const appWxss = fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8');
const themeJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'theme.json'), 'utf8')) as {
  light: Record<string, string>;
  dark: Record<string, string>;
};

/** 去掉注释后的样式：注释里会提到那段媒体查询的写法，不剥掉会把说明文字当成代码 */
const appWxssNoComments = appWxss.replace(/\/\*[\s\S]*?\*\//g, '');

/** 从一段 CSS 中抽出所有自定义属性 */
function readCssVars(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/** 现在文件里只剩一套变量定义（浅色兜底） */
const lightVars = readCssVars(appWxss);

/** CSS 变量名 -> ThemeColors 字段 */
const VAR_TO_KEY: Array<[string, keyof ThemeColors]> = [
  ['--bg-color', 'pageBg'],
  ['--card-bg', 'cardBg'],
  ['--border-color', 'borderColor'],
  ['--text-color', 'textColor'],
  ['--sub-text-color', 'subTextColor'],
  ['--primary', 'primary'],
  ['--primary-soft', 'primarySoft'],
  ['--danger', 'danger'],
  ['--danger-soft', 'dangerSoft'],
  ['--accent', 'accent'],
  ['--accent-soft', 'accentSoft'],
  ['--shadow-card', 'shadowCard'],
];

/** Vant 变量名 -> ThemeColors 字段 */
const VANT_VAR_TO_KEY: Array<[string, keyof ThemeColors]> = [
  ['--background-color', 'pageBg'],
  ['--cell-background-color', 'cardBg'],
  ['--cell-text-color', 'textColor'],
  ['--cell-border-color', 'borderColor'],
  ['--tab-active-text-color', 'primary'],
  ['--grid-item-content-background-color', 'cardBg'],
  ['--grid-item-content-active-color', 'gridItemActive'],
];

describe('app.wxss 与 utils/theme.ts 的配色必须一致', () => {
  test('浅色块（首帧兜底）', () => {
    VAR_TO_KEY.forEach(([cssVar, key]) => {
      expect(lightVars[cssVar]).toBe(LIGHT_COLORS[key]);
    });
  });

  test('浅色块里的 Vant 变量', () => {
    VANT_VAR_TO_KEY.forEach(([cssVar, key]) => {
      expect(lightVars[cssVar]).toBe(LIGHT_COLORS[key]);
    });
  });

  test('不再保留"跟随系统深色"的媒体查询', () => {
    // 它跟随系统配色，与"应用内手动选浅色"冲突：切 tab 时会先闪一屏深色
    expect(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/.test(appWxssNoComments)).toBe(false);
  });

  test('深色配色仍然完整定义在 utils/theme.ts（不能因为删了兜底块就只剩浅色）', () => {
    VAR_TO_KEY.forEach(([, key]) => {
      expect(typeof DARK_COLORS[key]).toBe('string');
    });
    expect(DARK_COLORS.pageBg).not.toBe(LIGHT_COLORS.pageBg);
  });
});

describe('theme.json 的 tabBar 配色必须与令牌一致', () => {
  test('浅色', () => {
    expect(themeJson.light.tabSelectedColor).toBe(LIGHT_COLORS.primary);
    expect(themeJson.light.tabFontColor).toBe(LIGHT_COLORS.subTextColor);
    expect(themeJson.light.tabBgColor).toBe(LIGHT_COLORS.pageBg);
  });

  test('深色', () => {
    expect(themeJson.dark.tabSelectedColor).toBe(DARK_COLORS.primary);
    expect(themeJson.dark.tabFontColor).toBe(DARK_COLORS.subTextColor);
    expect(themeJson.dark.tabBgColor).toBe(DARK_COLORS.pageBg);
  });

  test('不再保留 app.json 未引用的死配置键', () => {
    ['pageBg', 'cardBg', 'textPrimary', 'bgColor', 'bgTxtStyle'].forEach((key) => {
      expect(themeJson.light[key]).toBeUndefined();
      expect(themeJson.dark[key]).toBeUndefined();
    });
  });
});

describe('buildThemeStyle', () => {
  test('内联样式包含业务变量与 Vant 变量', () => {
    const light = buildThemeStyle(false);
    expect(light).toContain('--bg-color:' + LIGHT_COLORS.pageBg + ';');
    expect(light).toContain('--primary:' + LIGHT_COLORS.primary + ';');
    expect(light).toContain('--grid-item-content-background-color:' + LIGHT_COLORS.cardBg + ';');

    const dark = buildThemeStyle(true);
    expect(dark).toContain('--bg-color:' + DARK_COLORS.pageBg + ';');
    expect(dark).toContain('--primary:' + DARK_COLORS.primary + ';');
    expect(dark).toContain('--grid-item-content-active-color:' + DARK_COLORS.gridItemActive + ';');
  });

  test('输出的颜色值全部来自配色令牌（防止在函数里另写一份硬编码色值）', () => {
    const allowed = new Set<string>();
    [LIGHT_COLORS, DARK_COLORS].forEach((colors) =>
      Object.values(colors).forEach((v) => {
        if (typeof v === 'string') allowed.add(v);
      })
    );

    const style = buildThemeStyle(true) + buildThemeStyle(false);
    const hexes = style.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    expect(hexes.length).toBeGreaterThan(0);
    hexes.forEach((hex) => expect(allowed.has(hex)).toBe(true));
  });
});
