import { LedgerType } from '../../../types/models';
import type { LedgerRecord } from '../../../types/models';
import { formatMoney } from '../../../utils/money';
import { format } from '../../../utils/date';
import { haptic } from '../../../utils/haptics';
import { hintOnce } from '../../../utils/hint';

/** 合法 HH:mm */
const TIME_RE = /^\d{2}:\d{2}$/;

/** 一次性提示的去重键（记账卡片与记事卡片各自独立） */
const HINT_KEY = 'ledger-card-longpress';

/**
 * 从组件属性里取出记录（属性声明为 Object，默认值是空对象，因此需要运行时收窄）
 * @param record 属性值
 * @returns 合法记录或 null
 */
function asRecord(record: unknown): LedgerRecord | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Partial<LedgerRecord>;
  return typeof r.id === 'string' && r.id ? (r as LedgerRecord) : null;
}

Component({
  properties: {
    /** 记账记录 */
    record: { type: Object, value: {} },
    /** 货币符号 */
    currency: { type: String, value: '¥' },
    /**
     * 是否处于多选模式
     * 为 true 时点击/长按都改为「选中」语义，避免和长按编辑打架
     */
    selectable: { type: Boolean, value: false },
    /**
     * 只读模式（统计页分类明细用）：纯展示，点按不做任何事
     * 复用同一张卡片视觉，但长按编辑 / 单击引导提示 / 选中都不该在只读场景出现
     */
    readonly: { type: Boolean, value: false },
  },

  data: {
    amountText: '',
    isIncome: false,
    initial: '支',
    /** 展示时间 HH:mm（旧数据回退 createTime 推导） */
    timeText: '',
  },

  observers: {
    /**
     * 记录或货币变化时重算展示内容
     *
     * 注意：观察器的 key 才是"被监听的字段列表"。
     * 旧实现只写了 `record`，于是 `currency` 不会被监听、也拿不到当前值
     * （只能靠 formatMoney 的默认参数兜成 '¥'），导致设置里改货币符号后卡片不刷新。
     *
     * @param record 记账记录
     * @param currency 货币符号
     */
    'record, currency'(record: unknown, currency: string) {
      const r = asRecord(record);
      if (!r) return;
      const isIncome = r.type === LedgerType.Income;
      const tag = r.tag || '';
      this.setData({
        isIncome,
        initial: tag ? tag.slice(0, 1) : isIncome ? '收' : '支',
        amountText: (isIncome ? '+' : '-') + formatMoney(r.amount, currency),
        timeText: r.time && TIME_RE.test(r.time) ? r.time : format(r.createTime, 'HH:mm'),
      });
    },
  },

  methods: {
    /**
     * 长按
     * - 普通模式：进入编辑（列表统一「长按编辑」，单击容易误触）
     * - 多选模式：与单击一样切换选中
     *
     * 长按触发后 tap 不会再触发（微信 longpress 与 tap 互斥），两个处理器不会互相干扰。
     */
    onLongPress() {
      const record = asRecord(this.data.record);
      if (!record) return;
      if (this.data.readonly) return;
      if (this.data.selectable) {
        haptic('light');
        this.triggerEvent('pick', { id: record.id });
        return;
      }
      haptic('heavy');
      this.triggerEvent('edit', { id: record.id });
    },

    /**
     * 单击
     * - 普通模式：不做事，只做一次「长按可编辑」的引导提示（同一会话只提示一次）
     * - 多选模式：切换选中
     */
    onTap() {
      const record = asRecord(this.data.record);
      if (!record) return;
      if (this.data.readonly) return;
      if (this.data.selectable) {
        haptic('light');
        this.triggerEvent('pick', { id: record.id });
        return;
      }
      hintOnce(HINT_KEY, '长按记录可编辑');
    },
  },
});
