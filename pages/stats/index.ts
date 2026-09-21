import { ledgerStore } from '../../store/ledger.store';
import { settingsStore } from '../../store/settings.store';
import { formatMoney } from '../../utils/money';
import { dateLabel, monthLabel, monthOf, shiftDate, shiftMonth, today, weekdayLabel } from '../../utils/date';
import { pickByLabels, sumByCategory, buildDailySeries, comparePeriods, monthTickLabels } from '../../utils/stats';
import type { DailyPoint } from '../../utils/stats';
import { groupByDate } from '../../utils/group';
import { buildPieSlices, hitTestSlice, linePoints, nearestLineIndex, hexToRgba } from '../../utils/chart';
import type { PieSlice, LinePoint } from '../../utils/chart';
import { haptic } from '../../utils/haptics';
import { LedgerType } from '../../types/models';
import type { LedgerRecord } from '../../types/models';
import {
  LIGHT_COLORS,
  DARK_COLORS,
  isDarkTheme,
  applyPageTheme,
  attachPageTheme,
  detachPageTheme,
} from '../../utils/theme';

/** 环形内径相对外径的比例（越接近 1 环越细） */
const INNER_RATIO = 0.62;
/** 高亮扇区向外扩张的像素 */
const ACTIVE_GROW = 4;

/** 图例行 = 分片 + 展示文案 */
interface LegendRow {
  label: string;
  color: string;
  ratioText: string;
  valueText: string;
}

/**
 * 分类明细的一个日期分组（视图模型）
 *
 * 记录项直接放原始 LedgerRecord，交给 `ledger-card` 渲染——这样统计页的明细
 * 与记账列表是**同一张卡片、同一套样式**（徽标 + 标签/时间 + 备注 + 金额），
 * 视觉上完全一致，而不是另起一套平铺文案。
 */
interface DetailGroup {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 分组头标签：今天 9月19日 / 昨天 9月18日 / 9月14日（跨年带年份） */
  label: string;
  /** 当日小计文案（含货币符号） */
  sumText: string;
  /** 该日记录（原始记录，交给 ledger-card 渲染） */
  items: LedgerRecord[];
  /** 分组入场动画延迟（毫秒） */
  delay: number;
}

/** 页面 data */
interface StatsData {
  /** 查看粒度：整月 / 单日 */
  mode: 'month' | 'day';
  /** 当前月份 YYYY-MM（单日模式取其所在月，月份口径始终成立） */
  month: string;
  /** 单日模式下的日期 YYYY-MM-DD；整月模式为空串 */
  date: string;
  /** 头部主文案（整月「2026年9月」/ 单日「2026年9月15日」） */
  rangeLabel: string;
  /** 头部次要文案（单日「周二」；整月为空） */
  rangeSub: string;
  /** 是否单日模式 */
  isDay: boolean;
  /** 日期选择器的当前值（整月模式用当月 1 号占位） */
  pickValue: string;
  /** 日期选择器可选的最早日期（有记录就从最早那条开始，省得在空白年月里长划） */
  minDate: string;
  /** 今天 YYYY-MM-DD（选择器上限，也是"能不能往后翻"的判据） */
  todayStr: string;
  /** 是否还能往后翻（不超过今天） */
  canNext: boolean;
  /** 当前收支类型 */
  type: LedgerType;
  /** 是否在看待收入 */
  isIncome: boolean;
  /** 是否有数据 */
  hasData: boolean;
  /** 空态文案 */
  emptyText: string;
  /** 图例行 */
  rows: LegendRow[];
  /** 高亮的分片下标；-1 表示未选中（显示合计） */
  activeIndex: number;
  /** 分类明细折叠容器高度（px，syncDetailHeight 实测写入；0 = 收起） */
  detailH: number;
  /** 明细内容版本号：奇偶交替的 detail--t* class 强制重播内容过渡动画 */
  detailTick: number;
  /** 当前展开的分类名（明细标题） */
  detailLabel: string;
  /** 分类明细总笔数（标题右侧的「共 N 笔」） */
  detailCount: number;
  /** 分类明细（按日期分组，日期倒序） */
  detailGroups: DetailGroup[];
  /** 中心标题 */
  centerLabel: string;
  /** 中心金额 */
  centerValue: string;
  /** 中心辅助文案 */
  centerHint: string;
  /** 是否显示每日趋势卡（仅整月模式且有数据） */
  showTrend: boolean;
  /** 趋势图 X 轴刻度标签（如 ['1日', '8日', '15日', '23日', '30日']） */
  trendTicks: string[];
  /** 趋势选中气泡（第一次点按 = 只选中不跳页，气泡里预览日期与金额） */
  trendSel: TrendSelView;
  /** 与上月对比的文案；空串不显示 */
  compareText: string;
  /** 对比文案的语义色分类 */
  compareKind: CompareKind;
  /** 货币符号 */
  currency: string;
  pageStyle: string;
  pageBg: string;
  navBarBg: string;
  navBarColor: 'black' | 'white';
}

