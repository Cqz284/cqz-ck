import { ledgerStore } from '../../store/ledger.store';
import { notesStore } from '../../store/notes.store';
import { StorageService } from '../../service/storage';
import { APP_NAME, APP_VERSION_TEXT } from '../../utils/app-info';
import { LIGHT_COLORS, applyPageTheme, attachPageTheme, detachPageTheme } from '../../utils/theme';

/** 页面 data */
interface AboutData {
  appName: string;
  versionText: string;
  ledgerCount: number;
  noteCount: number;
  usageText: string;
  pageStyle: string;
  pageBg: string;
  navBarBg: string;
  navBarColor: 'black' | 'white';
}

/** 页面自定义实例字段与方法 */
interface AboutCustom {
  refresh(): void;
}

Page<AboutData, AboutCustom>({
  data: {
    appName: APP_NAME,
    versionText: APP_VERSION_TEXT,
    ledgerCount: 0,
    noteCount: 0,
    usageText: '0 B',
    pageStyle: '',
    pageBg: LIGHT_COLORS.pageBg,
    navBarBg: LIGHT_COLORS.pageBg,
    navBarColor: 'black',
  },

  onLoad() {
    attachPageTheme(this);
  },

  onUnload() {
    detachPageTheme(this);
  },

  onShow() {
    ledgerStore.load();
    notesStore.load();
    this.refresh();
    applyPageTheme(this);
  },

  /** 刷新统计信息 */
  refresh() {
    this.setData({
      ledgerCount: ledgerStore.records.length,
      noteCount: notesStore.totalCount,
      usageText: formatBytes(StorageService.usage().bytes),
    });
  },
});

/**
 * 字节数格式化
 * @param bytes 字节数
 * @returns 展示文本
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}
