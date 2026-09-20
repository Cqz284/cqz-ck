/**
 * 快速标签业务层的单测：默认值、新增校验、居中项持久化
 */
import { TagService, TagError, DEFAULT_QUICK_TAGS, MAX_QUICK_TAGS } from '../../service/tag.service';
import { StorageService, StorageKeys } from '../../service/storage';

const storageMock = (global as unknown as { __wxStorageMock: Map<string, unknown> }).__wxStorageMock;

describe('TagService.get', () => {
  beforeEach(() => {
    StorageService.clearCache();
    storageMock.clear();
  });

  it('未存储时返回默认列表的副本', () => {
    expect(TagService.get()).toEqual([...DEFAULT_QUICK_TAGS]);
  });

  it('返回副本：调用方修改不影响后续读取', () => {
    const list = TagService.get();
    list.push('脏数据');
    expect(TagService.get()).toEqual([...DEFAULT_QUICK_TAGS]);
  });

  it('读取已存储的列表', () => {
    storageMock.set(StorageKeys.QuickTags, { tags: ['餐饮', '奶茶'], center: '' });
    StorageService.clearCache();
    expect(TagService.get()).toEqual(['餐饮', '奶茶']);
  });

  it('存储为空列表时如实返回空数组（用户删光了标签，不能"复活"默认值）', () => {
    storageMock.set(StorageKeys.QuickTags, { tags: [], center: '' });
    StorageService.clearCache();
    expect(TagService.get()).toEqual([]);
  });

  it('剔除已存数据中的空值/超长/重复项', () => {
    storageMock.set(StorageKeys.QuickTags, {
      tags: ['餐饮', '  ', '餐饮', 'x'.repeat(21), '奶茶'],
      center: '',
    });
    StorageService.clearCache();
    expect(TagService.get()).toEqual(['餐饮', '奶茶']);
  });
});

describe('TagService.add', () => {
  beforeEach(() => {
    StorageService.clearCache();
    storageMock.clear();
  });

  it('新增追加到尾部并落盘', () => {
    const next = TagService.add('奶茶');
    expect(next).toEqual([...DEFAULT_QUICK_TAGS, '奶茶']);
    expect(storageMock.get(StorageKeys.QuickTags)).toEqual({
      tags: [...DEFAULT_QUICK_TAGS, '奶茶'],
      center: '',
    });
  });

  it('新增前后空白的输入会被修剪', () => {
    expect(TagService.add('  奶茶  ')).toEqual([...DEFAULT_QUICK_TAGS, '奶茶']);
  });

  it('重复标签报错', () => {
    expect(() => TagService.add(DEFAULT_QUICK_TAGS[0])).toThrow(TagError);
    expect(() => TagService.add(` ${DEFAULT_QUICK_TAGS[0]} `)).toThrow(TagError);
  });

  it('空值与超长报错', () => {
    expect(() => TagService.add('   ')).toThrow(TagError);
    expect(() => TagService.add('x'.repeat(21))).toThrow(TagError);
    expect(() => TagService.add('x'.repeat(20))).not.toThrow();
  });

  it('超过总量上限报错', () => {
    const full = Array.from({ length: MAX_QUICK_TAGS }, (_, i) => `标签${i}`);
    storageMock.set(StorageKeys.QuickTags, { tags: full, center: '' });
    StorageService.clearCache();
    expect(() => TagService.add('再加一个')).toThrow(/最多/);
  });
});

describe('TagService.setCenter / getCenter', () => {
  beforeEach(() => {
    StorageService.clearCache();
    storageMock.clear();
  });

  it('未存储时 getCenter 返回空串', () => {
    expect(TagService.getCenter()).toBe('');
  });

  it('居中项与列表一起落盘', () => {
    TagService.setCenter('娱乐');
    expect(storageMock.get(StorageKeys.QuickTags)).toEqual({
      tags: [...DEFAULT_QUICK_TAGS],
      center: '娱乐',
    });
    expect(TagService.getCenter()).toBe('娱乐');
  });

  it('居中项不在列表中时报错', () => {
    expect(() => TagService.setCenter('不存在的标签')).toThrow(TagError);
  });

  it('读取到失效的居中项（列表已不含）时返回空串', () => {
    storageMock.set(StorageKeys.QuickTags, { tags: ['餐饮'], center: '已被移除的' });
    StorageService.clearCache();
    expect(TagService.getCenter()).toBe('');
  });

  it('新增标签不影响已记录的居中项', () => {
    TagService.setCenter('娱乐');
    TagService.add('奶茶');
    expect(TagService.getCenter()).toBe('娱乐');
  });
});

describe('TagService.save', () => {
  beforeEach(() => {
    StorageService.clearCache();
    storageMock.clear();
  });

  it('去重并按首次出现顺序保存', () => {
    expect(TagService.save(['a', 'b', 'a', ' c ', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('允许保存空列表（用户可以把标签删光）', () => {
    expect(TagService.save([])).toEqual([]);
    expect(storageMock.get(StorageKeys.QuickTags)).toEqual({ tags: [], center: '' });
  });

  it('超过上限报错且不落盘', () => {
    const over = Array.from({ length: MAX_QUICK_TAGS + 1 }, (_, i) => `t${i}`);
    expect(() => TagService.save(over)).toThrow(/最多/);
    expect(storageMock.has(StorageKeys.QuickTags)).toBe(false);
  });
});

describe('TagService.remove', () => {
  beforeEach(() => {
    StorageService.clearCache();
    storageMock.clear();
  });

  it('删除指定标签并落盘', () => {
    const next = TagService.remove('娱乐');
    expect(next).toEqual(['餐饮', '交通', '购物', '医疗', '工资']);
    expect(storageMock.get(StorageKeys.QuickTags)).toEqual({
      tags: ['餐饮', '交通', '购物', '医疗', '工资'],
      center: '',
    });
  });

  it('删掉的正是居中项时清空居中记录', () => {
    TagService.setCenter('娱乐');
    TagService.remove('娱乐');
    expect(TagService.getCenter()).toBe('');
  });

  it('删掉其他标签时保留居中项', () => {
    TagService.setCenter('娱乐');
    TagService.remove('餐饮');
    expect(TagService.getCenter()).toBe('娱乐');
  });

  it('可以一路删空（不设下限）', () => {
    for (const tag of [...DEFAULT_QUICK_TAGS]) TagService.remove(tag);
    expect(TagService.get()).toEqual([]);
    expect(TagService.getCenter()).toBe('');
  });

  it('删除不存在的标签报错', () => {
    expect(() => TagService.remove('不存在')).toThrow(TagError);
  });
});

describe('TagService.resetDefaults', () => {
  beforeEach(() => {
    StorageService.clearCache();
    storageMock.clear();
  });

  it('删空后可以恢复默认标签', () => {
    TagService.remove('餐饮');
    const list = TagService.resetDefaults();
    expect(list).toEqual([...DEFAULT_QUICK_TAGS]);
    expect(TagService.get()).toEqual([...DEFAULT_QUICK_TAGS]);
  });

  it('恢复默认时保留仍然存在的居中项，失效的则清空', () => {
    TagService.setCenter('娱乐');
    expect(TagService.resetDefaults()).toEqual([...DEFAULT_QUICK_TAGS]);
    expect(TagService.getCenter()).toBe('娱乐');

    TagService.add('奶茶');
    TagService.setCenter('奶茶');
    TagService.resetDefaults(); // 奶茶不在默认列表里
    expect(TagService.getCenter()).toBe('');
  });
});
