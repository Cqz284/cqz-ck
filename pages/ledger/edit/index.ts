import { ledgerStore } from '../../../store/ledger.store';
import { settingsStore } from '../../../store/settings.store';
import { tagStore } from '../../../store/tag.store';
import { MAX_TAG_LEN } from '../../../service/ledger.service';
import { LedgerType } from '../../../types/models';
import type { LedgerInput } from '../../../types/models';
import { today, nowTime } from '../../../utils/date';
import { isValidAmount, toYuan } from '../../../utils/money';
import { currentBudgetAlert, showBudgetAlertOnce } from '../../../utils/budget-alert';
import { haptic } from '../../../utils/haptics';
import {
  buildLayout,
  flingShift,
  nearestCenter,
  phaseToCenter,
  planTween,
  wrapPhase,
} from '../../../utils/tag-strip';
import { LIGHT_COLORS, applyPageTheme, attachPageTheme, detachPageTheme } from '../../../utils/theme';

/** 判定为拖拽（而非点选）的位移阈值（px） */
const TAP_SLOP = 8;

/** 长按进入管理态的判定时长（毫秒） */
const LONG_PRESS_MS = 450;

/** 松手后的惯性外推时间（毫秒）：投影距离 = 末速 × 该值 */
const MOMENTUM_MS = 140;

/**
 * 惯性最多外推的项数。
 * 必须远小于半个环：外推距离一旦接近半周长，"最近的落点"在环上会翻到反方向，
 * 快速滑动就会出现"甩出去又弹回来"的异常回弹。
 */
const MAX_FLING_ITEMS = 3;

/** 惯性外推距离相对环周长的上限比例（项数少时由它兜底） */
const FLING_LIMIT_RATIO = 0.4;

/** 弹性过渡时长：基础值 + 距离系数，限制在 [MIN, MAX] 内 */
const TWEEN_BASE_MS = 300;
const TWEEN_PER_PX = 0.35;
const TWEEN_MIN_MS = 260;
const TWEEN_MAX_MS = 620;

/** 弹性缓动曲线（带回弹的 overshoot），用于短距离吸附 */
const TWEEN_EASING = 'cubic-bezier(0.22, 1.32, 0.36, 1)';

/** 长距离（惯性滑行）用的柔和曲线：几乎不回弹，避免"甩出去再弹一下" */
const TWEEN_EASING_FAR = 'cubic-bezier(0.22, 1.06, 0.36, 1)';

/** 判定为长距离移动的位移阈值（px） */
const LONG_TWEEN_PX = 140;

/** 速度采样窗口（毫秒）：只用最近这段触摸样本计算末速 */
const VELOCITY_WINDOW_MS = 100;

/** 速度采样上限条数，防止数组无限增长 */
const MAX_SAMPLES = 6;

/** 间距测量失败时的兜底值（px） */
const FALLBACK_GAP = 8;

/**
 * 生成过渡样式：位移越大越柔和
 * @param ms 时长（毫秒）
 * @param dist 位移距离（px）
 * @returns 内联 style 片段
 */
function tweenStyle(ms: number, dist: number): string {
  const easing = dist > LONG_TWEEN_PX ? TWEEN_EASING_FAR : TWEEN_EASING;
  return `transition: transform ${ms}ms ${easing};`;
}

/**
 * easeOutCubic 近似：仅用于「动画进行中手指接管」时估算当前渲染相位
 * @param t 归一化进度 0~1
 * @returns 进度比例
 */
function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

/** 触摸点（只用到 clientX/clientY） */
interface TouchPoint {
  clientX: number
  clientY: number
}

/** 速度采样 */
interface VelocitySample {
  t: number
  x: number
}

/** 标签条渲染项（环 = 标签 + 加号，共渲染 3 份拷贝以实现无缝循环） */
interface StripItem {
  /** wx:key：拷贝内全局唯一 */
  key: number
  /** 环内下标（加号 = tags.length） */
  i: number
  /** 标签文案（加号为空） */
  label: string
  /** 是否加号项 */
  plus: boolean
  /** 正停在中线上 */
  on: boolean
  /** 需要放大强调（含加号居中时） */
  focus: boolean
}

/**
 * 统一取值：Vant 组件的 change 事件 detail 即值本身，原生组件为 detail.value
 * @param e 事件对象
 * @returns 输入值字符串
 */
