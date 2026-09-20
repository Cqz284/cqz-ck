/**
 * 通用进度条
 *
 * 首页的额度进度（月预算 / 每日额度）与待办完成度共用一件事：
 * 「一个百分比 + 一条按档位变色的条 + 一行说明」。
 * 只负责渲染：percent / level 由页面用 utils/budget.ts 的纯函数算好传进来，
 * 组件不做业务判断，这样"条的长度"和"文案里的数字"永远同源。
 */
Component({
  properties: {
    /** 左侧标题 */
    label: { type: String, value: '' },
    /** 右侧数值文案 */
    value: { type: String, value: '' },
    /** 进度百分比（0~100，已夹取） */
    percent: { type: Number, value: 0 },
    /** 颜色档位：normal / warn / over */
    level: { type: String, value: 'normal' },
    /** 次要说明（为空则不显示） */
    hint: { type: String, value: '' },
  },
});
