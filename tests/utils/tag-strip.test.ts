/**
 * 循环标签条几何工具的单测
 */
import {
  buildLayout,
  flingShift,
  nearestCenter,
  phaseToCenter,
  planTween,
  rotateToStart,
  wrapDelta,
  wrapPhase,
} from '../../utils/tag-strip';

describe('buildLayout', () => {
  it('按宽度与间距累加中心点，周长含每项一个间距', () => {
    const { centers, circumference } = buildLayout([100, 50], 10);
    expect(centers).toEqual([50, 135]);
    expect(circumference).toBe(100 + 50 + 10 * 2);
  });

  it('空数组返回零周长且不产生中心点', () => {
    const { centers, circumference } = buildLayout([], 10);
    expect(centers).toEqual([]);
    expect(circumference).toBe(0);
  });
});

describe('wrapPhase', () => {
  const C = 100;

  it('把任意相位折回 [C/2, 3C/2)', () => {
    expect(wrapPhase(50, C)).toBe(50);
    expect(wrapPhase(250, C)).toBe(50);
    expect(wrapPhase(-60, C)).toBe(140);
    expect(wrapPhase(49.9, C)).toBeCloseTo(149.9, 10);
  });

  it('折回前后对环同余（画面等价）', () => {
    for (const raw of [-333, -50, 0, 17, 99, 250, 1234]) {
      const wrapped = wrapPhase(raw, C);
      expect(wrapped).toBeGreaterThanOrEqual(C / 2);
      expect(wrapped).toBeLessThan((C * 3) / 2);
      // toBe 无法区分 0 与 -0，用近似比较验证同余
      expect((wrapped - raw) % C).toBeCloseTo(0, 10);
    }
  });
});

describe('wrapDelta', () => {
  const C = 100;

  it('取最短有向差：正差不超过半周，负差用反方向替代', () => {
    expect(wrapDelta(40, C)).toBe(40);
    expect(wrapDelta(60, C)).toBe(-40);
    expect(wrapDelta(-60, C)).toBe(40);
    expect(wrapDelta(140, C)).toBe(40);
  });

  it('结果恒在 (-C/2, C/2]', () => {
    for (const d of [-120, -51, 0, 51, 260]) {
      const r = wrapDelta(d, C);
      expect(r).toBeGreaterThan(-C / 2);
      expect(r).toBeLessThanOrEqual(C / 2);
    }
  });
});

describe('nearestCenter', () => {
  // 环：两项，宽 100/50，间距 10 → centers=[50,135]，C=170，中间份起点 = 170
  const { centers, circumference } = buildLayout([100, 50], 10);
  const base = circumference;

  it('正中时 delta 为 0', () => {
    expect(nearestCenter(centers, base, base + 50, circumference)).toEqual({ index: 0, delta: 0 });
  });

  it('跨拷贝取模找最近项', () => {
    // pos = 250：第 0 项的等价中心在 220（或 390），delta = -30
    expect(nearestCenter(centers, base, 250, circumference)).toEqual({ index: 0, delta: -30 });
    // pos = 60：第 0 项的等价中心在 50，delta = -10（比第 1 项的 75 更近）
    expect(nearestCenter(centers, base, 60, circumference)).toEqual({ index: 0, delta: -10 });
  });

  it('恰在两midpoint 时取先到的最近项（delta 唯一即可）', () => {
    const { index, delta } = nearestCenter(centers, base, base + 92.5, circumference);
    expect(Math.abs(delta)).toBe(42.5);
    expect([0, 1]).toContain(index);
  });
});

describe('phaseToCenter', () => {
  const { centers, circumference } = buildLayout([100, 50], 10);

  it('给出现相位到目标项居中的最短目标相位', () => {
    const current = 200;
    const target = phaseToCenter(current, circumference + centers[1], circumference);
    // 目标相位与"第 1 项中心"对环同余（toBe 无法区分 0 与 -0，用近似比较）
    expect((target - (circumference + centers[1])) % circumference).toBeCloseTo(0, 10);
    // 且移动距离为最短
    expect(Math.abs(target - current)).toBeLessThanOrEqual(circumference / 2);
  });
});

