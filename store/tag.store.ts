/**
 * 快速标签状态层：记账页标签条的数据源
 */
import { observable, action } from 'mobx-miniprogram';
import { TagService } from '../service/tag.service';

/** 标签 store 的形状（显式声明以保留 this 的类型信息） */
export interface TagStore {
  /** 标签列表（环序） */
  tags: string[]
  /** 当前居中的标签（空串表示尚无记录） */
  center: string
  /** 读取标签与居中项 */
  load(): void
  /** 新增标签（追加尾部） */
  add(tag: string): void
  /** 删除标签 */
  remove(tag: string): void
  /** 恢复默认标签 */
  resetDefaults(): void
  /** 记录新的居中项（循环轮转落位后调用） */
  setCenter(tag: string): void
}

export const tagStore = observable({
  tags: [] as string[],
  center: '',

  load: action(function (this: TagStore) {
    this.tags = TagService.get();
    this.center = TagService.getCenter();
  }),

  add: action(function (this: TagStore, tag: string) {
    this.tags = TagService.add(tag);
  }),

  remove: action(function (this: TagStore, tag: string) {
    this.tags = TagService.remove(tag);
    this.center = TagService.getCenter();
  }),

  resetDefaults: action(function (this: TagStore) {
    this.tags = TagService.resetDefaults();
    this.center = TagService.getCenter();
  }),

  setCenter: action(function (this: TagStore, tag: string) {
    TagService.setCenter(tag);
    this.center = tag;
  }),
}) as TagStore;