/** 对比文案的语义色：按"好坏"而非"涨跌"——支出变多是坏（红），收入变多是好（绿） */
type CompareKind = 'good' | 'bad' | 'flat' | 'none';

/** 画布几何（逻辑像素，已按 dpr 反缩放） */
interface ChartGeometry {
  size: number;
  cx: number;
  cy: number;
  inner: number;
  outer: number;
}

/** 趋势画布几何（全宽矩形） */
interface TrendGeometry {
  w: number;
  h: number;
}

/** 趋势选中气泡视图（x/y 为画布容器内的 px 定位） */
interface TrendSelView {
  /** 未选中任何天时不显示 */
  enabled: boolean;
  /** 气泡锚点 x（已收边，防止气泡出卡片） */
  x: number;
  /** 气泡锚点 y */
  y: number;
  /** 点在上方时向上弹出（贴顶的点改为向下弹） */
  above: boolean;
  /** 「9月15日 · ¥120.50」 */
  text: string;
}

/** 页面自定义实例字段与方法 */
interface StatsCustom {
  /** 当前分片（绘制与命中判定共用同一份数据） */
  slices: PieSlice[];
  /** 画布几何 */
  geo: ChartGeometry | null;
  /** 画布 2d 上下文 */
  ctx: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D | null;
  /** 本次汇总的原始分类（用于把笔数映射到分片） */
  sums: Array<{ label: string; value: number; count: number }>;
  /** 趋势画布 2d 上下文 */
  trendCtx: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D | null;
  /** 趋势画布几何 */
  trendGeo: TrendGeometry | null;
  /** 当前整月的每日序列（绘制与命中共用） */
  trendSeries: DailyPoint[];
  /** 趋势折线坐标（tap 命中用） */
  trendPts: LinePoint[];
  /** 趋势当前选中的天（下标）；-1 = 未选中 */
  trendSelIndex: number;
  /** 选中态自动取消的定时器 */
  trendSelTimer: ReturnType<typeof setTimeout> | null;
  /** 画布在页面中的左偏移（tap=页面坐标 / touch=视口坐标 → 画布内坐标都靠它换算） */
  trendRect: { left: number } | null;
  refresh(): void;
  initCanvas(cb?: () => void): void;
  draw(): void;
  initTrendCanvas(cb?: () => void): void;
  drawTrend(): void;
  onTrendTap(e: { detail: { x: number; y: number } }): void;
  /** 按住拖动：虚线与气泡实时跟随手指（选中最近的一天） */
  onTrendTouchStart(e: { touches: Array<{ x: number }> }): void;
  onTrendTouchMove(e: { touches: Array<{ x: number }> }): void;
  /** 选中某天（高亮 + 气泡；已选中的天不重复触发） */
  selectTrendIndex(i: number): void;
  /** 取消趋势选中态（含定时器清理） */
  clearTrendSel(cb?: () => void): void;
  onTrendBubbleTap(): void;
  /** 从趋势卡跳到某天的单日统计（跳前先收掉选中态） */
  jumpFromTrend(i: number): void;
  paintCenter(): void;
  setType(e: { currentTarget: { dataset: { type: string } } }): void;
  onPrevRange(): void;
  onNextRange(): void;
  goDay(date: string): void;
  onPickDate(e: { detail: { value: string } }): void;
  onBackToMonth(): void;
  onLegendTap(e: { currentTarget: { dataset: { i: string | number } } }): void;
  onSliceTap(e: { detail: { x: number; y: number } }): void;
  /** 收起分类明细（高度过渡到 0；内容保留在折叠容器里被裁掉） */
  collapseDetail(): void;
  /** 实测明细内容高度并写回 detailH（展开与切换分类共用） */
  syncDetailHeight(): void;
  countOfSlice(index: number): number;
  goAdd(): void;
}

