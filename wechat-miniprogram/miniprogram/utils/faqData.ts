import type { FaqItem } from "../types/helpFeedback";

/** 常见问题（可后续改为云配置） */
export const FAQ_LIST: FaqItem[] = [
  {
    id: "p1",
    category: "patrol",
    question: "巡查打卡定位不准怎么办？",
    answer:
      "请确认已授权位置权限，并在开阔区域稍等几秒后重试。可在打卡页使用「地图微调」选择准确点位；若仍偏差，请检查系统定位服务是否开启。",
  },
  {
    id: "p2",
    category: "patrol",
    question: "发现隐患必须上传图片吗？",
    answer:
      "选择「发现隐患」时，需至少填写隐患描述或上传现场图片中的一项，以便后台研判与跟进。",
  },
  {
    id: "r1",
    category: "report",
    question: "火情上报需要几张照片？",
    answer: "至少上传 1 张现场照片，最多 3 张。建议包含火点、周边环境及参照物。",
  },
  {
    id: "r2",
    category: "report",
    question: "无网络时上报会丢失吗？",
    answer:
      "不会。无网络时数据会暂存本地，联网后将自动同步；您可在「我上报的火情」中查看记录与状态。",
  },
  {
    id: "w1",
    category: "warning",
    question: "如何关闭某类预警通知？",
    answer:
      "进入「我的 → 预警消息设置」，可关闭总开关或按分类（火险等级、雷电/干旱等）单独设置，并可配置免打扰时段与接收半径。",
  },
  {
    id: "w2",
    category: "warning",
    question: "预警推送延迟怎么办？",
    answer:
      "请检查是否开启对应推送渠道（服务通知/站内消息等），并确认未处于免打扰时段；仍异常请联系技术支持并提供时间与截图。",
  },
  {
    id: "a1",
    category: "account",
    question: "如何修改个人信息与头像？",
    answer: "在「我的」点击头像区域进入「编辑资料」，可修改姓名、角色等信息并保存。",
  },
  {
    id: "a2",
    category: "account",
    question: "退出登录后数据还在吗？",
    answer:
      "本地缓存与云端同步的数据仍保留在服务器侧；本机仅清除登录态，重新登录后可继续查看历史记录（以实际业务策略为准）。",
  },
];

export const FAQ_CATEGORY_TABS: Array<{ key: "all" | FaqItem["category"]; label: string }> = [
  { key: "all", label: "全部" },
  { key: "patrol", label: "巡查打卡" },
  { key: "report", label: "火情上报" },
  { key: "warning", label: "预警通知" },
  { key: "account", label: "账号问题" },
];
