import { createStoreBindings } from 'mobx-miniprogram-bindings';
import type { StoreBindings } from 'mobx-miniprogram-bindings';
import { defineSwipeSelectPage, swipeSelectData } from '../../../behaviors/swipe-select';
import type { SwipeSelectData, SwipeSelectMethods } from '../../../behaviors/swipe-select';
import { notesStore } from '../../../store/notes.store';
import type { NotesFilter } from '../../../store/notes.store';
import { debounce } from '../../../utils/debounce';
import type { DebouncedFn } from '../../../utils/debounce';
import { haptic } from '../../../utils/haptics';
import { todoProgressView } from '../../../utils/budget';
import type { ProgressView } from '../../../utils/budget';
import { NoteKind } from '../../../types/models';
import type { NoteItem } from '../../../types/models';
import { LIGHT_COLORS, applyPageTheme, attachPageTheme, detachPageTheme } from '../../../utils/theme';

/** tab 顺序必须与 index.wxml 中的 van-tab 顺序保持一致 */
const FILTERS: NotesFilter[] = ['all', NoteKind.Todo, NoteKind.Plain];

/** 搜索防抖等待时长（毫秒） */
const SEARCH_WAIT = 300;

/** 页面 data（滑动多选部分由 behaviors/swipe-select 提供） */
interface NotesListData extends SwipeSelectData {
  items: NoteItem[];
  keyword: string;
  filter: NotesFilter;
  activeTab: number;
  totalCount: number;
  pendingCount: number;
  /** 待办完成度进度条（按全部待办统计；切到「笔记」页签时隐藏） */
  todoBar: ProgressView;
  pageStyle: string;
  pageBg: string;
  navBarBg: string;
  navBarColor: 'black' | 'white';
}

/**
 * 页面自定义实例字段与方法
 *
 * 多选/滑删/撤销的编排全部来自 behaviors/swipe-select（SwipeSelectMethods）；
 * 页面只保留差异：搜索、筛选、待办勾选、编辑跳转，以及两个钩子
 * visibleIds() / refresh(extra?)。
 */
interface NotesListCustom extends SwipeSelectMethods {
  /** store 绑定实例（onUnload 时销毁） */
  bindings: StoreBindings[];
  /** 防抖后的搜索提交（onUnload 时取消） */
  commitSearch: DebouncedFn<(kw: string) => void>;
  refresh(extra?: Partial<NotesListData>): void;
  visibleIds(): string[];
  /**
   * 只清空选中、保留多选模式
   * 用于筛选/搜索变化：列表内容变了，旧的勾选要么看不见、要么语义错位，直接重置最不容易出错
   */
  resetPick(): void;
  onSearch(e: { detail: string | { value?: string } }): void;
  setFilter(e: { detail: { index: number } }): void;
  onToggle(e: { detail: { id: string } }): void;
  onEdit(e: { detail: { id: string } }): void;
  /** 新增记事（默认类型跟随当前 tab） */
  goEdit(): void;
  /**
   * 组装新增页的查询串（默认类型）
   * @returns 形如 '?kind=todo'；无需指定类型时为空串
   */
  editQuery(): string;
}

/** 传给 defineSwipeSelectPage 的"页面差异部分"（共享成员由 mixin 在运行时补上） */
type NotesListPageCustom = Omit<NotesListCustom, keyof SwipeSelectMethods>;

