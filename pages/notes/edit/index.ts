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
  done: boolean;
  /** 截止日期 YYYY-MM-DD（原生 date 选择器的绑定值；空串 = 未设置） */
  dueDate: string;
  /** 截止时间 HH:mm（原生 time 选择器的绑定值） */
  dueHM: string;
  /** 已设置截止时间时，行上展示的文案 */
  dueLabel: string;
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
}

Page<NotesEditData, NotesEditCustom>({
  /** 返回定时器（提交成功后赋值） */
  backTimer: null,

  data: {
    id: '',
    isEdit: false,
    kind: NoteKind.Plain,
    content: '',
    done: false,
    dueDate: '',
    dueHM: '',
    dueLabel: '',
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

    if (query?.id) {
      const item = notesStore.items.find((n) => n.id === query.id);
      if (item) {
        const due = typeof item.dueTime === 'number' && item.dueTime > 0 ? item.dueTime : 0;
        this.setData({
          id: item.id,
          isEdit: true,
          kind: item.kind,
          content: item.content,
          done: item.done,
          dueDate: due ? format(due, 'YYYY-MM-DD') : '',
          dueHM: due ? format(due, 'HH:mm') : '',
          tags: (item.tags ?? []).slice(),
        });
        this.syncDueLabel();
      }
    }
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
  },

  /**
   * 切换笔记类型
   * @param e 事件，dataset.kind 为 plain / todo
   */
  setKind(e: { currentTarget: { dataset: { kind: string } } }) {
    const kind = e.currentTarget.dataset.kind === NoteKind.Todo ? NoteKind.Todo : NoteKind.Plain;
    if (kind === this.data.kind) return;
    haptic('light');
    this.setData({ kind });
  },

  onContent(e: { detail: string | { value?: string } }) {
    this.setData({ content: pickValue(e) });
  },

  /**
   * 快捷截止时间：今天 20:00 / 明天 09:00
   * @param e 事件，dataset.type 为 tonight / tomorrow
   */
  onDueQuick(e: { currentTarget: { dataset: { type: string } } }) {
    const base = new Date();
    if (e.currentTarget.dataset.type === 'tomorrow') base.setDate(base.getDate() + 1);
    base.setHours(e.currentTarget.dataset.type === 'tomorrow' ? 9 : 20, 0, 0, 0);
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

  /** 标签输入框（只绑定值，添加动作在按钮/确认键上） */
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
