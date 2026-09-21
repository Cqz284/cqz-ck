import { buildPieSlices, buildMixSegments, hitTestSlice, normalizeAngle, linePoints, nearestLineIndex, hexToRgba, PIE_COLORS, OTHER_COLOR } from '../../utils/chart';
import type { PieSlice } from '../../utils/chart';
import { sumByCategory } from '../../utils/stats';
import { shiftMonth, monthLabel } from '../../utils/date';
import { LedgerType } from '../../types/models';
import type { LedgerRecord } from '../../types/models';

/** 造一条记账记录（只填测试关心的字段） */
function rec(partial: Partial<LedgerRecord>): LedgerRecord {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    type: partial.type ?? LedgerType.Expense,
    amount: partial.amount ?? 100,
    tag: partial.tag ?? '',
    remark: partial.remark ?? '',
    date: partial.date ?? '2026-09-17',
    createTime: partial.createTime ?? 1,
    updateTime: partial.updateTime ?? 1,
    extra: {},
  };
}

describe('chart · buildPieSlices', () => {
  test('按金额倒序、占比之和为 1、角度首尾相接', () => {
    const slices = buildPieSlices([
      { label: 'c', value: 100 },
      { label: 'a', value: 300 },
      { label: 'b', value: 200 },
    ]);

    expect(slices.map((s) => s.label)).toEqual(['a', 'b', 'c']);
    expect(slices[0].ratio).toBeCloseTo(0.5, 10);
    expect(slices[1].ratio).toBeCloseTo(1 / 3, 10);

    const sum = slices.reduce((acc, s) => acc + s.ratio, 0);
    expect(sum).toBeCloseTo(1, 10);

    // 起始固定在 12 点方向（-90°）
    expect(slices[0].startAngle).toBeCloseTo(-Math.PI / 2, 10);
    // 相邻分片首尾相接
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].startAngle).toBeCloseTo(slices[i - 1].endAngle, 10);
    }
    // 最后一个分片正好闭环
    expect(slices[slices.length - 1].endAngle).toBeCloseTo(-Math.PI / 2 + Math.PI * 2, 10);
  });

  test('超过上限的尾部合并成「其他」，用固定灰色', () => {
    const slices = buildPieSlices(
      [
        { label: 'a', value: 500 },
        { label: 'b', value: 400 },
        { label: 'c', value: 300 },
        { label: 'd', value: 200 },
        { label: 'e', value: 100 },
      ],
      2
    );

    expect(slices.map((s) => s.label)).toEqual(['a', 'b', '其他']);
    // 尾部 300 + 200 + 100 合并
    expect(slices[2].value).toBe(600);
    expect(slices[2].isOther).toBe(true);
    expect(slices[2].color).toBe(OTHER_COLOR);
    expect(slices.reduce((acc, s) => acc + s.ratio, 0)).toBeCloseTo(1, 10);
  });

  test('分类数不超过上限时不出现「其他」', () => {
    const slices = buildPieSlices([
      { label: 'a', value: 1 },
      { label: 'b', value: 1 },
    ]);
    expect(slices.every((s) => !s.isOther)).toBe(true);
    expect(slices[0].color).toBe(PIE_COLORS[0]);
    expect(slices[1].color).toBe(PIE_COLORS[1]);
  });

  test('过滤非正值；无有效数据返回空数组', () => {
    const slices = buildPieSlices([
      { label: 'a', value: 100 },
      { label: 'zero', value: 0 },
      { label: 'neg', value: -50 },
      { label: 'nan', value: NaN },
    ]);
    expect(slices.map((s) => s.label)).toEqual(['a']);

    expect(buildPieSlices([])).toEqual([]);
    expect(buildPieSlices([{ label: 'a', value: 0 }])).toEqual([]);
  });

  test('配色不含绿 / 青绿色系（支出的饼图里绿色容易被当成收入，2026-09-21 用户定稿）', () => {
    // 绿色判定：g 通道显著高于 r，且不明显低于 b（同时覆盖纯绿 #34be8c、
    // 橄榄 #94a15e、青绿 #3fbfc6 这三类 g 主导或 g≈b 的色）。这条钉住的是
    // PIE_COLORS 整体，将来加新色也会被校验。
    const isGreenish = (hex: string): boolean => {
      const n = parseInt(hex.slice(1), 16);
      const r = (n >> 16) & 0xff;
      const g = (n >> 8) & 0xff;
      const b = n & 0xff;
      return g > r + 20 && g + 30 >= b;
    };
    for (const c of PIE_COLORS) expect(isGreenish(c)).toBe(false);
    expect(isGreenish(OTHER_COLOR)).toBe(false);
  });
});

