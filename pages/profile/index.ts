import { ledgerStore } from '../../store/ledger.store';
import { notesStore } from '../../store/notes.store';
import { settingsStore } from '../../store/settings.store';
import { StorageService } from '../../service/storage';
import { toText, copyToClipboard } from '../../utils/export';
import { buildBackup, parseBackup, applyBackup } from '../../utils/backup';
import type { BackupPayload, ParsedBackup } from '../../utils/backup';
import { haptic } from '../../utils/haptics';
import { APP_NAME, APP_LOGO, APP_VERSION_TEXT } from '../../utils/app-info';
import { format } from '../../utils/date';
import { LIGHT_COLORS, applyPageTheme, attachPageTheme, detachPageTheme } from '../../utils/theme';

/** 备份文件大小上限（5MB）：个人记账数据远达不到，超了基本是选错文件 */
const MAX_BACKUP_FILE_BYTES = 5 * 1024 * 1024;

/** 页面 data */
interface ProfileData {
  appName: string;
  appLogo: string;
  versionText: string;
  ledgerCount: number;
  noteCount: number;
  pendingCount: number;
  usageText: string;
  pageStyle: string;
  pageBg: string;
  navBarBg: string;
  navBarColor: 'black' | 'white';
}

/** 页面自定义实例字段与方法 */
interface ProfileCustom {
  refresh(): void;
  goSettings(): void;
  goAbout(): void;
  onExport(): void;
  onBackup(): void;
  onRestore(): void;
  pickBackupFile(): void;
  readClipboardBackup(): void;
  restoreFromText(text: string): void;
  applyParsed(parsed: ParsedBackup, mode: 'merge' | 'overwrite'): void;
  onClear(): void;
}

