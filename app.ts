// app.ts
import { settingsStore } from './store/settings.store';
import { refreshTheme } from './utils/theme';

App({
  onLaunch() {
    // 设置里有影响全局行为的开关（震动反馈），启动时就要落地生效，
    // 不能等某个页面 onShow 才同步
    try {
      settingsStore.load();
    } catch (e) {
      // 存储异常不应阻塞启动，走默认值
    }

    try {
      // 启动时钉一次主题（跟随系统）：tabBar 的配色与图标必须与页面主题一致
      refreshTheme();
    } catch (e) {
      // 主题应用失败不应阻塞启动
    }
  },
});
