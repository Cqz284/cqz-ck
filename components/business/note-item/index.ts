import { NoteKind } from '../../../types/models';
import type { NoteItem } from '../../../types/models';
import { fromNow } from '../../../utils/date';
import { dueTagView } from '../../../utils/todo-remind';
import type { DueState } from '../../../utils/todo-remind';
import { haptic } from '../../../utils/haptics';
import { hintOnce } from '../../../utils/hint';

/** 一次性提示的去重键 */
const HINT_KEY = 'note-item-longpress';

/**
 * 从组件属性里取出记事项（属性声明为 Object，默认值是空对象，因此需要运行时收窄）
 * @param item 属性值
 * @returns 合法记事项或 null
 */
function asItem(item: unknown): NoteItem | null {
  if (!item || typeof item !== 'object') return null;
  const n = item as Partial<NoteItem>;
  return typeof n.id === 'string' && n.id ? (n as NoteItem) : null;
}

Component({
  properties: {
    /** 记事项 */
    item: { type: Object, value: {} },
    /** 是否处于多选模式：为 true 时点击/长按/勾选框都改为「选中」语义 */
    selectable: { type: Boolean, value: false },
  },

  data: {
    isTodo: false,
    timeText: '',
    dueEnabled: false,
    dueText: '',
    dueState: 'future' as DueState,
  },

  observers: {
    /**
     * 记事项变化时重算时间描述与类型
     * @param item 记事项
     */
    item(item: unknown) {
      const n = asItem(item);
      if (!n) return;
      const due = dueTagView(n, Date.now());
      this.setData({
        isTodo: n.kind === NoteKind.Todo,
        timeText: fromNow(n.createTime),
        dueEnabled: due.enabled,
        dueText: due.text,
        dueState: due.state,
      });
    },
  },

  methods: {
    /**
     * 勾选框
     * - 普通模式：切换待办完成状态
     * - 多选模式：改为选中（此时不该再改待办状态）
     */
    onToggle() {
      const item = asItem(this.data.item);
      if (!item) return;
      if (this.data.selectable) {
        haptic('light');
        this.triggerEvent('pick', { id: item.id });
        return;
      }
      this.triggerEvent('toggle', { id: item.id });
    },
    /**
     * 长按
     * - 普通模式：进入编辑（列表统一「长按编辑」，单击容易误触）
     * - 多选模式：切换选中
     *
     * 长按触发后 tap 不会再触发，两个处理器不会互相干扰。
     */
    onLongPress() {
      const item = asItem(this.data.item);
      if (!item) return;
      if (this.data.selectable) {
        haptic('light');
        this.triggerEvent('pick', { id: item.id });
        return;
      }
      haptic('heavy');
      this.triggerEvent('edit', { id: item.id });
    },
    /**
     * 单击
     * - 多选模式：切换选中
     * - 待办：直接切换完成状态——整条都能点，不必瞄准 44rpx 的小圆点
     * - 笔记：不做事，只做一次「长按可编辑」的引导提示（同一会话只提示一次）
     */
    onTap() {
      const item = asItem(this.data.item);
      if (!item) return;
      if (this.data.selectable) {
        haptic('light');
        this.triggerEvent('pick', { id: item.id });
        return;
      }
      if (item.kind === NoteKind.Todo) {
        this.triggerEvent('toggle', { id: item.id });
        return;
      }
      hintOnce(HINT_KEY, '长按可编辑');
    },
  },
});