function pickValue(e: { detail: string | { value?: string } }): string {
  const d = e?.detail;
  if (typeof d === 'string') return d;
  if (d && typeof d.value === 'string') return d.value;
  return '';
}

/** 页面 data */
interface LedgerEditData {
  id: string;
  isEdit: boolean;
  type: LedgerType;
  amount: string;
  date: string;
  /** 记账时间 HH:mm */
  time: string;
  tag: string;
  remark: string;
  /** 标签条渲染项（3 份拷贝） */
  stripItems: StripItem[];
  /** 轨道内联样式（位移 + 过渡），静态行模式下为空串 */
  trackStyle: string;
  /** 几何测量完成前隐藏轨道，避免首帧闪位 */
  stripReady: boolean;
  /**
   * 锁住页面滚动（page-meta disable-scroll）
   * 仅在确认是"横滑标签"时置 true：横滑过程中触摸事件会冒泡，
   * 页面滚动容器会把它当成滚动意图，导致标签横滑时页面跟着上下抖。
   * 纵向手势不锁，照常翻页。
   */
  scrollLocked: boolean;
  /** 静态行模式：标签一屏放得下，不做循环轮转 */
  plainMode: boolean;
  /** 管理态：抖动 + 删除角标 */
  managing: boolean;
  /** 标签列表为空 */
  tagsEmpty: boolean;
  /** 当前货币符号（来自设置，避免在模板里写死 ¥） */
  currency: string;
  pageStyle: string;
  pageBg: string;
  navBarBg: string;
  navBarColor: 'black' | 'white';
}

/** 页面实例的几何/手势内部状态（不进 data，避免多余渲染） */
interface StripState {
  /** 容器宽度（px，测量后赋值） */
  cc: number;
  /** 相邻项间距（px） */
  gap: number;
  /** 各项实测宽度（px，环序） */
  widths: number[];
  /** 各项中心相对单份拷贝起点（px） */
  centers: number[];
  /** 环周长（px） */
  C: number;
  /** 当前相位：轨道坐标系中对准容器中线的 x */
  p: number;
  /** 环周长 ≤ 容器宽度：改用静态行，不做循环 */
  plain: boolean;
  /** 当前选中的标签下标（-1 = 无）：决定高亮色、输入框内容与持久化 */
  sel: number;
  /** 当前停在中线的项下标（-1 = 无）：只决定缩放强调，与选中解耦 */
  center: number;
  /** 手势状态 */
  dragging: boolean;
  moved: boolean;
  axis: '' | 'x' | 'y';
  startX: number;
  startY: number;
  startP: number;
  samples: VelocitySample[];
  /** 当前弹性动画的起点/终点相位与时长（用于动画中途接管） */
  tweenFrom: number;
  tweenTo: number;
  tweenStart: number;
  tweenDur: number;
  /** 动画令牌：用于作废"静默落位后延迟启动"的过期回调 */
  tweenToken: number;
  /** 长按判定定时器 */
  lpTimer: ReturnType<typeof setTimeout> | null;
}

/** 页面自定义实例字段与方法 */
interface LedgerEditCustom extends StripState {
  /** 生成标签条渲染项（3 份拷贝） */
  buildStrip(): StripItem[];
  /** 更新轨道位移与过渡（静态行模式下为空） */
  updateTrack(animate: boolean, dur?: number, dist?: number): void;
  /** 估算当前实际渲染的相位（动画进行中时做插值，供手指接管） */
  currentPhase(): number;
  /** 测量容器与各项宽度，重建布局几何；完成后回调 */
  measure(after?: () => void): void;
  /**
   * 弹性动画到目标相位
   * @param target 目标相位（任意量纲）
   * @param centerIdx 动画结束后停在中线的项（缩放强调）
   * @param selectIdx 需要同时选中的标签下标；不传表示只居中、不改变选中
   */
  animateTo(target: number, centerIdx: number, selectIdx?: number): void;
  /** 一次性应用"中线标记 + 可选选中"，合并为一次 setData */
  applyState(centerIdx: number, selectIdx?: number): void;
  /** 清空长按定时器 */
  clearLongPress(): void;
  /** 进入管理态（长按触发） */
  enterManage(): void;
  /** 标签列表变化后的统一收尾 */
  refreshStrip(selIdx: number, animate: boolean): void;
  onStripTouchStart(e: { touches: TouchPoint[] }): void;
  onStripTouchMove(e: { touches: TouchPoint[] }): void;
  onStripTouchEnd(): void;
  onStripItemTap(e: { currentTarget: { dataset: { i: string | number } } }): void;
  onStripTap(): void;
  onExitManage(): void;
  onResetTags(): void;
  onAddTag(): void;
  setType(e: { currentTarget: { dataset: { type: string } } }): void;
  onAmount(e: { detail: string | { value?: string } }): void;
  onDate(e: { detail: { value: string } }): void;
  onTime(e: { detail: { value: string } }): void;
  onRemark(e: { detail: string | { value?: string } }): void;
  onSubmit(): void;
  /**
   * 保存后是否需要提示额度超额
   * @returns 提醒文案；无需提醒时为空串
   */
  budgetAlert(): string;
}