describe('chart · buildMixSegments（占比条）', () => {
  test('与环形图同源：占比之和为 100、文案保留一位小数', () => {
    const segs = buildMixSegments([
      { label: 'a', value: 300 },
      { label: 'b', value: 200 },
      { label: 'c', value: 100 },
    ]);
    expect(segs.map((s) => s.label)).toEqual(['a', 'b', 'c']);
    expect(segs[0].percent).toBe(50);
    expect(segs[0].percentText).toBe('50.0%');
    expect(segs[2].percentText).toBe('16.7%');
  });

  test('默认最多四段，超出合并为「其他」并带灰色', () => {
    const segs = buildMixSegments(
      [
        { label: 'a', value: 500 },
        { label: 'b', value: 400 },
        { label: 'c', value: 300 },
        { label: 'd', value: 200 },
        { label: 'e', value: 100 },
      ],
      3
    );
    expect(segs).toHaveLength(4);
    expect(segs[3].label).toBe('其他');
    expect(segs[3].percent).toBe(20);
    expect(segs[3].color).toBe(OTHER_COLOR);
    expect(segs[0].color).toBe(PIE_COLORS[0]);
  });

  test('无有效数据返回空数组（页面据此整块不占位）', () => {
    expect(buildMixSegments([])).toEqual([]);
    expect(buildMixSegments([{ label: 'a', value: 0 }])).toEqual([]);
  });
});

describe('chart · hitTestSlice', () => {  const slices: PieSlice[] = buildPieSlices([
    { label: 'a', value: 200 },
    { label: 'b', value: 100 },
  ]);
  const cx = 100;
  const cy = 100;
  const inner = 40;
  const outer = 80;

  test('12 点方向命中第一个分片（起始扇区）', () => {
    expect(hitTestSlice(slices, cx, cy - 60, cx, cy, inner, outer)).toBe(0);
  });

  test('正右方向落在第一个分片覆盖的角度内', () => {
    // 第一个分片占 2/3 = 240°，从 -90° 到 150°，0° 在其中
    expect(hitTestSlice(slices, cx + 60, cy, cx, cy, inner, outer)).toBe(0);
  });

  test('左下方向落在第二个分片（150°~270°）', () => {
    const rad = (200 * Math.PI) / 180;
    const x = cx + 60 * Math.cos(rad);
    const y = cy + 60 * Math.sin(rad);
    expect(hitTestSlice(slices, x, y, cx, cy, inner, outer)).toBe(1);
  });

  test('环内空心处与环外都不命中', () => {
    // 半径 20 < inner
    expect(hitTestSlice(slices, cx, cy - 20, cx, cy, inner, outer)).toBe(-1);
    // 半径 200 > outer
    expect(hitTestSlice(slices, cx, cy - 200, cx, cy, inner, outer)).toBe(-1);
  });

  test('normalizeAngle 把负角归一到 [0, 2π)', () => {
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo(Math.PI * 1.5, 10);
    expect(normalizeAngle(Math.PI * 2.5)).toBeCloseTo(Math.PI * 0.5, 10);
    expect(normalizeAngle(0)).toBe(0);
  });
});

