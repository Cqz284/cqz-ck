import { notesStore } from '../../../store/notes.store';
import { NoteKind } from '../../../types/models';
import type { NoteInput } from '../../../types/models';
import { MAX_NOTE_TAGS, MAX_NOTE_TAG_LEN } from '../../../service/notes.service';
import { haptic } from '../../../utils/haptics';
import { format } from '../../../utils/date';
import { dueText } from '../../../utils/todo-remind';
import { LIGHT_COLORS, applyPageTheme, attachPageTheme, detachPageTheme } from '../../../utils/theme';

/** 保存成功后返回上一页的延时（毫秒），让 toast 有机会显示 */
const BACK_DELAY = 500;

/** 快捷截止项（随当前时间动态换算，见 syncQuickChips） */
interface QuickChip {
  /** dataset 标识（onDueQuick 按它取配置） */
  type: string;
  /** chip 上显示的文案 */
  label: string;
  /** 目标小时（分钟固定 00） */
  hour: number;
  /** 是否顺延到明天 */
  plusDay: boolean;
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

/**
 * 把 YYYY-MM-DD + HH:mm 组装成本地时间戳（毫秒）
 *
 * 自己拆数字构造 Date，规避 iOS 对 `new Date('2026-09-20 18:00')` 的解析差异
 * @param dateStr 日期 YYYY-MM-DD
 * @param hmStr 时间 HH:mm
 * @returns 毫秒时间戳；入参非法返回 0
 */
function composeDue(dateStr: string, hmStr: string): number {
  const dp = (dateStr || '').split('-');
  const tp = (hmStr || ':').split(':');
  const y = Number(dp[0]);
  const m = Number(dp[1]);
  const d = Number(dp[2]);
  const hh = Number(tp[0]);
  const mm = Number(tp[1]);
  if (![y, m, d, hh, mm].every((v) => Number.isFinite(v))) return 0;
  const ts = new Date(y, m - 1, d, hh, mm).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

/** 页面 data */
interface NotesEditData {
  id: string;
  isEdit: boolean;
  kind: NoteKind;
  content: string;
  /** 内容非空才亮保存（空态置灰，点了也不给弹「内容不能为空」） */
  canSave: boolean;
  /** 新增页进入即聚焦内容输入框（编辑页不打扰） */
  autoFocus: boolean;
  done: boolean;
  /** 截止日期 YYYY-MM-DD（原生 date 选择器的绑定值；空串 = 未设置） */
  dueDate: string;
  /** 截止时间 HH:mm（原生 time 选择器的绑定值） */
  dueHM: string;
  /** 已设置截止时间时，行上展示的文案 */
  dueLabel: string;
  /** 截止卡折叠容器高度（px，实测写入；0 = 收起） */
  dueH: number;
  /** 快捷截止项（按当前时间动态换算，onShow 时刷新） */
  quickChips: QuickChip[];
  /** 今天日期 YYYY-MM-DD（日期选择器的 start 下限，不允许选过去的日期） */
  todayDate: string;
  /** 已打的标签（编辑页内即时增删，保存时整体写入） */
  tags: string[];
  /** 标签输入框的绑定值 */
  tagInput: string;
  pageStyle: string;
  pageBg: string;
  navBarBg: string;
  navBarColor: 'black' | 'white';
}

/** 页面自定义实例字段与方法 */
interface NotesEditCustom {
  /** 保存成功后的返回定时器（onUnload 中清理，避免多退一层页面） */
  backTimer: ReturnType<typeof setTimeout> | null;
  setKind(e: { currentTarget: { dataset: { kind: string } } }): void;
  onContent(e: { detail: string | { value?: string } }): void;
  onDueQuick(e: { currentTarget: { dataset: { type: string } } }): void;
  onDueDate(e: { detail: { value: string } }): void;
  onDueTime(e: { detail: { value: string } }): void;
  onDueClear(): void;
  onTagInput(e: { detail: string | { value?: string } }): void;
  onTagAdd(): void;
  onTagRemove(e: { currentTarget: { dataset: { index: string | number } } }): void;
  onSubmit(): void;
  /** 由 dueDate / dueHM 重算行上文案 */
  syncDueLabel(): void;
  /** 截止卡折叠容器高度实测（普通笔记 → 0 收起） */
  syncDueWrap(): void;
  /** 按当前时间换算快捷截止项 */
  syncQuickChips(): void;
}

Page<NotesEditData, NotesEditCustom>({
  /** 返回定时器（提交成功后赋值） */
  backTimer: null,

  data: {
    id: '',
    isEdit: false,
    kind: NoteKind.Plain,
    content: '',
    canSave: false,
    autoFocus: false,
    done: false,
    dueDate: '',
    dueHM: '',
    dueLabel: '',
    dueH: 0,
    quickChips: [] as QuickChip[],
    todayDate: format(Date.now(), 'YYYY-MM-DD'),
    tags: [] as string[],
    tagInput: '',
    pageStyle: '',
    pageBg: LIGHT_COLORS.pageBg,
    navBarBg: LIGHT_COLORS.pageBg,
    navBarColor: 'black',
  },

  /**
   * 载入页面；带 id 参数时为编辑模式，带 kind=todo 时新增页默认「待办」
   * @param query 页面参数，可含 id / kind
   */
  onLoad(query: Record<string, string | undefined>) {
    notesStore.load();
    attachPageTheme(this);

    // 新增页的默认类型：由记事页当前 tab（或首页入口）传进来，避免"选了待办却新建出笔记"
    if (query?.kind === NoteKind.Todo) this.setData({ kind: NoteKind.Todo });

    // 新增页进入即弹键盘（用户点「去记事/加待办」就是想立刻写）；编辑页不打扰
    this.setData({ autoFocus: !query?.id });

    if (query?.id) {
      const item = notesStore.items.find((n) => n.id === query.id);
      if (item) {
        const due = typeof item.dueTime === 'number' && item.dueTime > 0 ? item.dueTime : 0;
        this.setData({
          id: item.id,
          isEdit: true,
          kind: item.kind,
          content: item.content,
          canSave: Boolean((item.content || '').trim()),
          done: item.done,
          dueDate: due ? format(due, 'YYYY-MM-DD') : '',
          dueHM: due ? format(due, 'HH:mm') : '',
          tags: (item.tags ?? []).slice(),
        });
        this.syncDueLabel();
      }
    }
  },

  /** 首次渲染完成后量一次截止卡高度（onLoad 里 DOM 还没挂载，量不到） */
  onReady() {
    this.syncDueWrap();
  },

  onUnload() {
    if (this.backTimer) {
      clearTimeout(this.backTimer);
      this.backTimer = null;
    }
    detachPageTheme(this);
  },

  onShow() {
    applyPageTheme(this);
    // 快捷截止项跟当前时间走（页面停留跨了 20/23 点也能在下个 onShow 刷对）
    this.syncQuickChips();
  },

  /**
   * 切换笔记类型
   * @param e 事件，dataset.kind 为 plain / todo
   */
  setKind(e: { currentTarget: { dataset: { kind: string } } }) {
    const kind = e.currentTarget.dataset.kind === NoteKind.Todo ? NoteKind.Todo : NoteKind.Plain;
    if (kind === this.data.kind) return;
    haptic('light');
    this.setData({ kind }, () => this.syncDueWrap());
  },

  onContent(e: { detail: string | { value?: string } }) {
    const content = pickValue(e);
    this.setData({ content, canSave: Boolean(content.trim()) });
  },

  /**
   * 快捷截止项（今天 20:00 / 今晚 23:00 / 明早 08:00 / 明天 09:00，随时间动态换算）
   * @param e 事件，dataset.type 为 quickChips 里的 type
   */
  onDueQuick(e: { currentTarget: { dataset: { type: string } } }) {
    const chip = this.data.quickChips.find((c) => c.type === e.currentTarget.dataset.type);
    if (!chip) return;
    const base = new Date();
    if (chip.plusDay) base.setDate(base.getDate() + 1);
    base.setHours(chip.hour, 0, 0, 0);
    // 页面停留跨了整点（chip 文案还没刷新）时兜底顺延到明早 08:00，绝不设出过去的时间
    if (base.getTime() <= Date.now()) {
      base.setDate(base.getDate() + 1);
      base.setHours(8, 0, 0, 0);
    }
    haptic('light');
    this.setData({
      dueDate: format(base.getTime(), 'YYYY-MM-DD'),
      dueHM: format(base.getTime(), 'HH:mm'),
    });
    this.syncDueLabel();
  },

  /** 原生日期选择器回调（minStart 已限制不能选过去） */
  onDueDate(e: { detail: { value: string } }) {
    this.setData({ dueDate: e.detail.value });
    this.syncDueLabel();
  },

  /** 原生时间选择器回调 */
  onDueTime(e: { detail: { value: string } }) {
    this.setData({ dueHM: e.detail.value });
    this.syncDueLabel();
  },

  /** 清除截止时间 */
  onDueClear() {
    haptic('light');
    this.setData({ dueDate: '', dueHM: '', dueLabel: '' });
  },

  /** 标签输入框（只绑定值，添加动作在按钮/键盘确认键上） */
  onTagInput(e: { detail: string | { value?: string } }) {
    this.setData({ tagInput: pickValue(e) });
  },

  /** 添加标签：去空格、去重、限长限个 */
  onTagAdd() {
    const text = (this.data.tagInput || '').trim().slice(0, MAX_NOTE_TAG_LEN);
    if (!text) return;
    if (this.data.tags.length >= MAX_NOTE_TAGS) {
      wx.showToast({ title: `最多 ${MAX_NOTE_TAGS} 个标签`, icon: 'none' });
      return;
    }
    if (this.data.tags.includes(text)) {
      this.setData({ tagInput: '' });
      return;
    }
    haptic('light');
    this.setData({ tags: [...this.data.tags, text], tagInput: '' });
  },

  /**
   * 移除标签
   * @param e 事件，dataset.index 为标签序号
   */
  onTagRemove(e: { currentTarget: { dataset: { index: string | number } } }) {
    const idx = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.data.tags.length) return;
    haptic('light');
    this.setData({ tags: this.data.tags.filter((_, i) => i !== idx) });
  },

  /** 由 dueDate / dueHM 重算行上文案；两者不齐时提示还差一半 */
  syncDueLabel() {
    const { dueDate, dueHM } = this.data;
    if (!dueDate && !dueHM) {
      this.setData({ dueLabel: '' });
      return;
    }
    if (!dueDate || !dueHM) {
      this.setData({ dueLabel: '再选一个' + (dueDate ? '时间' : '日期') + '才生效' });
      return;
    }
    const ts = composeDue(dueDate, dueHM);
    this.setData({ dueLabel: ts > 0 ? dueText(ts, Date.now()) : '' });
  },

  /**
   * 截止卡折叠容器高度实测（普通笔记 → 0 收起；统计页 detail-wrap 同款模式）
   * 内层卡片不带外边距（margin 挂 wrap 上），实测 border-box 才不会被裁掉一条
   */
  syncDueWrap() {
    if (this.data.kind !== NoteKind.Todo) {
      if (this.data.dueH !== 0) this.setData({ dueH: 0 });
      return;
    }
    wx.createSelectorQuery()
      .select('.due-card')
      .boundingClientRect((rect) => {
        const h = rect ? (rect as { height: number }).height : 0;
        if (h > 0 && Math.abs(h - this.data.dueH) > 0.5) this.setData({ dueH: h });
      })
      .exec();
  },

  /**
   * 按当前时间换算快捷截止项：20 点前「今天 20:00」；20-23 点「今晚 23:00」；
   * 23 点后「明早 08:00」。第二颗固定「明天 09:00」。
   */
  syncQuickChips() {
    const h = new Date().getHours();
    const first: QuickChip = h < 20
      ? { type: 'tonight', label: '今天 20:00', hour: 20, plusDay: false }
      : h < 23
        ? { type: 'night', label: '今晚 23:00', hour: 23, plusDay: false }
        : { type: 'morning', label: '明早 08:00', hour: 8, plusDay: true };
    this.setData({
      quickChips: [first, { type: 'tomorrow', label: '明天 09:00', hour: 9, plusDay: true }],
    });
  },

  /** 提交保存 */
  onSubmit() {
    const d = this.data;
    const content = (d.content || '').trim();
    if (!content) {
      wx.showToast({ title: '内容不能为空', icon: 'none' });
      return;
    }

    // 截止时间：日期与时间都齐了才生效（半截选择在行上已有提示）
    const dueTime = d.kind === NoteKind.Todo && d.dueDate && d.dueHM
      ? composeDue(d.dueDate, d.dueHM)
      : 0;

    const input: NoteInput = {
      kind: d.kind,
      content,
      done: d.done,
      dueTime,
      // 标签整体写入：编辑页内已即时增删，这里传最终集合（空数组 = 清除全部）
      tags: d.tags.slice(),
    };

    try {
      if (d.isEdit) notesStore.edit(d.id, input);
      else notesStore.add(input);
    } catch (err) {
      // service 层校验失败时给出可读提示，而不是"点了没反应"
      wx.showToast({ title: err instanceof Error ? err.message : '保存失败', icon: 'none' });
      return;
    }

    haptic('medium');
    wx.showToast({ title: '已保存', icon: 'success' });
    this.backTimer = setTimeout(() => {
      this.backTimer = null;
      wx.navigateBack();
    }, BACK_DELAY);
  },
});
