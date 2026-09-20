import type { NoteItem } from '../../types/models';
import { dueBannerView, dueState, dueTagView, dueText } from '../../utils/todo-remind';

/** 固定"现在"：2026-09-20 10:00 本地时间 */
const NOW = new Date(2026, 8, 20, 10, 0, 0, 0).getTime();

function todo(partial: Partial<NoteItem>): NoteItem {
  return {
    id: partial.id ?? 't1',
    kind: 'todo',
    content: partial.content ?? '待办',
    done: partial.done ?? false,
    createTime: NOW,
    updateTime: NOW,
    extra: {},
    ...partial,
  } as NoteItem;
}

/** 某天某点的本地时间戳 */
function at(y: number, m: number, d: number, hh: number, mm: number): number {
  return new Date(y, m - 1, d, hh, mm).getTime();
}

describe('todo-remind · dueState', () => {
  test('截止时间已过（哪怕就在今天内）= 逾期', () => {
    expect(dueState(at(2026, 9, 20, 9, 0), NOW)).toBe('overdue');
    expect(dueState(at(2026, 9, 19, 23, 0), NOW)).toBe('overdue');
  });

  test('今天内还没到点 = 今天到期', () => {
    expect(dueState(at(2026, 9, 20, 18, 0), NOW)).toBe('today');
    expect(dueState(at(2026, 9, 20, 23, 59), NOW)).toBe('today');
  });

  test('明天起 = 未来', () => {
    expect(dueState(at(2026, 9, 21, 0, 0), NOW)).toBe('future');
    expect(dueState(at(2026, 10, 1, 9, 0), NOW)).toBe('future');
  });
});

describe('todo-remind · dueText', () => {
  test('同年 M月D日 HH:mm，月日不带前导零', () => {
    expect(dueText(at(2026, 9, 20, 18, 0), NOW)).toBe('9月20日 18:00');
    expect(dueText(at(2026, 12, 3, 9, 5), NOW)).toBe('12月3日 09:05');
  });

  test('跨年带年份', () => {
    expect(dueText(at(2027, 1, 2, 8, 30), NOW)).toBe('2027年1月2日 08:30');
  });
});

describe('todo-remind · dueTagView', () => {
  test('未设置 / 0 / 非法值不显示', () => {
    expect(dueTagView(todo({}), NOW).enabled).toBe(false);
    expect(dueTagView(todo({ dueTime: 0 }), NOW).enabled).toBe(false);
    expect(dueTagView(todo({ dueTime: -5 }), NOW).enabled).toBe(false);
  });

  test('已完成的待办不显示截止标签', () => {
    const v = dueTagView(todo({ dueTime: at(2026, 9, 20, 18, 0), done: true }), NOW);
    expect(v.enabled).toBe(false);
  });

  test('逾期红 / 今天暖 / 未来中性', () => {
    expect(dueTagView(todo({ dueTime: at(2026, 9, 19, 9, 0) }), NOW).state).toBe('overdue');
    expect(dueTagView(todo({ dueTime: at(2026, 9, 20, 18, 0) }), NOW).state).toBe('today');
    expect(dueTagView(todo({ dueTime: at(2026, 9, 21, 9, 0) }), NOW).state).toBe('future');
  });
});

describe('todo-remind · dueBannerView', () => {
  test('没有截止时间或全部完成时不出现', () => {
    expect(dueBannerView([], NOW).enabled).toBe(false);
    expect(dueBannerView([todo({}), todo({ dueTime: 0 })], NOW).enabled).toBe(false);
    expect(
      dueBannerView([todo({ dueTime: at(2026, 9, 19, 9, 0), done: true })], NOW).enabled
    ).toBe(false);
  });

  test('逾期与今天到期分别计数，普通笔记不混入', () => {
    const items = [
      todo({ id: 'a', dueTime: at(2026, 9, 18, 9, 0) }), // 逾期（更早的自然日）
      todo({ id: 'b', dueTime: at(2026, 9, 20, 18, 0) }), // 今天还没到点
      todo({ id: 'c', dueTime: at(2026, 9, 20, 9, 0) }), // 今天内已过点 → 算今天到期，不算逾期
      todo({ id: 'd', dueTime: at(2026, 9, 25, 9, 0) }), // 未来，不报
    ];
    const v = dueBannerView(items, NOW);
    expect(v.enabled).toBe(true);
    expect(v.text).toBe('1 条已逾期 · 2 条今天到期');
  });

  test('纯笔记传入不算待办', () => {
    const note = { ...todo({ dueTime: at(2026, 9, 19, 9, 0) }), kind: 'plain' } as NoteItem;
    expect(dueBannerView([note], NOW).enabled).toBe(false);
  });
});
