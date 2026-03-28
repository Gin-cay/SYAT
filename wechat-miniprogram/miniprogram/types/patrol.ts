/** 巡查情况：正常 / 发现隐患 */
export type PatrolStatus = "normal" | "hazard";

/**
 * 防火巡查打卡记录（本地与云端统一结构）
 * - id：客户端生成的业务主键，用于去重与离线同步
 */
export interface PatrolCheckinRecord {
  id: string;
  /** 巡查地点描述 */
  place: string;
  latitude: number;
  longitude: number;
  /** 巡查人员姓名 */
  inspector: string;
  /** 展示用时间字符串 */
  time: string;
  /** 打卡时间戳（毫秒），用于排序与云库索引 */
  createdAt: number;
  status: PatrolStatus;
  hazardDesc: string;
  images: string[];
  patrolStartText: string;
  patrolEndText: string;
  patrolDurationMin: number | null;
  highFireRiskAltitude: boolean;
  altitudeM?: number;
  /** 隐患语音（仅部分页面使用） */
  voicePath?: string;
  voiceDurationSec?: number;
  /** 是否已同步到自建 REST 批量接口 */
  synced?: boolean;
}

/** 云数据库文档（含 _id、_openid） */
export interface PatrolCloudDoc extends PatrolCheckinRecord {
  _id?: string;
  _openid?: string;
  clientId: string;
}