describe('planTween（相位越界空白 + 异常滚回的回归）', () => {
  const C = 490;
  const safeMin = 170; // 半个容器宽（容器 340 < 环周长 490）

  it('位移取最短：目标是"就近等价"的那一份', () => {
    const fwd = planTween(200, 200 + 40, C, safeMin);
    expect(fwd.to - fwd.from).toBeCloseTo(40, 6);
    expect(fwd.shift).toBe(false);

    const back = planTween(200, 200 - 40, C, safeMin);
    expect(back.to - back.from).toBeCloseTo(-40, 6);
  });

  it('目标落在环的另一侧时走反向短路径', () => {
    // 目标等价相位在 -60，比 +430 近得多
    const { to, from } = planTween(200, 200 - 60, C, safeMin);
    expect(to - from).toBeCloseTo(-60, 6);
  });

  it('起止点都在安全区内时不平移（保证过渡不白扫一圈）', () => {
    const { from, to, shift } = planTween(300, 330, C, safeMin);
    expect(shift).toBe(false);
    expect(from).toBe(300);
    expect(to).toBe(330);
  });

  it('越界时整体平移，且平移后两点都留在渲染安全区内、位移不变', () => {
    // 起点贴安全区下界、目标再往下 → 不处理就会滑出覆盖范围
    const { from, to, shift } = planTween(safeMin, safeMin - 100, C, safeMin);
    expect(shift).toBe(true);
    expect(to - from).toBeCloseTo(-100, 6); // 位移不变
    for (const p of [from, to]) {
      expect(p).toBeGreaterThanOrEqual(safeMin - 1e-6);
      expect(p).toBeLessThanOrEqual(3 * C - safeMin + 1e-6);
    }
    // 平移对环同余：画面等价
    expect((from - safeMin) % C).toBeCloseTo(0, 6);
  });

  it('连续同向快速滑动：每步都不越界、不累积漂移', () => {
    let p = planTween(1.5 * C, 1.5 * C, C, safeMin).to;
    for (let i = 0; i < 60; i++) {
      const step = -0.45 * C; // 每次都朝同一方向甩接近半个环
      const plan = planTween(p, p + step, C, safeMin);
      expect(plan.from).toBeGreaterThanOrEqual(safeMin - 1e-6);
      expect(plan.from).toBeLessThanOrEqual(3 * C - safeMin + 1e-6);
      expect(plan.to).toBeGreaterThanOrEqual(safeMin - 1e-6);
      expect(plan.to).toBeLessThanOrEqual(3 * C - safeMin + 1e-6);
      expect(plan.to - plan.from).toBeCloseTo(step, 6); // 位移始终等于预期
      p = plan.to;
    }
  });

  it('周长非法时原样返回，不产生 NaN', () => {
    expect(planTween(3, 7, 0)).toEqual({ from: 3, to: 7, shift: false });
  });
});

describe('rotateToStart', () => {
  it('把第 k 项转到开头（不可变）', () => {
    const src = ['a', 'b', 'c', 'd'];
    expect(rotateToStart(src, 0)).toEqual(['a', 'b', 'c', 'd']);
    expect(rotateToStart(src, 3)).toEqual(['d', 'a', 'b', 'c']);
    expect(rotateToStart(src, 5)).toEqual(['b', 'c', 'd', 'a']); // 5 mod 4 = 1
    expect(rotateToStart(src, -1)).toEqual(['d', 'a', 'b', 'c']);
    expect(src).toEqual(['a', 'b', 'c', 'd']); // 源数组不被修改
  });

  it('空数组安全', () => {
    expect(rotateToStart([], 2)).toEqual([]);
  });
});

describe('flingShift（快速滑动的异常回弹回归）', () => {
  // 默认 6 标签 + 加号 = 7 项，项距 70px → 周长 490px
  const pitch = 70;
  const C = pitch * 7;
  const MOMENTUM_MS = 140;
  const MAX_ITEMS = 3;
  const RATIO = 0.4;

  it('方向与手指一致：手指向右（v > 0）→ 相位减小（轨道右移）', () => {
    expect(flingShift(0.5, MOMENTUM_MS, pitch, C, MAX_ITEMS, RATIO)).toBeLessThan(0);
    expect(flingShift(-0.5, MOMENTUM_MS, pitch, C, MAX_ITEMS, RATIO)).toBeGreaterThan(0);
  });

  it('极快滑动被夹住，不会被取模翻到反方向', () => {
    // 未夹取时 raw = -3.5 × 140 = -490 ≈ 一整个环，取模后会变成"几乎没动/反向"
    const shift = flingShift(3.5, MOMENTUM_MS, pitch, C, MAX_ITEMS, RATIO);
    expect(shift).toBeCloseTo(-Math.min(pitch * MAX_ITEMS, C * RATIO), 10);
  });

  it('夹取后的位移始终保证落点在滑动方向上（位移 + 半个项距 < 半个环）', () => {
    for (const v of [-20, -5, -3.5, -0.2, 0, 0.2, 3.5, 5, 20]) {
      for (const ringLen of [7, 10, 21]) {
        const c = pitch * ringLen;
        const shift = flingShift(v, MOMENTUM_MS, pitch, c, MAX_ITEMS, RATIO);
        // 最远落点距当前相位不超过半个环 → 最近的等价目标不会跳到环的另一侧
        expect(Math.abs(shift) + pitch / 2).toBeLessThan(c / 2);
      }
    }
  });

  it('慢速小幅滑动保持原样（不被夹取干扰）', () => {
    expect(flingShift(0.01, MOMENTUM_MS, pitch, C, MAX_ITEMS, RATIO)).toBeCloseTo(-1.4, 10);
  });
});