describe('stats · sumByCategory', () => {
  test('按标签汇总金额与笔数，空标签归入未分类，金额倒序', () => {
    const records = [
      rec({ type: LedgerType.Expense, amount: 1000, tag: '餐饮' }),
      rec({ type: LedgerType.Expense, amount: 500, tag: '餐饮' }),
      rec({ type: LedgerType.Expense, amount: 3000, tag: '交通' }),
      rec({ type: LedgerType.Expense, amount: 200, tag: '' }),
      rec({ type: LedgerType.Income, amount: 99999, tag: '工资' }),
    ];

    const sums = sumByCategory(records, LedgerType.Expense);
    expect(sums.map((s) => s.label)).toEqual(['交通', '餐饮', '未分类']);
    expect(sums[0].value).toBe(3000);
    expect(sums[1].value).toBe(1500);
    expect(sums[1].count).toBe(2);
    expect(sums[2].value).toBe(200);
  });

  test('只统计指定收支类型', () => {
    const records = [
      rec({ type: LedgerType.Income, amount: 5000, tag: '工资' }),
      rec({ type: LedgerType.Expense, amount: 1000, tag: '餐饮' }),
    ];
    const income = sumByCategory(records, LedgerType.Income);
    expect(income).toHaveLength(1);
    expect(income[0].label).toBe('工资');
  });

  test('跳过非正金额', () => {
    const records = [
      rec({ type: LedgerType.Expense, amount: 0, tag: '零' }),
      rec({ type: LedgerType.Expense, amount: -5, tag: '负' }),
      rec({ type: LedgerType.Expense, amount: 100, tag: '正常' }),
    ];
    expect(sumByCategory(records, LedgerType.Expense).map((s) => s.label)).toEqual(['正常']);
  });
});

describe('date · shiftMonth / monthLabel', () => {
  test('跨年与跨月偏移', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-03', 0)).toBe('2026-03');
    expect(shiftMonth('2026-03', -3)).toBe('2025-12');
  });

  test('非法输入原样返回，不抛错', () => {
    expect(shiftMonth('bad', 1)).toBe('bad');
  });

  test('月份文案不带前导零', () => {
    expect(monthLabel('2026-09')).toBe('2026年9月');
    expect(monthLabel('2026-12')).toBe('2026年12月');
  });
});

describe('chart · linePoints', () => {
  test('x 等距铺满，y 按最大值压缩到顶部', () => {
    const pts = linePoints([0, 50, 100], 100, 40, 10, 5, 5);
    expect(pts).toHaveLength(3);
    expect(pts[0].x).toBeCloseTo(10);
    expect(pts[2].x).toBeCloseTo(90);
    expect(pts[2].y).toBeCloseTo(5); // 最大值贴顶
    expect(pts[0].y).toBeCloseTo(35); // 0 值贴底
    expect(pts[1].y).toBeCloseTo(20); // 中间值在中点
  });

  test('全 0 序列画贴底平线（以 1 为基准，不除零）', () => {
    const pts = linePoints([0, 0, 0], 100, 40, 10, 5, 5);
    pts.forEach((p) => expect(p.y).toBeCloseTo(35));
  });

  test('空序列与非法尺寸返回空数组', () => {
    expect(linePoints([], 100, 40, 10, 5, 5)).toEqual([]);
    expect(linePoints([1, 2], 0, 40, 10, 5, 5)).toEqual([]);
  });

  test('单点序列落在左留白处', () => {
    const pts = linePoints([100], 100, 40, 10, 5, 5);
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBeCloseTo(10);
    expect(pts[0].y).toBeCloseTo(5);
  });
});

describe('chart · nearestLineIndex', () => {
  const pts = [
    { x: 10, y: 0 },
    { x: 50, y: 0 },
    { x: 90, y: 0 },
  ];

  test('命中最近点', () => {
    expect(nearestLineIndex(pts, 8)).toBe(0);
    expect(nearestLineIndex(pts, 48)).toBe(1);
    expect(nearestLineIndex(pts, 120)).toBe(2);
  });

  test('正中取先者（左点）', () => {
    expect(nearestLineIndex(pts, 30)).toBe(0);
  });

  test('空数组返回 -1', () => {
    expect(nearestLineIndex([], 10)).toBe(-1);
  });
});

describe('chart · hexToRgba', () => {
  test('六位十六进制转 rgba', () => {
    expect(hexToRgba('#34be8c', 0.5)).toBe('rgba(52, 190, 140, 0.5)');
    expect(hexToRgba('#EE6C5C', 0)).toBe('rgba(238, 108, 92, 0)');
  });

  test('非法入参原样返回', () => {
    expect(hexToRgba('red', 0.5)).toBe('red');
    expect(hexToRgba('#12345', 0.5)).toBe('#12345');
  });
});