Page<ProfileData, ProfileCustom>({
  data: {
    appName: APP_NAME,
    appLogo: APP_LOGO,
    versionText: APP_VERSION_TEXT,
    ledgerCount: 0,
    noteCount: 0,
    pendingCount: 0,
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
    // 先套主题（内部会重钉 tabBar）：系统 tabBar 可能在页面切换时被框架按 theme.json 重画过，
    // 越早钉，越不容易看到"tab 栏先错一下再变对"
    applyPageTheme(this);
    ledgerStore.load();
    notesStore.load();
    settingsStore.load();
    this.refresh();
  },

  /** 刷新概览（此前是直接复用 onShow，语义上不该把生命周期当刷新函数用） */
  refresh() {
    const usage = StorageService.usage();
    const s = settingsStore.settings;
    this.setData({
      ledgerCount: ledgerStore.records.length,
      noteCount: notesStore.totalCount,
      pendingCount: notesStore.pendingCount,
      usageText: formatBytes(usage.bytes),
      settingsSummary: `${s.currency} · 震动${s.haptics ? '开' : '关'}`,
    });
  },

  /** 进入二级页：设置 */
  goSettings() {
    haptic('light');
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  /** 进入二级页：关于 */
  goAbout() {
    haptic('light');
    wx.navigateTo({ url: '/pages/about/index' });
  },

  /** 导出全部数据到剪贴板（人读文本，发给他人查看用） */
  onExport() {
    haptic('light');
    try {
      const text = toText();
      copyToClipboard(text)
        .then(() => {
          haptic('medium');
          wx.showToast({ title: '已复制到剪贴板', icon: 'success' });
        })
        .catch(() => wx.showToast({ title: '复制失败', icon: 'none' }));
    } catch (err) {
      wx.showToast({ title: err instanceof Error ? err.message : '导出失败', icon: 'none' });
    }
  },

  /**
   * 备份到文件：生成机器可恢复的 JSON 并唤起微信转发
   * （发到「文件传输助手」或任意聊天；shareFileMessage 必须由用户手势触发，此处即点击回调）
   */
  onBackup() {
    haptic('light');
    let json: string;
    try {
      json = buildBackup().json;
    } catch (err) {
      wx.showToast({ title: err instanceof Error ? err.message : '备份失败', icon: 'none' });
      return;
    }
    // 文件名只留数字，避免特殊字符在不同设备上被改名
    const stamp = format(Date.now(), 'YYYY-MM-DD HH:mm').replace(/[^0-9]/g, '');
    const fileName = `ledger-notes-backup-${stamp}.json`;
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
    try {
      wx.getFileSystemManager().writeFileSync(filePath, json, 'utf8');
    } catch (err) {
      console.error('[backup] 写入失败', err);
      wx.showToast({ title: '备份文件写入失败', icon: 'none' });
      return;
    }
    wx.shareFileMessage({
      filePath,
      fileName,
      success: () => {
        haptic('medium');
        wx.showToast({ title: '已发出，建议发到文件传输助手', icon: 'none' });
      },
      fail: (res) => {
        const msg = (res && res.errMsg) || '';
        if (msg.indexOf('cancel') >= 0) return; // 用户主动取消，不打扰
        wx.showToast({ title: '未完成发送，可重试', icon: 'none' });
      },
    });
  },

  /** 从备份恢复：先选来源 */
  onRestore() {
    haptic('light');
    wx.showActionSheet({
      itemList: ['从聊天记录选择文件', '从剪贴板粘贴'],
      success: (res) => {
        if (res.tapIndex === 0) this.pickBackupFile();
        else this.readClipboardBackup();
      },
    });
  },

  /** 来源一：从聊天记录里选备份文件 */
  pickBackupFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        if (file.size > MAX_BACKUP_FILE_BYTES) {
          wx.showToast({ title: '文件过大，请选择本应用导出的备份', icon: 'none' });
          return;
        }
        try {
          const text = wx.getFileSystemManager().readFileSync(file.path, 'utf8');
          this.restoreFromText(String(text));
        } catch (err) {
          console.error('[backup] 读取失败', err);
          wx.showToast({ title: '文件读取失败', icon: 'none' });
        }
      },
    });
  },

  /** 来源二：从剪贴板读备份 JSON */
  readClipboardBackup() {
    wx.getClipboardData({
      success: (res) => this.restoreFromText(String(res.data ?? '')),
      fail: () => wx.showToast({ title: '剪贴板读取失败', icon: 'none' }),
    });
  },

  /** 解析备份文本并让用户选择导入模式 */
  restoreFromText(text: string) {
    let parsed: ParsedBackup;
    try {
      parsed = parseBackup(text);
    } catch (err) {
      wx.showToast({
        title: err instanceof Error ? err.message : '备份解析失败',
        icon: 'none',
      });
      return;
    }
    wx.showActionSheet({
      itemList: ['合并导入（保留本机已有）', '覆盖导入（完全替换）'],
      success: (res) => {
        this.applyParsed(parsed, res.tapIndex === 1 ? 'overwrite' : 'merge');
      },
    });
  },

  /** 确认并落库：覆盖前给不可恢复警告；导入后刷新 store 与概览 */
  applyParsed(parsed: ParsedBackup, mode: 'merge' | 'overwrite') {
    const { payload, dropped } = parsed;
    const droppedCount = dropped.records + dropped.notes;
    const droppedTip = droppedCount > 0 ? `其中 ${droppedCount} 条损坏数据将被跳过。` : '';
    const summary = `备份导出于 ${payload.exportedAt || '未知时间'}，含记账 ${payload.records.length} 条、记事 ${payload.notes.length} 条。${droppedTip}`;
    const isOverwrite = mode === 'overwrite';
    wx.showModal({
      title: isOverwrite ? '覆盖导入确认' : '确认合并导入',
      content: isOverwrite
        ? `将删除本机全部数据并替换为备份内容！${summary}此操作不可恢复。`
        : `将补入备份中的新数据，本机已有记录不受影响。${summary}`,
      success: (res) => {
        if (!res.confirm) return;
        let result: { addedRecords: number; addedNotes: number };
        try {
          result = applyBackup(payload, mode);
        } catch (err) {
          wx.showToast({ title: err instanceof Error ? err.message : '导入失败', icon: 'none' });
          return;
        }
        // 备份写入走 StorageService（缓存已同步更新），store 重新 load 即可
        ledgerStore.load();
        notesStore.load();
        settingsStore.load();
        haptic('medium');
        this.refresh();
        wx.showToast({
          title: `已导入：记账 ${result.addedRecords} 条、记事 ${result.addedNotes} 条`,
          icon: 'none',
        });
      },
    });
  },

  /** 清空全部数据（二次确认） */
  onClear() {
    wx.showModal({
      title: '确认清空',
      content: '将删除全部记账与记事数据，不可恢复',
      success: (res) => {
        if (!res.confirm) return;
        try {
          ledgerStore.clearAll();
          notesStore.clearAll();
        } catch (err) {
          wx.showToast({ title: err instanceof Error ? err.message : '清空失败', icon: 'none' });
          return;
        }
        haptic('heavy');
        this.refresh();
        wx.showToast({ title: '已清空', icon: 'success' });
      },
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
