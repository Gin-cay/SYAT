/** 后端或云库中的处置状态 */
export type FireReportProcessStatus = "submitted" | "processing" | "done";

export const FIRE_REPORT_STATUS_LABEL: Record<FireReportProcessStatus, string> = {
  submitted: "已上报",
  processing: "处理中",
  done: "已处理",
};

/** 本地/队列/云端统一的火情上报记录 */
export interface FireReportRecord {
  id: string;
  createdAt: number;
  /** 展示用上报时间 */
  reportTime: string;
  location: string;
  latitude: number;
  longitude: number;
  /** 本地持久化的图片路径（最多 3 张） */
  images: string[];
  reporterName: string;
  reporterPhone: string;
  processStatus: FireReportProcessStatus;
  /** 仅队列中未上传成功时为 true */
  pendingSync?: boolean;
}

/** 列表展示用（含状态文案） */
export interface FireReportListItem extends FireReportRecord {
  statusLabel: string;
  coordText: string;
}