Page<LedgerEditData, LedgerEditCustom>({
  // —— 标签条内部状态初值 ——
  cc: 0,
  gap: FALLBACK_GAP,
  widths: [],
  centers: [],
  C: 0,
  p: 0,
  plain: false,
  sel: -1,
  center: -1,
  dragging: false,
  moved: false,
  axis: '',
  startX: 0,
  startY: 0,
  startP: 0,
  samples: [],
  tweenFrom: 0,
  tweenTo: 0,
  tweenStart: 0,
  tweenDur: 0,
  tweenToken: 0,
  lpTimer: null,

  data: {
    id: '',
    isEdit: false,
    type: LedgerType.Expense,
    amount: '',
    date: '',
    time: '',
    tag: '',
    remark: '',
    stripItems: [],
    trackStyle: '',
    stripReady: false,
    scrollLocked: false,
    plainMode: false,
    managing: false,
    tagsEmpty: false,
    currency: '¥',
    pageStyle: '',
    pageBg: LIGHT_COLORS.pageBg,
    navBarBg: LIGHT_COLORS.pageBg,
    navBarColor: 'black',
  },

  /**
   * 载入页面；带 id 参数时为编辑模式
   * @param query 页面参数，可含 id
   */
  onLoad(query: Record<string, string | undefined>) {
    ledgerStore.load();
    settingsStore.load();
    tagStore.load();
    attachPageTheme(this);
    this.setData({ currency: settingsStore.settings.currency });

    let initialTag = '';
    if (query?.id) {
      const record = ledgerStore.records.find((r) => r.id === query.id);
      if (record) {
        initialTag = record.tag || '';
        this.setData({
          id: record.id,
          isEdit: true,
          type: record.type,
          amount: String(toYuan(record.amount)),
          date: record.date,
          // 旧数据没有 time 字段时，用 createTime 推导展示
          time: record.time || nowTime(),
          tag: initialTag,
          remark: record.remark || '',
        });
      }
    }
    // 新增记录支持 ?type=income 预设收支类型（如从统计页「去记一笔」进入，跟随当前视图）；
    // 编辑模式的类型始终来自记录本身，不吃这个参数
    if (!this.data.isEdit && query?.type === 'income') {
      this.setData({ type: LedgerType.Income });
    }
    // 新增记录支持 ?date=YYYY-MM-DD 预设日期（统计页回看历史月份/某天时「去记一笔」，
    // 默认应落在所看的那一天而不是今天）。只认合法格式，且不晚于今天（防御未来的日期）；
    // 编辑模式的日期始终来自记录本身
    if (!this.data.isEdit && !this.data.date && query?.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
      this.setData({ date: query.date > today() ? today() : query.date });
    }
    if (!this.data.date) this.setData({ date: today() });
    // 新增记录默认当前时间
    if (!this.data.time) this.setData({ time: nowTime() });

    // 初始选中项：编辑记录的标签 > 上次选中的标签 > 第一项
    // （「> 第一项」保证新增记录首次进入时也有默认分类，而不是空标签）
    const wanted = initialTag || tagStore.center || tagStore.tags[0] || '';
    this.sel = tagStore.tags.indexOf(wanted);
    this.center = this.sel;

    // 新增记录：把默认选中的标签真正写进 data.tag。
    // ⚠️ 此前只设置了 sel（标签条上的高亮项），没同步 tag 字段——导致提交时 tag 为空串，
    // 保存的记录落到统计页就成了「未分类」（金额靠后还会被并入「其他」）。
    // 编辑模式在分支里已经设过 tag，这里不再覆盖（避免覆盖掉"已不在列表里的旧标签"）。
    const patch: Partial<LedgerEditData> = {
      stripItems: this.buildStrip(),
      tagsEmpty: !tagStore.tags.length,
    };
    if (!this.data.isEdit && this.sel >= 0) patch.tag = tagStore.tags[this.sel];
    this.setData(patch, () => this.measure());
  },

  onUnload() {
    this.clearLongPress();
    detachPageTheme(this);
  },

  onShow() {
    // 防御：若上一次手势未正常结束就离开页面，回到前台时务必恢复页面滚动
    if (this.data.scrollLocked) this.setData({ scrollLocked: false });
    applyPageTheme(this);
  },

  /**
   * 生成标签条渲染项。
   * - 循环模式：环内只有真标签（3 份拷贝实现无缝循环），加号独立钉在右端；
   * - 静态行模式：单份平铺，加号内联在行尾。
   *
   * `on` = 选中态（高亮色，来自显式选择）；`focus` = 停在中线（缩放强调）。
   * 两者刻意解耦：滑动只改变后者，不再顺手改选中。
   */
  buildStrip(): StripItem[] {
    const tags = tagStore.tags;
    const items: StripItem[] = [];

    if (this.plain) {
      tags.forEach((label, i) => {
        const on = i === this.sel;
        items.push({ key: i, i, label, plus: false, on, focus: on });
      });
      items.push({
        key: tags.length,
        i: -1,
        label: '',
        plus: true,
        on: false,
        focus: false,
      });
      return items;
    }

    for (let copy = 0; copy < 3; copy++) {
      for (let i = 0; i < tags.length; i++) {
        items.push({
          key: copy * tags.length + i,
          i,
          label: tags[i],
          plus: false,
          on: i === this.sel,
          focus: i === this.center,
        });
      }
    }
    return items;
  },

  /**
   * 更新轨道位移与过渡样式
   * @param animate 是否带过渡动画
   * @param dur 过渡时长（ms）
   * @param dist 位移距离（px），用于挑选缓动曲线
   */
  updateTrack(animate: boolean, dur = 0, dist = 0) {
    if (this.plain) {
      this.setData({ trackStyle: '' });
      return;
    }
    // 真正水平居中：选中/居中的项落在标签条的几何中线上
    // （右端的加号是覆盖层，靠渐隐遮罩 + 光圈切割，不参与占位）
    const offset = this.cc / 2 - this.p;
    const css = animate ? tweenStyle(dur, dist) : '';
    this.setData({ trackStyle: `transform: translateX(${offset.toFixed(2)}px);${css}` });
  },

  /**
   * 估算当前实际渲染的相位
   * 动画进行中手指按下时用它接管，避免从"逻辑终点"起算导致位置跳变
   * @returns 当前相位
   */
  currentPhase(): number {
    const t = this.tweenDur > 0 ? (Date.now() - this.tweenStart) / this.tweenDur : 1;
    if (t >= 1 || t <= 0) return this.p;
    return this.tweenFrom + (this.tweenTo - this.tweenFrom) * easeOutCubic(t);
  },

  /**
   * 测量容器与各项宽度，重建环布局
   *
   * 两种渲染模式（按「标签是否一屏放得下」判定，与加号位置无关，判定稳定不抖动）：
   * - 环周长 > 容器宽度 → 循环轨道（3 份拷贝 + 相位位移，加号钉右端）
   * - 环周长 ≤ 容器宽度 → 静态行（居中平铺 + 行尾加号）。
   *   此时继续循环会让同一标签在同屏重复出现，故降级为普通平铺，点选即选中。
   *
   * @param after 测量完成后的回调（如新增标签后的居中动画）
   */
  measure(after?: () => void) {
    wx.createSelectorQuery()
      .in(this)
      .select('.tag-strip')
      .boundingClientRect()
      .selectAll('.strip-item')
      .boundingClientRect()
      .exec((res) => {
        const stripRect = res[0] as { width: number } | null;
        const itemRects = res[1] as Array<{ width: number; left: number; right: number }> | null;
        // itemRects 允许为空：0 个标签时循环模式没有任何节点，应自然落入静态行
        if (!stripRect || !itemRects) return;

        const tagCount = tagStore.tags.length;
        this.cc = stripRect.width;
        // 静态行模式下 DOM 末尾还有一个内联加号（.strip-item--plus），不计入环宽
        this.widths = itemRects.slice(0, tagCount).map((r) => r.width);
        if (itemRects.length >= 2) {
          this.gap = Math.max(0, itemRects[1].left - itemRects[0].right) || FALLBACK_GAP;
        }

        const layout = buildLayout(this.widths, this.gap);
        this.centers = layout.centers;
        this.C = layout.circumference;
        const nextPlain = this.C <= this.cc;

        // 模式切换会改变加号的渲染位置（环内 ↔ 行尾内联），重建后需重测一次；
        // 判定只依赖标签宽度，第二次测量必然稳定，不会来回震荡
        if (nextPlain !== this.plain) {
          this.plain = nextPlain;
          this.setData(
            { plainMode: nextPlain, stripItems: this.buildStrip() },
            () => this.measure(after)
          );
          return;
        }

        const idx = this.sel >= 0 && this.centers.length ? this.sel : 0;
        this.p = this.centers.length ? wrapPhase(this.C + this.centers[idx], this.C) : 0;
        // 重新测量即重置动画状态，避免残留过渡让新位置"滑"过去
        this.tweenFrom = this.p;
        this.tweenTo = this.p;
        this.tweenDur = 0;
        this.tweenToken++; // 几何已变，作废挂起的延迟启动

        this.setData({ plainMode: this.plain, stripReady: true }, () => {
          this.updateTrack(false);
          after?.();
        });
      });
  },

  /**
   * 弹性动画到目标相位
   *
   * 起止相位的规划交给 utils/tag-strip 的 planTween：它既取"就近等价目标"（避免绕远），
   * 又把这对点整体平移到中间份拷贝（避免 p 越界露出空白）。这里只负责时长、曲线与渲染。
   *
   * @param target 目标相位（任意量纲）
   * @param centerIdx 动画结束后停在中线的项（缩放强调）
   * @param selectIdx 需要同时选中的标签下标；不传表示只居中、不改变选中
   */
  animateTo(target: number, centerIdx: number, selectIdx?: number) {
    if (!this.cc || this.C <= 0 || this.plain) {
      this.applyState(centerIdx, selectIdx);
      return;
    }

    const cur = this.currentPhase();
    // safeMin = 半个容器宽：保证"可见窗口"完全落在 3 份拷贝覆盖范围内
    const plan = planTween(cur, target, this.C, this.cc / 2);
    const dist = Math.abs(plan.to - plan.from);
    const dur = Math.max(TWEEN_MIN_MS, Math.min(TWEEN_MAX_MS, TWEEN_BASE_MS + dist * TWEEN_PER_PX));

    this.applyState(centerIdx, selectIdx);

    if (!plan.shift) {
      this.p = plan.to;
      this.tweenFrom = plan.from;
      this.tweenTo = plan.to;
      this.tweenStart = Date.now();
      this.tweenDur = dur;
      this.updateTrack(true, dur, dist);
      return;
    }

    // 需要整体平移时，CSS 会从"旧位移"直接插值到"新位移"，白扫一个环周长（观感即异常滚回）。
    // 因此先做一次**无过渡的静默落位**，跳到平移后的等价位置（对环同余，画面完全一致、看不见），
    // 下一帧再启动真正的过渡，此时扫描距离就等于真实位移。
    this.tweenFrom = plan.from;
    this.tweenTo = plan.from;
    this.tweenStart = Date.now();
    this.tweenDur = 0;
    this.p = plan.from;
    this.updateTrack(false);

    const token = ++this.tweenToken;
    wx.nextTick(() => {
      if (token !== this.tweenToken) return; // 期间已有新手势/新动画，放弃本次
      this.p = plan.to;
      this.tweenFrom = plan.from;
      this.tweenTo = plan.to;
      this.tweenStart = Date.now();
      this.tweenDur = dur;
      this.updateTrack(true, dur, dist);
    });
  },

  /**
   * 一次性应用「中线标记 + 可选选中」，合并为一次 setData
   * @param centerIdx 停在中线的项（只影响缩放强调）
   * @param selectIdx 需要选中的标签下标；不传表示不改变选中
   */
  applyState(centerIdx: number, selectIdx?: number) {
    const tags = tagStore.tags;
    const patch: Partial<LedgerEditData> = {};

    if (selectIdx !== undefined && selectIdx >= 0 && selectIdx < tags.length) {
      this.sel = selectIdx;
      patch.tag = tags[selectIdx];
      try {
        // 记住选中项：下次进入页面把它摆回中线
        tagStore.setCenter(tags[selectIdx]);
      } catch (err) {
        console.error('[tag-strip] 选中项持久化失败:', err);
      }
    }

    this.center = centerIdx;
    patch.stripItems = this.buildStrip();
    this.setData(patch);
  },

  /** 清空长按定时器 */
  clearLongPress() {
    if (this.lpTimer) {
      clearTimeout(this.lpTimer);
      this.lpTimer = null;
    }
  },

  /** 进入管理态：标签抖动 + 删除角标；同时终止本次拖拽手势 */
  enterManage() {
    this.lpTimer = null;
    this.dragging = false;
    // 长按后抬手仍会触发该标签的 tap，若不抑制会立刻把它删掉；
    // moved 会在下一次 touchstart 时复位
    this.moved = true;
    if (this.data.managing) return;
    this.setData({ managing: true });
    // 长按进入管理态：重一档的确认感
    haptic('heavy');
  },

  /**
   * 标签列表变化后的统一收尾：重建渲染、重新测量、把指定标签选中并摆到中线
   * @param selIdx 期望选中的标签下标
   * @param animate 是否用弹性动画过去
   */
  refreshStrip(selIdx: number, animate: boolean) {
    const len = tagStore.tags.length;
    this.sel = len ? Math.min(Math.max(selIdx, 0), len - 1) : -1;
    this.center = this.sel;

    const patch: Partial<LedgerEditData> = {
      stripItems: this.buildStrip(),
      tagsEmpty: !len,
    };
    if (this.sel >= 0) patch.tag = tagStore.tags[this.sel];

    this.setData(patch, () =>
      this.measure(() => {
        if (this.sel < 0) return;
        if (animate && !this.plain) {
          this.animateTo(this.C + this.centers[this.sel], this.sel, this.sel);
        } else {
          this.applyState(this.sel, this.sel);
        }
      })
    );
  },

  /** 手指落下：记录起点，准备区分点选 / 横拖 / 纵向滚动 / 长按 */
  onStripTouchStart(e: { touches: TouchPoint[] }) {
    if (!this.cc) return;
    const t = e.touches[0];

    // 每次触摸都复位手势判定，管理态同样需要（否则 moved 卡在 true，点 × 不响应）
    this.moved = false;
    this.axis = '';
    this.startX = t.clientX;
    this.startY = t.clientY;
    this.samples = [];
    this.clearLongPress();

    if (this.data.managing) {
      this.dragging = false; // 管理态只做点选删除，不拖拽
      return;
    }

    // 动画未结束就按下：从**当前渲染位置**接管，否则会从逻辑终点起算而跳一下
    this.p = this.currentPhase();
    this.tweenFrom = this.p;
    this.tweenTo = this.p;
    this.tweenDur = 0;
    this.tweenToken++; // 作废可能挂起的"静默落位后延迟启动"

    // 拖拽期间不保留"中线放大"标记：落位时再标到新的中心项，
    // 否则放大的标签会停在旧位置随手指一起漂移
    if (this.center !== -1) this.applyState(-1);

    this.dragging = true;
    this.startP = this.p;
    this.samples = [{ t: Date.now(), x: t.clientX }];
    this.lpTimer = setTimeout(() => this.enterManage(), LONG_PRESS_MS);
  },

  /** 手指移动：先做方向锁定，横向时轨道跟手 */
  onStripTouchMove(e: { touches: TouchPoint[] }) {
    if (!this.cc) return;
    const t = e.touches[0];
    const dx = this.startX - t.clientX;
    const dy = this.startY - t.clientY;

    if (!this.axis) {
      if (Math.abs(dx) <= TAP_SLOP && Math.abs(dy) <= TAP_SLOP) return;
      this.clearLongPress(); // 一旦开始移动就不再是长按
      this.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      this.moved = true; // 判定为手势后，本次触摸结束后的 tap 一律抑制
      if (this.data.managing) return; // 管理态只需抑制 tap，不位移
      if (this.axis === 'y') {
        this.dragging = false; // 纵向：交给页面滚动
        return;
      }
      // 确认是横滑：锁住页面滚动。触摸事件会冒泡，页面滚动容器会把它当成滚动意图，
      // 不锁的话标签横滑时页面会跟着上下抖
      if (!this.data.scrollLocked) this.setData({ scrollLocked: true });
    }
    if (!this.dragging) return;

    this.samples.push({ t: Date.now(), x: t.clientX });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();

    this.p = wrapPhase(this.startP + dx, this.C);
    this.updateTrack(false);
  },

  /** 手指抬起：横向拖拽时按末速惯性外推，再弹性吸附到最近一项 */
  onStripTouchEnd() {
    this.clearLongPress();
    // 先解锁：无论本次手势走了哪条分支（纵滑 / 管理态 / 未成手势）都要恢复页面滚动
    if (this.data.scrollLocked) this.setData({ scrollLocked: false });
    if (!this.dragging) return;
    this.dragging = false;
    if (!this.moved || this.axis !== 'x' || this.plain) return;

    const s = this.samples;
    const last = s[s.length - 1];
    let first = s[0];
    for (const sample of s) {
      if (last.t - sample.t <= VELOCITY_WINDOW_MS) {
        first = sample;
        break;
      }
    }
    let v = 0;
    if (last.t > first.t) v = (last.x - first.x) / (last.t - first.t);

    // p 与 clientX 反向：手指左甩（x 减小）→ 轨道左移 → p 增大
    // 惯性距离必须夹住：外推接近半周长时"最近落点"会翻到环的反方向，表现为甩出去又弹回来
    const pitch = this.C / Math.max(1, this.centers.length);
    const projected =
      this.p + flingShift(v, MOMENTUM_MS, pitch, this.C, MAX_FLING_ITEMS, FLING_LIMIT_RATIO);

    const { index, delta } = nearestCenter(this.centers, this.C, projected, this.C);
    this.animateTo(projected + delta, index);
  },

  /**
   * 点选标签
   * - 管理态：删除该标签
   * - 点加号：进入新增流程
   * - 其余：摆到中线并选中（静态行模式直接选中）
   */
  onStripItemTap(e: {
    currentTarget: { dataset: { i: string | number; plus?: boolean } };
  }) {
    if (this.moved || !this.cc) return;
    const tags = tagStore.tags;

    // 加号（静态行内联 / 循环模式钉在右端）始终是新增入口
    if (e.currentTarget.dataset.plus) {
      haptic('light');
      this.onAddTag();
      return;
    }

    const ringIdx = Number(e.currentTarget.dataset.i);

    if (this.data.managing) {
      const tag = tags[ringIdx];
      if (tag === undefined) return;
      const prevSel = this.sel;
      try {
        tagStore.remove(tag);
      } catch (err) {
        wx.showToast({ title: err instanceof Error ? err.message : '删除失败', icon: 'none' });
        return;
      }
      haptic('heavy');
      // 删掉的正好是选中项 → 自动选中下一个；否则保持原选中标签
      let target = prevSel;
      if (prevSel === ringIdx) target = tagStore.tags.length ? ringIdx % tagStore.tags.length : -1;
      else if (prevSel > ringIdx) target = prevSel - 1;
      this.refreshStrip(target, false);
      wx.showToast({ title: `已删除「${tag}」`, icon: 'none' });
      return;
    }

    if (this.plain) {
      haptic('light');
      this.applyState(ringIdx, ringIdx);
      return;
    }
    // 点选：弹性转到中线，同时选中
    haptic('light');
    const target = phaseToCenter(this.currentPhase(), this.C + this.centers[ringIdx], this.C);
    this.animateTo(target, ringIdx, ringIdx);
  },

  /** 点击空白处：退出管理态 */
  onStripTap() {
    if (this.data.managing) this.onExitManage();
  },

  /** 退出管理态 */
  onExitManage() {
    haptic('light');
    this.setData({ managing: false });
  },

  /** 恢复默认标签 */
  onResetTags() {
    tagStore.resetDefaults();
    haptic('medium');
    this.refreshStrip(0, false);
    wx.showToast({ title: '已恢复默认标签', icon: 'none' });
  },

  /** 弹窗输入新增标签，成功后追加尾部并把新标签摆到中线 */
  onAddTag() {
    wx.showModal({
      title: '添加标签',
      editable: true,
      placeholderText: `最多 ${MAX_TAG_LEN} 个字`,
      success: (res) => {
        if (!res.confirm) return;
        try {
          tagStore.add(String(res.content ?? ''));
        } catch (err) {
          wx.showToast({ title: err instanceof Error ? err.message : '添加失败', icon: 'none' });
          return;
        }
        this.refreshStrip(tagStore.tags.length - 1, true);
        haptic('medium');
      },
    });
  },

  /**
   * 切换收入/支出
   * @param e 事件，dataset.type 为类型
   */
  setType(e: { currentTarget: { dataset: { type: string } } }) {
    const type = e.currentTarget.dataset.type === LedgerType.Income ? LedgerType.Income : LedgerType.Expense;
    if (type === this.data.type) return;
    haptic('light');
    this.setData({ type });
  },

  onAmount(e: { detail: string | { value?: string } }) {
    this.setData({ amount: pickValue(e) });
  },

  onDate(e: { detail: { value: string } }) {
    if (e.detail.value === this.data.date) return;
    haptic('light');
    this.setData({ date: e.detail.value });
  },

  onTime(e: { detail: { value: string } }) {
    if (e.detail.value === this.data.time) return;
    haptic('light');
    this.setData({ time: e.detail.value });
  },

  onRemark(e: { detail: string | { value?: string } }) {
    this.setData({ remark: pickValue(e) });
  },

  /** 提交表单 */
  onSubmit() {
    const d = this.data;

    if (!isValidAmount(d.amount)) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' });
      return;
    }
    if (!d.date) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(d.time)) {
      wx.showToast({ title: '请选择时间', icon: 'none' });
      return;
    }

    const input: LedgerInput = {
      type: d.type,
      amount: Number(d.amount),
      date: d.date,
      time: d.time,
      tag: d.tag,
      remark: d.remark,
    };

    try {
      if (d.isEdit) ledgerStore.edit(d.id, input);
      else ledgerStore.add(input);
    } catch (err) {
      // service 层校验失败时给出可读提示，而不是"点了没反应"
      wx.showToast({ title: err instanceof Error ? err.message : '保存失败', icon: 'none' });
      return;
    }

    // 记支出时顺带看一眼额度：达到/超出就弹「额度提醒」弹窗。
    // ⚠️ 弹窗必须在本页显示：若先 navigateBack，页面卸载会把刚弹出的 modal 一起吞掉
    // （"返回后弹"实测弹不出来）。所以超额时**立即弹窗**（不延迟），弹窗关闭后再返回；
    // 不超额则立即返回。每天最多弹一次（见 utils/budget-alert）。
    haptic('medium');
    wx.showToast({ title: '已保存', icon: 'success' });

    // 超额提醒**等返回后再弹**：navigateBack 之后稍等一拍（约 600ms，页面切换动画走完），
    // 再用全局 showModal 弹出——之前实测「与 navigateBack 同步紧挨着弹」会被页面卸载吞掉，
    // 给它留出过渡时间就能稳定显示在上一页之上。去重（每天最多一次）在 showBudgetAlertOnce 内；
    // 若返回的是首页，其 onShow 的 noticeBudget 也会抢先用同一个去重键弹，这里只会弹一次。
    const alert = this.budgetAlert();
    if (alert) {
      setTimeout(() => showBudgetAlertOnce(alert), 600);
    }

    wx.navigateBack();
  },

  /**
   * 保存后是否需要提示额度超额
   *
   * store.add 已经把新记录并进 records，所以这里读到的就是最新的今日/本月支出。
   * 只有支出才判断——记一笔收入不该触发"支出额度"的提醒。
   *
   * @returns 提醒文案；未超额 / 未设置额度 / 本次是收入时为空串
   */
  budgetAlert(): string {
    if (this.data.type !== LedgerType.Expense) return '';
    const settings = settingsStore.settings;
    return currentBudgetAlert({
      records: ledgerStore.records,
      dailyBudget: settings.dailyBudget,
      monthlyBudget: settings.monthlyBudget,
      currency: settings.currency,
    });
  },
});
