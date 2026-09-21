import { createStoreBindings } from 'mobx-miniprogram-bindings';
import type { StoreBindings } from 'mobx-miniprogram-bindings';
import { defineSwipeSelectPage, swipeSelectData } from '../../../behaviors/swipe-select';
import type { SwipeSelectData, SwipeSelectMethods } from '../../../behaviors/swipe-select';
import { searchRevealData, searchRevealMixin } from '../../../behaviors/search-reveal';
import type {
  SearchRevealData,
  SearchRevealFields,
  SearchRevealMethods,
} from '../../../behaviors/search-reveal';
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

/** 页面 data（滑动多选部分由 behaviors/swipe-select 提供，搜索栏显隐由 behaviors/search-reveal 提供） */
interface NotesListData extends SwipeSelectData, SearchRevealData {
  items: NoteItem[];
  keyword: string;
  filter: NotesFilter;
  activeTab: number;
  totalCount: number;
  pendingCount: number;
  /** 当前选中的标签（空串 = 全部；标签筛选是页面本地状态，不进 store） */
  activeTag: string;
  /** 可选标签集合（从全部记事的标签里收集，按首次出现顺序） */
  tagOptions: string[];
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
 * 搜索栏「下拉露出 / 自动收起」来自 behaviors/search-reveal（SearchRevealFields + SearchRevealMethods）；
 * 页面只保留差异：搜索、筛选、标签筛选、待办勾选、编辑跳转，以及两个钩子
 * visibleIds() / refresh(extra?)。
 */
interface NotesListCustom extends SwipeSelectMethods, SearchRevealFields, SearchRevealMethods {
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
  /** 点标签胶囊：再点一次取消（回到全部） */
  onTagFilter(e: { currentTarget: { dataset: { tag: string } } }): void;
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
      // 搜索栏编排（下拉露出 / 自动收起）：摊进页面选项即可，方法里的 this 类型依然完整
      // （searchRevealMixin 是带 ThisType 的对象字面量，不用改 defineSwipeSelectPage 的签名）
      ...searchRevealMixin,
      /** store 绑定实例（onLoad 中填充，onUnload 中销毁） */
      bindings: [] as StoreBindings[],
      /** 防抖后的搜索提交（onLoad 中重建，onUnload 中取消） */
      commitSearch: debounce((_kw: string) => {}, SEARCH_WAIT),

      data: {
        ...swipeSelectData(),
        ...searchRevealData(),
        items: [] as NoteItem[],
        keyword: '',
        filter: 'all' as NotesFilter,
        activeTab: 0,
        totalCount: 0,
        pendingCount: 0,
        activeTag: '',
        tagOptions: [] as string[],
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
          // 有内容就保持露出、清空则重新计时（"正在使用不收起"的口径）
          this.syncSearchKeyword(kw);
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
        // 搜索栏的空闲收起定时器一并清掉，免得页面销毁后回调还在跑
        this.clearSearchTimer();
        // 按引用注销主题监听（无参调用会移除所有页面的监听）
        detachPageTheme(this);
      },

      onShow() {
        // 先套主题（内部会重钉 tabBar）：系统 tabBar 可能在页面切换时被框架按 theme.json 重画过，
        // 越早钉，越不容易看到"tab 栏先错一下再变对"
        applyPageTheme(this);
        notesStore.load();
        // 首页「待办清单」等入口的一次性落点意图：只生效一次，落完立即清掉。
        // 必须在 refresh 之前落，让本次刷新直接按目标 tab 出数据。
        if (notesStore.pendingTab >= 0) {
          const index = notesStore.pendingTab;
          notesStore.setPendingTab(-1);
          const filter = FILTERS[index] ?? 'all';
          if (this.data.activeTab !== index) {
            notesStore.setFilter(filter);
            this.setData({ activeTab: index, filter });
          }
        }
        // 从编辑页回来时退出多选，避免选中集合与重新加载的数据对不上
        if (this.data.selecting) this.clearPick();
        if (this.data.undoVisible) {
          this.stash = [];
          this.setData({ undoVisible: false });
        }
        this.refresh();
        // 搜索栏回到隐藏态（带着关键词回来则保持露出）；内容短到不能滚动时，
        // refresh 里的长度检查会立刻把它重新常驻露出
        this.resetSearchReveal();
        // 切页**不**收口（2026-09-21 定稿）：滑开的删除块跨页保留原样，"就不动它"。
        // 之前的"切页时宽度归零→还原"正是"快速切页后那一行滑不动"的根源，已整个移除；
        // 收口时机改为页面滚动（onPageScroll → closeSwipesOnScroll）。
        this.hintSwipe();
      },