Page<NotesListData, NotesListCustom>(
  defineSwipeSelectPage<NoteItem, NotesListData, NotesListPageCustom>(
    {
      enterHintKey: 'notes-swipe-enter',
      enterHintText: '右滑内容可多选',
      exitHintKey: 'notes-swipe-exit',
      exitHintText: '左滑内容可退出多选',
      noPickToast: '先选择要删除的内容',
      undoText: (n) => `已删除 ${n} 条`,
      removeItems: (ids) => notesStore.removeMany(ids),
      restoreItems: (items) => notesStore.restore(items),
    },
    {
      /** store 绑定实例（onLoad 中填充，onUnload 中销毁） */
      bindings: [] as StoreBindings[],
      /** 防抖后的搜索提交（onLoad 中重建，onUnload 中取消） */
      commitSearch: debounce((_kw: string) => {}, SEARCH_WAIT),

      data: {
        ...swipeSelectData(),
        items: [] as NoteItem[],
        keyword: '',
        filter: 'all' as NotesFilter,
        activeTab: 0,
        totalCount: 0,
        pendingCount: 0,
        todoBar: { enabled: false, label: '', value: '', percent: 0, level: 'normal', hint: '' },
        pageStyle: '',
        pageBg: LIGHT_COLORS.pageBg,
        navBarBg: LIGHT_COLORS.pageBg,
        navBarColor: 'black',
      },

      onLoad() {
        // 只绑定模板真正渲染的字段；items 由 refresh() 写入，
        // 避免把整个 visibleItems 数组额外推一次 setData。
        this.bindings = [
          createStoreBindings(this, {
            store: notesStore,
            fields: ['pendingCount', 'totalCount'],
          }),
        ];

        this.commitSearch = debounce((kw: string) => {
          notesStore.setSearchKeyword(kw);
          this.refresh();
          this.resetPick();
        }, SEARCH_WAIT);

        attachPageTheme(this);
      },

      onUnload() {
        this.bindings.forEach((b) => b.destroyStoreBindings());
        // 取消未执行的防抖，避免页面销毁后仍触发 setData
        this.commitSearch.cancel();
        if (this.removeTimer) {
          clearTimeout(this.removeTimer);
          this.removeTimer = null;
        }
        this.clearExitTimer();
        // 按引用注销主题监听（无参调用会移除所有页面的监听）
        detachPageTheme(this);
      },

      onShow() {
        // 先套主题（内部会重钉 tabBar）：系统 tabBar 可能在页面切换时被框架按 theme.json 重画过，
        // 越早钉，越不容易看到"tab 栏先错一下再变对"
        applyPageTheme(this);
        notesStore.load();
        // 从编辑页回来时退出多选，避免选中集合与重新加载的数据对不上
        if (this.data.selecting) this.clearPick();
        if (this.data.undoVisible) {
          this.stash = [];
          this.setData({ undoVisible: false });
        }
        this.refresh();
        // 滑开的删除块不能跨页存活：本页是 tab 页，切走不会卸载，回来仍是展开状态。
        // resetSwipes 是**终止型**收口（清记录 + 两槽宽度归零，当帧不还原）：
        // 之所以不"归零一帧再还原"，是因为两次 setData 落在同一批次时，
        // Vant 的 swipeMove(0) 会被宽度 observer 的 swipeMove(newWidth) 覆盖，
        // 行反而停在半开位（现象：能看到一小部分删除块往回缩、该行再也滑不动）。
        // 宽度恢复交给下一帧的 restoreSwipeWidth()：那时 Vant 的 observer 已经真的跑过、offset 已归零。
        this.resetSwipes();
        wx.nextTick(() => this.restoreSwipeWidth());
        this.hintSwipe();
      },

      onHide() {
        // 切 tab / 跳去编辑页时立刻收回滑开的行（只靠 onShow 收会在返回瞬间闪一下展开态）。
        // 这里同样用终止型收口而不是 closeAllSwipes：隐藏时不需要宽度，也就不必承担
        // "归零 → 还原"的批次竞争风险；回到本页时 onShow 会先还原宽度再刷新。
        this.resetSwipes();
        // 待执行的"退出多选"一并作废：回到本页时 onShow 会自己收口
        this.clearExitTimer();
      },

      /**
       * 把 store 的过滤结果同步到 data
       * @param extra 需要与本次刷新合并进**同一次 setData** 的字段
       *   （删除时若"先复原收起态、下一帧才移除条目"，那一条会先复原一帧，列表看着闪一下）
       */
      refresh(extra: Partial<NotesListData> = {}) {
        const items = notesStore.visibleItems.slice();
        // 待办完成度按「全部待办」统计：不受搜索关键词与当前 tab 影响，
        // 否则切到「笔记」或搜了个关键词，进度条就会无故跳动（它统计的是"全部待办"）
        const todos = notesStore.items.filter((n) => n.kind === NoteKind.Todo);
        const patch: Partial<NotesListData> = {
          items,
          totalCount: notesStore.totalCount,
          pendingCount: notesStore.pendingCount,
          todoBar: todoProgressView(todos.filter((n) => n.done).length, todos.length),
        };
        this.setData(Object.assign(patch, extra));
        // 列表变化后重新校准选中态（例如搜索关键词变化导致可见项变少）
        if (this.data.selecting) this.syncPick();
      },

      /**
       * 搜索输入：本地立即回显，防抖后再写入 store
       * @param e van-search 的 change 事件
       */
      onSearch(e: { detail: string | { value?: string } }) {
        const d = e.detail;
        const kw = typeof d === 'string' ? d : d?.value ?? '';
        this.setData({ keyword: kw });
        this.commitSearch(kw);
      },

      /**
       * 切换筛选 tab
       * @param e van-tabs 的 change 事件，detail.index 为 tab 序号
       */
      setFilter(e: { detail: { index: number } }) {
        const index = typeof e?.detail?.index === 'number' ? e.detail.index : 0;
        const filter = FILTERS[index] ?? 'all';

        haptic('light');
        notesStore.setFilter(filter);
        this.setData({ filter, activeTab: index });
        this.refresh();
        this.resetPick();
      },

      /**
       * 勾选/取消待办
       * @param e note-item 冒泡的 toggle 事件
       */
      onToggle(e: { detail: { id: string } }) {
        const id = e.detail.id;
        const before = notesStore.items.find((n) => n.id === id);
        // 把待办勾完成比取消勾选"更重"，反馈强度区分开
        haptic(before && !before.done ? 'medium' : 'light');
        try {
          notesStore.toggleDone(id);
        } catch (err) {
          wx.showToast({ title: err instanceof Error ? err.message : '操作失败', icon: 'none' });
          return;
        }
        this.refresh();
      },

      /**
       * 长按卡片进入编辑
       * @param e note-item 冒泡的 edit 事件
       */
      onEdit(e: { detail: { id: string } }) {
        wx.navigateTo({ url: '/pages/notes/edit/index?id=' + e.detail.id });
      },

      /** 只清空选中、保留多选模式（筛选/搜索变化时用） */
      resetPick() {
        if (!this.data.selecting) return;
        this.pickedOrder = [];
        this.setData({ pickMap: {}, pickedCount: 0, allPicked: false });
      },

      /** 当前列表可见项 id（平铺列表：条目顺序即展示顺序） */
      visibleIds(): string[] {
        return this.data.items.map((n) => n.id);
      },

      /**
       * 新增记事
       * 默认类型跟随当前 tab：待办页签下写的就是待办，笔记页签下就是笔记
       * （「全部」页签按笔记处理，它是个混合视图，没有"面向哪种类型"的语义）
       */
      goEdit() {
        haptic('light');
        wx.navigateTo({ url: '/pages/notes/edit/index' + this.editQuery() });
      },

      /**
       * 组装新增页的查询串（默认类型）
       * @returns 形如 '?kind=todo'；无需指定类型时为空串
       */
      editQuery(): string {
        return this.data.filter === NoteKind.Todo ? '?kind=todo' : '';
      },
    }
  )
);
