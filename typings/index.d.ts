/// <reference types="miniprogram-api-typings" />

/**
 * mobx-miniprogram-bindings 类型声明
 *
 * 该包 package.json 里声明了 `"types": "types/src/index.d.ts"`，但实际发布产物中
 * `types/src/` 下只有编译后的 `.js`，**并没有 .d.ts**，因此这里必须手动补一份声明，
 * 否则页面里 import createStoreBindings 会报"找不到类型声明"。
 *
 * 注意：`mobx-miniprogram` 本体自带 `dist/mobx.d.ts`，**不需要**在这里重复声明——
 * 重复声明会覆盖官方类型并把 observable/action 全部退化成 any，从而丢掉整个 store 层的类型检查。
 *
 * 官方 API 文档：https://developers.weixin.qq.com/miniprogram/dev/extended/mobx-miniprogram.html
 */

declare module 'mobx-miniprogram-bindings' {
  /** store 字段映射：可以是字段名字符串数组，或 目标字段名 -> store 字段名/函数 的映射 */
  type StoreFields = string[] | Record<string, string | ((store: never) => unknown)>;

  /** store action 映射：可以是 action 名字符串数组，或 方法名 -> store action 名 的映射 */
  type StoreActions = string[] | Record<string, string>;

  /** createStoreBindings 的选项 */
  interface StoreBindingsOptions<S = unknown> {
    /** 要绑定的 store 对象（mobx-miniprogram observable） */
    store: S;
    /** 字段映射 */
    fields: StoreFields;
    /** action 映射 */
    actions?: StoreActions;
    /** 命名空间 */
    namespace?: string;
    /** 是否使用结构比较 */
    structuralComparison?: boolean;
  }

  /** store 绑定实例，可用于更新与销毁 */
  interface StoreBindings {
    updateStoreBindings: () => void;
    destroyStoreBindings: () => void;
  }

  /**
   * 在页面/组件实例上创建 store 绑定
   * @param target 页面或组件实例（this）
   * @param options 绑定选项
   * @returns 绑定实例，含 updateStoreBindings / destroyStoreBindings
   */
  function createStoreBindings<S>(
    target: unknown,
    options: StoreBindingsOptions<S>
  ): StoreBindings;

  /**
   * 初始化 store 绑定（生命周期自动管理）
   * @param options { self: 实例, lifetime: 生命周期注册函数 }
   * @param storeBindings 绑定选项
   */
  function initStoreBindings<S>(
    options: { self: unknown; lifetime: (name: string, fn: () => void) => void },
    storeBindings: StoreBindingsOptions<S>
  ): StoreBindings;

  /** storeBindings Behavior，可在 Component / Behavior 中使用 */
  const storeBindingsBehavior: unknown;

  /** 带有 store 绑定的 Behavior 工厂 */
  function BehaviorWithStore(definition: unknown): unknown;

  /** 带有 store 绑定的 Component 工厂 */
  function ComponentWithStore(definition: unknown): void;

  export {
    createStoreBindings,
    initStoreBindings,
    storeBindingsBehavior,
    BehaviorWithStore,
    ComponentWithStore,
    StoreBindingsOptions,
    StoreBindings,
    StoreFields,
    StoreActions,
  };
}