      onHide() {
        // 切页 / 跳去编辑页都不收回滑开的行：跨页保留原样（用户定稿）。
        // 只作废待执行的"退出多选"提示块：回到本页时 onShow 会自己收口
        this.clearExitTimer();
      },

      /**
       * 页面滚动，一次处理两件事：
       * 1) 收回滑开的行：列表滚起来，露出的删除/多选块就该收回去
       * 2) 顶部搜索栏显隐：下拉露出、往下翻收起（方向判定在 utils/search-reveal）
       */
      onPageScroll(e: { scrollTop: number }) {
        this.closeSwipesOnScroll();
        this.onPageScrollSearch(e.scrollTop);
      },

      /**
       * 把 store 的过滤结果 + 标签筛选同步到 data
       * @param extra 需要与本次刷新合并进**同一次 setData** 的字段
       *   （删除时若"先复原收起态、下一帧才移除条目"，那一条会先复原一帧，列表看着闪一下）
       */
      refresh(extra: Partial<NotesListData> = {}) {
        // 可选标签从"全部记事"收集（不受当前 tab / 搜索影响）：
        // 筛选行的职责是"告诉我有哪些标签可点"，列表为空时标签行也应该还在
        const tagOptions: string[] = [];
        const seen = new Set<string>();
        notesStore.items.forEach((n) =>
          (n.tags ?? []).forEach((t) => {
            if (seen.has(t)) return;
            seen.add(t);
            tagOptions.push(t);
          })
        );

        // 标签筛选是页面本地状态：store 的 visibleItems 只管类型 + 关键词，
        // 叠加在这里，避免为一次性筛选去扩 store 的查询面
        const activeTag = this.data.activeTag;
        const items = activeTag
          ? notesStore.visibleItems.filter((n) => (n.tags ?? []).includes(activeTag))
          : notesStore.visibleItems.slice();

        // 待办完成度按「全部待办」统计：不受搜索关键词与当前 tab 影响，
        // 否则切到「笔记」或搜了个关键词，进度条就会无故跳动（它统计的是"全部待办"）
        const todos = notesStore.items.filter((n) => n.kind === NoteKind.Todo);
        const patch: Partial<NotesListData> = {
          items,
          tagOptions,
          totalCount: notesStore.totalCount,
          pendingCount: notesStore.pendingCount,
          todoBar: todoProgressView(todos.filter((n) => n.done).length, todos.length),
        };
        this.setData(Object.assign(patch, extra));
        // 列表变化后重新校准选中态（例如搜索关键词变化导致可见项变少）
        if (this.data.selecting) this.syncPick();
        // 内容长度变了：短到不能滚动时让搜索栏常驻（否则用户永远做不出"下拉"把它拉出来）
        this.checkSearchRevealFit();
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
       * 点标签胶囊切换标签筛选；再点已选中的那个取消（回到全部）
       * @param e 事件，dataset.tag 为标签文本
       */
      onTagFilter(e: { currentTarget: { dataset: { tag: string } } }) {
        const tag = String(e.currentTarget.dataset.tag ?? '');
        const next = tag === this.data.activeTag ? '' : tag;
        haptic('light');
        this.setData({ activeTag: next });
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