Page<StatsData, StatsCustom>({
  slices: [],
  geo: null,
  ctx: null,
  sums: [],
  trendCtx: null,
  trendGeo: null,
  trendSeries: [],
  trendPts: [],
  trendSelIndex: -1,
  trendRect: null,
  trendSelTimer: null,

  data: {
    mode: 'month',
    month: '',
    date: '',
    rangeLabel: '',
    rangeSub: '',
    isDay: false,
    pickValue: '',
    minDate: '2000-01-01',
    todayStr: '',
    canNext: false,
    type: LedgerType.Expense,
    isIncome: false,
    hasData: false,
    emptyText: '这个月还没有记录',
    rows: [] as LegendRow[],
    activeIndex: -1,
    detailH: 0,
    detailTick: 0,
    detailLabel: '',
    detailCount: 0,
    detailGroups: [] as DetailGroup[],
    centerLabel: '支出合计',
    centerValue: '¥0.00',
    centerHint: '',
    showTrend: false,
    trendTicks: [] as string[],
    trendSel: { enabled: false, x: 0, y: 0, above: true, text: '' } as TrendSelView,
    compareText: '',
    compareKind: 'none' as CompareKind,
    currency: '¥',
    pageStyle: '',
    pageBg: LIGHT_COLORS.pageBg,
    navBarBg: LIGHT_COLORS.pageBg,
    navBarColor: 'black',
  },

  onLoad() {
    attachPageTheme(this);
    const month = monthOf();
    this.setData({
      month,
      todayStr: today(),
      pickValue: month + '-01',
      rangeLabel: monthLabel(month),
    });
  },

  onUnload() {
    this.clearTrendSel();
    detachPageTheme(this);
  },

  onShow() {
    ledgerStore.load();
    settingsStore.load();
    this.refresh();
    applyPageTheme(this);
    // 页面尺寸/主题可能变化，重新取一次画布尺寸再画
    this.initCanvas();
  },

  /**
   * 重新计算分片、图例与中心文案
   *
   * 整月 / 单日只差一个过滤条件：口径一致，聚合、分片、图例、命中判定完全复用。
   * 单日模式下把 `month` 一并钉到所选日期所在月，「看整月」才会回到正确的那一个月。
   */
  refresh() {
    const { mode, month, date, type } = this.data;
    const cur = settingsStore.settings.currency;
    const todayStr = this.data.todayStr || today();
    const isDay = mode === 'day';

    const scoped = ledgerStore.records.filter((r) =>
      isDay ? r.date === date : r.date.slice(0, 7) === month
    );
    const sums = sumByCategory(scoped, type);
    this.sums = sums;

    const slices = buildPieSlices(sums.map((s) => ({ label: s.label, value: s.value })));
    this.slices = slices;

    const total = sums.reduce((acc, s) => acc + s.value, 0);
    const count = sums.reduce((acc, s) => acc + s.count, 0);
    const isIncome = type === LedgerType.Income;

    const rows: LegendRow[] = slices.map((s) => ({
      label: s.label,
      color: s.color,
      ratioText: (s.ratio * 100).toFixed(1) + '%',
      valueText: formatMoney(s.value, cur),
    }));

    // 没有数据时画布节点会被移除，这里同步作废上下文，避免下次拿着旧节点画（画不出来）
    if (!slices.length) {
      this.ctx = null;
      this.geo = null;
    }

    // ===== 每日趋势与上月对比（仅整月模式且有数据） =====
    const showTrend = !isDay && slices.length > 0;
    let trendSeries: DailyPoint[] = [];
    let compareText = '';
    let compareKind: CompareKind = 'none';
    if (showTrend) {
      trendSeries = buildDailySeries(scoped, month, type);
      // 上月同期口径：看当前月只比到"同一天"为止（9月20日比上月 1–20 日），看过去的月份则整月比整月
      const prevMonth = shiftMonth(month, -1);
      const prevSeries = buildDailySeries(ledgerStore.records, prevMonth, type);
      const cutDays =
        month === monthOf() && todayStr.slice(0, 7) === month ? Number(todayStr.slice(8, 10)) : trendSeries.length;
      const prevTotal = prevSeries.slice(0, cutDays).reduce((acc, p) => acc + p.value, 0);
      const cmp = comparePeriods(total, prevTotal);
      if (cmp.previous <= 0) {
        compareText = `上月同期暂无${isIncome ? '收入' : '支出'}`;
        compareKind = 'none';
      } else if (cmp.diff === 0) {
        compareText = '与上月同期持平';
        compareKind = 'flat';
      } else {
        const up = cmp.diff > 0;
        const word = isIncome ? (up ? '多挣' : '少挣') : up ? '多花' : '少花';
        const pct = cmp.ratio !== null ? `（${up ? '+' : ''}${(cmp.ratio * 100).toFixed(1)}%）` : '';
        compareText = `比上月同期${word} ${formatMoney(Math.abs(cmp.diff), cur)}${pct}`;
        // 语义色按"好坏"定：支出变多=坏（红）、收入变多=好（绿）
        compareKind = (isIncome ? up : !up) ? 'good' : 'bad';
      }
    } else {
      // 单日模式：趋势画布节点被移除，作废上下文；选中态与刻度一并复位
      this.trendCtx = null;
      this.trendGeo = null;
      this.trendPts = [];
      this.clearTrendSel();
    }
    this.trendSeries = trendSeries;
    // 换月 / 切粒度 / 切收支类型都视为"重新进入视图"：选中态立即取消（定时器一并清理）
    this.clearTrendSel();
    const trendTicks = showTrend ? monthTickLabels(trendSeries.length) : [];

    // 选择器下限跟着数据走：有记录就从最早那条开始，省得在空白年月里长划
    const dates = ledgerStore.records.map((r) => r.date).filter(Boolean).sort();
    const rangeLabel = isDay ? dateLabel(date) : monthLabel(month);

    this.setData(
      {
        isIncome,
        isDay,
        rows,
        hasData: slices.length > 0,
        currency: cur,
        rangeLabel,
        rangeSub: isDay ? weekdayLabel(date) : '',
        pickValue: isDay ? date : month + '-01',
        month: isDay ? date.slice(0, 7) : month,
        minDate: dates.length ? dates[0] : '2000-01-01',
        todayStr,
        emptyText: `${rangeLabel}还没有${isIncome ? '收入' : '支出'}记录`,
        activeIndex: -1,
        // 重算即视为"重新进入该视图"：明细折叠容器直接归零（页面在重建视图，不需要过渡）
        detailH: 0,
        detailLabel: '',
        detailCount: 0,
        detailGroups: [] as DetailGroup[],
        centerLabel: isIncome ? '收入合计' : '支出合计',
        centerValue: formatMoney(total, cur),
        centerHint: count ? `共 ${count} 笔 · ${rows.length} 个分类` : '',
        showTrend,
        trendTicks,
        trendSel: { enabled: false, x: 0, y: 0, above: true, text: '' } as TrendSelView,
        compareText,
        compareKind,
        canNext: isDay ? date < todayStr : month < monthOf(),
      },
      () => {
        if (!this.data.hasData) return;
        if (this.ctx && this.geo) {
          this.draw();
        } else {
          // 首次渲染（或从空月份切到有数据）时画布节点才刚出现，需要重新取节点
          this.initCanvas();
        }
        // 趋势卡同套路：节点可能刚出现，先试画、取不到节点就重新初始化
        if (this.data.showTrend) {
          if (this.trendCtx && this.trendGeo) {
            this.drawTrend();
          } else {
            this.initTrendCanvas();
          }
        }
      }
    );
  },

  /**
   * 初始化画布（取节点 + 按 dpr 设置物理像素）
   * @param cb 初始化完成后的回调
   */
  initCanvas(cb?: () => void) {
    wx.createSelectorQuery()
      .select('#pie')
      .fields({ node: true, size: true })
      .exec((res) => {
        const info = res && (res[0] as { node?: unknown; width?: number; height?: number } | null);
        const node = info?.node as WechatMiniprogram.Canvas | undefined;
        if (!node || !info?.width || !info?.height) return;

        const canvas = node;
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
        canvas.width = info.width * dpr;
        canvas.height = info.height * dpr;

        const ctx = canvas.getContext('2d');
        // 之后所有绘制都用逻辑像素，dpr 在这里一次性抵消
        ctx.scale(dpr, dpr);
        this.ctx = ctx;

        const size = Math.min(info.width, info.height);
        const outer = size / 2 - ACTIVE_GROW - 2;
        this.geo = { size, cx: size / 2, cy: size / 2, inner: outer * INNER_RATIO, outer };
        this.draw();
        cb?.();
      });
  },

  /** 绘制环形图：未选中时等高，选中时该扇区外扩、其余降低不透明度 */
  draw() {
    const ctx = this.ctx;
    const geo = this.geo;
    if (!ctx || !geo) return;

    const { size, cx, cy, inner, outer } = geo;
    const active = this.data.activeIndex;
    ctx.clearRect(0, 0, size, size);

    this.slices.forEach((s, i) => {
      const isActive = active === i;
      ctx.globalAlpha = active >= 0 && !isActive ? 0.26 : 1;
      const r = isActive ? outer + ACTIVE_GROW : outer;

      ctx.beginPath();
      ctx.arc(cx, cy, r, s.startAngle, s.endAngle);
      // 反向画内弧，形成一个环扇区
      ctx.arc(cx, cy, inner, s.endAngle, s.startAngle, true);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
    });

    ctx.globalAlpha = 1;
  },

  /**
   * 初始化趋势画布（取节点 + 按 dpr 设置物理像素）
   * @param cb 初始化完成后的回调
   */
  initTrendCanvas(cb?: () => void) {
    wx.createSelectorQuery()
      .select('#trend')
      .fields({ node: true, size: true, rect: true })
      .exec((res) => {
        const info = res && (res[0] as { node?: unknown; width?: number; height?: number; left?: number } | null);
        const node = info?.node as WechatMiniprogram.Canvas | undefined;
        if (!node || !info?.width || !info?.height) return;

        const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
        node.width = info.width * dpr;
        node.height = info.height * dpr;
        const ctx = node.getContext('2d');
        ctx.scale(dpr, dpr);
        this.trendCtx = ctx;
        this.trendGeo = { w: info.width, h: info.height };
        // 只有 tap 的 detail.x/y 是页面坐标需要减偏移；
        // canvas 触摸事件的 touches[0].x/y 本身就是画布内坐标，别减（见触摸方法注释）
        this.trendRect = { left: typeof info.left === 'number' ? info.left : 0 };
        this.drawTrend();
        cb?.();
      });
  },

  /**
   * 绘制每日趋势折线
   *
   * 颜色取当前主题的实色令牌（canvas 画不了 CSS 变量）：
   * 支出用 danger、收入用 primary，与分段控件选中色一致。
   */
  drawTrend() {
    const ctx = this.trendCtx;
    const geo = this.trendGeo;
    const series = this.trendSeries;
    if (!ctx || !geo || !series.length) return;

    const c = isDarkTheme() ? DARK_COLORS : LIGHT_COLORS;
    const lineColor = this.data.isIncome ? c.primary : c.danger;
    const PAD_X = 8;
    const PAD_TOP = 10;
    const PAD_BOTTOM = 6;
    const baseY = geo.h - PAD_BOTTOM;

    const pts = linePoints(series.map((p) => p.value), geo.w, geo.h, PAD_X, PAD_TOP, PAD_BOTTOM);
    this.trendPts = pts;
    ctx.clearRect(0, 0, geo.w, geo.h);

    // 基线
    ctx.strokeStyle = c.borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baseY + 0.5);
    ctx.lineTo(geo.w, baseY + 0.5);
    ctx.stroke();

    // 折线下方的渐变面积：给"走势"一点体量感，又不抢环形图的视觉主角
    const grad = ctx.createLinearGradient(0, PAD_TOP, 0, baseY);
    grad.addColorStop(0, hexToRgba(lineColor, 0.18));
    grad.addColorStop(1, hexToRgba(lineColor, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, baseY);
    pts.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length - 1].x, baseY);
    ctx.closePath();
    ctx.fill();

    // 折线本体
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();

    // 最高的一天：圆点标记（外圈描卡片底色，别和线糊在一起）
    let maxI = 0;
    series.forEach((p, i) => {
      if (p.value > series[maxI].value) maxI = i;
    });
    if (series[maxI].value > 0) {
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.arc(pts[maxI].x, pts[maxI].y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = c.cardBg;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 选中的天：垂直虚线参考线 + 放大圆环——跳转前后的视觉锚点是同一套语言
    const sel = this.trendSelIndex;
    if (sel >= 0 && sel < pts.length) {
      const p = pts[sel];
      ctx.save();
      ctx.strokeStyle = c.subTextColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(p.x + 0.5, PAD_TOP);
      ctx.lineTo(p.x + 0.5, baseY);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = c.cardBg;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  },

  /** 取消趋势选中态（含定时器清理）；没有选中且无回调时不做多余的 setData */
  clearTrendSel(cb?: () => void) {
    if (this.trendSelTimer) {
      clearTimeout(this.trendSelTimer);
      this.trendSelTimer = null;
    }
    this.trendSelIndex = -1;
    if (!this.data.trendSel.enabled && !cb) return;
    this.setData(
      { trendSel: { enabled: false, x: 0, y: 0, above: true, text: '' } as TrendSelView },
      cb
    );
  },

  /**
   * 点趋势线 = 选中该天（高亮 + 气泡预览「日期 · 金额」）；点别的天 = 改选。
   * 跳转只认点气泡（onTrendBubbleTap），轻点永远不跳，杜绝误触。
   */
  onTrendTap(e: { detail: { x: number; y: number } }) {
    if (!this.trendPts.length) return;
    // tap 的 detail.x 是页面坐标，先换算成画布内坐标再命中
    const x = e.detail.x - (this.trendRect?.left ?? 0);
    this.selectTrendIndex(nearestLineIndex(this.trendPts, x));
  },

  /**
   * 按住拖动选择：touchstart / touchmove 都选中离手指最近的一天，
   * 虚线与气泡实时跟随（move 中下标变化才重画，静止按住不刷屏）。
   * 拖动只负责选中，跳转只认点气泡。
   *
   * ⚠️ 坐标系不对称：canvas 触摸事件的 touches[0].x/y 是**画布内坐标**
   * （canvas 组件对 touch 事件保留了专属语义），直接用、不要减偏移；
   * tap 的 detail.x/y 才是页面坐标，需要减 trendRect.left（见 onTrendTap）。
   */
  onTrendTouchStart(e: { touches: Array<{ x: number }> }) {
    if (!this.trendPts.length) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    this.selectTrendIndex(nearestLineIndex(this.trendPts, t.x));
  },

  onTrendTouchMove(e: { touches: Array<{ x: number }> }) {
    if (!this.trendPts.length) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const i = nearestLineIndex(this.trendPts, t.x);
    if (i !== this.trendSelIndex) this.selectTrendIndex(i);
  },

  /** 选中某天：画布高亮 + 气泡预览，5 秒无操作自动取消 */
  selectTrendIndex(i: number) {
    const hit = this.trendSeries[i];
    if (!hit || !this.trendGeo) return;
    if (this.trendSelIndex === i) return;
    haptic('light');
    this.trendSelIndex = i;
    const p = this.trendPts[i];
    // 气泡约 160px 宽，锚点收边防止左右出卡片
    const half = 78;
    const x = Math.min(Math.max(p.x, half), this.trendGeo.w - half);
    // 贴顶的点向上弹会出卡片，改为向下弹
    const above = p.y > 56;
    const d = new Date(hit.date + 'T00:00:00');
    const dateText = `${d.getMonth() + 1}月${d.getDate()}日`;
    this.setData({
      trendSel: {
        enabled: true,
        x,
        y: above ? p.y - 10 : p.y + 12,
        above,
        text: `${dateText} · ${formatMoney(hit.value, this.data.currency)}`,
      },
    });
    this.drawTrend();

    // 无操作自动取消，避免选中态一直挂在图上（拖动中每次变格都会重置计时）
    if (this.trendSelTimer) clearTimeout(this.trendSelTimer);
    this.trendSelTimer = setTimeout(() => {
      this.trendSelTimer = null;
      this.clearTrendSel(() => this.drawTrend());
    }, 5000);
  },

  /** 点气泡 = 确认跳转（趋势卡唯一的跳转入口，轻点/拖动都只选中） */
  onTrendBubbleTap() {
    if (this.trendSelIndex < 0) return;
    this.jumpFromTrend(this.trendSelIndex);
  },

  /** 从趋势卡跳到某天的单日统计（跳前先收掉选中态） */
  jumpFromTrend(i: number) {
    const hit = this.trendSeries[i];
    if (!hit) return;
    haptic('light');
    this.clearTrendSel();
    this.goDay(hit.date);
  },

  /** 把中心文案切回合计（未选中任何扇区时） */
  paintCenter() {
    const { isIncome, currency } = this.data;
    const total = this.sums.reduce((acc, s) => acc + s.value, 0);
    const count = this.sums.reduce((acc, s) => acc + s.count, 0);
    this.setData({
      centerLabel: isIncome ? '收入合计' : '支出合计',
      centerValue: formatMoney(total, currency),
      centerHint: count ? `共 ${count} 笔 · ${this.slices.length} 个分类` : '',
    });
  },

  /**
   * 切换支出 / 收入
   * @param e 事件，dataset.type 为类型
   */
  setType(e: { currentTarget: { dataset: { type: string } } }) {
    const type = e.currentTarget.dataset.type === LedgerType.Income ? LedgerType.Income : LedgerType.Expense;
    if (type === this.data.type) return;
    haptic('light');
    this.setData({ type }, () => this.refresh());
  },

  /** 往前翻一格：整月模式退一个月，单日模式退一天 */
  onPrevRange() {
    haptic('light');
    if (this.data.mode === 'day') {
      const prev = shiftDate(this.data.date, -1);
      // 与选择器的 start 一致：翻到最早那条记录就停，别一路退到没有数据的年月
      if (prev < this.data.minDate) return;
      this.goDay(prev);
      return;
    }
    this.setData({ month: shiftMonth(this.data.month, -1) }, () => this.refresh());
  },

  /** 往后翻一格（不超过今天） */
  onNextRange() {
    if (!this.data.canNext) return;
    haptic('light');
    if (this.data.mode === 'day') {
      this.goDay(shiftDate(this.data.date, 1));
      return;
    }
    this.setData({ month: shiftMonth(this.data.month, 1) }, () => this.refresh());
  },

  /**
   * 切到"看某一天"
   * @param date 目标日期 YYYY-MM-DD；超过今天则忽略（上一天/下一天走到明天时自然停住）
   */
  goDay(date: string) {
    if (!date || date > (this.data.todayStr || today())) return;
    this.setData({ mode: 'day', date, pickValue: date }, () => this.refresh());
  },

  /**
   * 选中日期（原生年月日选择器）
   *
   * 选到某天就按那一天统计；它同时也是"快速跳月"的手段——
   * 想看去年的某个月，不必连点十几次箭头。
   *
   * @param e picker 的 change 事件，detail.value 为 YYYY-MM-DD
   */
  onPickDate(e: { detail: { value: string } }) {
    const date = e.detail?.value;
    if (!date || date === this.data.date) return;
    haptic('light');
    this.goDay(date);
  },

  /** 从单日切回整月（看该日期所在的整月） */
  onBackToMonth() {
    haptic('light');
    this.setData({ mode: 'month', date: '' }, () => this.refresh());
  },

  /**
   * 点图例：高亮对应扇区，并展开该分类在当前时间范围内的明细（再点一次收起）
   *
   * 明细按日期分组（复用记账列表的 groupByDate），每组带「今天/昨天/9月17日」分组头
   * 与当日小计；记录用 ledger-card 渲染，样式与记账列表一致。
   *
   * @param e 事件，dataset.i 为分片下标
   */
  onLegendTap(e: { currentTarget: { dataset: { i: string | number } } }) {
    const i = Number(e.currentTarget.dataset.i);
    const slice = this.slices[i];
    if (!slice) return;
    haptic('light');

    // 再点同一分类 → 取消高亮并收起明细（高度过渡到 0，不做卸载式消失）
    if (this.data.activeIndex === i) {
      this.collapseDetail();
      return;
    }

    // 用与汇总完全一致的口径筛明细：当前时间范围 + 收支类型 + 该分类名。
    // 「其他」那块用排除法取——它本质是"被合并进来的小分类"，不是某个具体标签。
    const { mode, month, date, type, currency } = this.data;
    const scoped = ledgerStore.records.filter((r) =>
      mode === 'day' ? r.date === date : r.date.slice(0, 7) === month
    );
    const matched = slice.isOther
      ? pickByLabels(scoped, type, this.sums.map((s) => s.label), { exclude: true })
      : pickByLabels(scoped, type, [slice.label]);

    // 按日期分组（日期倒序、组内时间倒序），delay 驱动分组错峰入场动画
    const groups = groupByDate(matched, this.data.todayStr || today());
    const detailGroups: DetailGroup[] = groups.map((g, idx) => ({
      date: g.date,
      label: g.label,
      sumText: formatMoney(type === LedgerType.Income ? g.income : g.expense, currency),
      items: g.items,
      delay: idx * 60,
    }));

    const count = this.countOfSlice(i);
    this.setData(
      {
        activeIndex: i,
        detailLabel: slice.label,
        detailCount: matched.length,
        detailGroups,
        // 内容版本 +1：detail--t0/t1 交替，强制重播内容淡入（容器高度另行实测过渡）
        detailTick: this.data.detailTick + 1,
        centerLabel: slice.label,
        centerValue: formatMoney(slice.value, currency),
        centerHint: `${(slice.ratio * 100).toFixed(1)}%${count ? ` · ${count} 笔` : ''}`,
      },
      () => {
        this.draw();
        // 内容已按新分类排版：量出实际高度写回 detailH，容器高度从当前值滑到新值
        this.syncDetailHeight();
      }
    );
  },

  /**
   * 点扇区：与点图例等价（半径与角度双重判定）
   * @param e canvas 的 tap 事件，detail.x / detail.y 为画布内坐标
   */
  onSliceTap(e: { detail: { x: number; y: number } }) {
    const geo = this.geo;
    if (!geo) return;
    const hit = hitTestSlice(
      this.slices,
      e.detail.x,
      e.detail.y,
      geo.cx,
      geo.cy,
      geo.inner,
      geo.outer
    );
    if (hit < 0) {
      // 点空白处取消高亮，并收起明细（高度过渡到 0）
      if (this.data.activeIndex >= 0) {
        haptic('light');
        this.collapseDetail();
      }
      return;
    }
    this.onLegendTap({ currentTarget: { dataset: { i: hit } } });
  },

  /**
   * 收起分类明细：容器高度过渡到 0（内容保留在折叠容器里被 overflow 裁掉，
   * 不做卸载式消失 —— 那正是"切换分类割裂感"的来源）
   */
  collapseDetail() {
    this.setData({ detailH: 0, activeIndex: -1 }, () => {
      this.paintCenter();
      this.draw();
    });
  },

  /**
   * 实测明细内容高度并写回 detailH（展开与切换分类共用）
   *
   * 在 setData 回调里调用：此时节点已按新内容排版完毕，量出 `.detail` 的
   * border-box 高度写回 detailH，容器 height 过渡自然从当前高度滑到新高度 ——
   * 多记录分类切到少记录分类时，下方内容平滑跟随不跳变。
   * 量不到（节点不存在）时保持 0，不影响下一次展开。
   */
  syncDetailHeight() {
    wx.createSelectorQuery()
      .select('.detail')
      .boundingClientRect((rect) => {
        const h = rect ? (rect as { height: number }).height : 0;
        if (h > 0 && Math.abs(h - this.data.detailH) > 0.5) {
          this.setData({ detailH: h });
        }
      })
      .exec();
  },

  /**
   * 取某分片包含的笔数
   *
   * buildPieSlices 会把尾部合并成「其他」，这里用"总笔数 − 已知分类笔数"倒推，
   * 避免为了一个数字把聚合结构再拆开。
   *
   * @param index 分片下标
   * @returns 笔数
   */
  countOfSlice(index: number) {
    const slice = this.slices[index];
    if (!slice) return 0;
    if (!slice.isOther) {
      const hit = this.sums.find((s) => s.label === slice.label);
      return hit ? hit.count : 0;
    }
    const totalCount = this.sums.reduce((acc, s) => acc + s.count, 0);
    const known = this.slices
      .filter((s) => !s.isOther)
      .reduce((acc, s) => {
        const hit = this.sums.find((x) => x.label === s.label);
        return acc + (hit ? hit.count : 0);
      }, 0);
    return Math.max(0, totalCount - known);
  },

  /**
   * 空态：去记一笔
   * 带上当前视图的收支类型（编辑页默认处于对应状态）与所选日期：
   * 回看历史月份/某天时新增，编辑页的日期应落在所看的那一天，而不是"今天"——
   * 否则用户得手动把日期改回去（新增日期永远不晚于今天，编辑页侧还有一道钳制）。
   */
  goAdd() {
    haptic('light');
    const typeParam = this.data.type === LedgerType.Income ? 'income' : 'expense';
    const params = [`type=${typeParam}`];
    const curMonth = monthOf();
    if (this.data.mode === 'day') {
      params.push(`date=${this.data.date}`);
    } else if (this.data.month !== curMonth) {
      // 整月模式看历史月：落到该月 1 号（具体哪天用户自己改，但至少月份对了）
      params.push(`date=${this.data.month}-01`);
    }
    wx.navigateTo({ url: `/pages/ledger/edit/index?${params.join('&')}` });
  },
});
