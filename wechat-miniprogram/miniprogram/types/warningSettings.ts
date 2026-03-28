/** 预警消息设置（本地 + 云库同步） */
export interface WarningCategoryFlags {
  /** 火险等级预警（Ⅰ~Ⅴ级） */
  fireRiskLevels: boolean;
  /** 雷电/干旱预警 */
  lightningDrought: boolean;
  /** 火情上报通知 */
  fireReportNotify: boolean;
  /** 巡查任务提醒 */
  patrolReminder: boolean;
}

export interface WarningChannelFlags {
  /** 微信服务通知（订阅消息） */
  serviceTemplate: boolean;
  /** 小程序内消息 */
  inApp: boolean;
  /** 短信推送 */
  sms: boolean;
}

export interface WarningDndSettings {
  enabled: boolean;
  /** HH:mm */
  start: string;
  /** HH:mm */
  end: string;
}

export interface WarningRegionSettings {
  /** 与 userProfileStorage FORESTS 下标一致 */
  forestIndex: number;
  /** 关注网格 0~4 对应 1~5 号网格 */
  gridIndex: number;
  /** 预警接收半径 km */
  radiusKm: number;
}

export type WarningTemplateId = "default" | "detail" | "brief";

export interface WarningContentSettings {
  templateId: WarningTemplateId;
  voiceBroadcast: boolean;
}

export interface WarningSettingsState {
  /** 通知总开关 */
  masterEnabled: boolean;
  /** 总开关关闭前保存的分类状态，用于再次打开时恢复 */
  categorySnapshot: WarningCategoryFlags;
  categories: WarningCategoryFlags;
  channels: WarningChannelFlags;
  dnd: WarningDndSettings;
  region: WarningRegionSettings;
  content: WarningContentSettings;
  updatedAt: number;
}

/** 最近预警接收记录（展示用） */
export interface WarningReceiveLogItem {
  id: string;
  time: string;
  title: string;
  summary: string;
  level?: string;
}
