/** 反馈类型 */
export type FeedbackTypeId = "patrol" | "report" | "warning" | "account" | "other";

/** 反馈处理状态 */
export type FeedbackStatus = "pending" | "processing" | "resolved";

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  pending: "待处理",
  processing: "处理中",
  resolved: "已解决",
};

export interface FaqItem {
  id: string;
  /** 与筛选分类一致 */
  category: "patrol" | "report" | "warning" | "account";
  question: string;
  answer: string;
}

export interface FeedbackTicket {
  feedbackNo: string;
  type: FeedbackTypeId;
  content: string;
  images: string[];
  contact: string;
  status: FeedbackStatus;
  createdAt: number;
  /** 云端文档 _id */
  cloudDocId?: string;
  /** 云端图片 fileID，用于展示 */
  imageFileIds?: string[];
}
