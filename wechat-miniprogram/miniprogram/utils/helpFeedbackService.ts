import type { FeedbackTicket, FeedbackTypeId } from "../types/helpFeedback";

const LOCAL_KEY = "feedback_tickets_v1";
const CLOUD_COLLECTION = "feedback_tickets";

function genFeedbackNo(): string {
  return `FB${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`;
}

function readLocal(): FeedbackTicket[] {
  try {
    const list = wx.getStorageSync(LOCAL_KEY) as unknown;
    return Array.isArray(list) ? (list as FeedbackTicket[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: FeedbackTicket[]) {
  try {
    wx.setStorageSync(LOCAL_KEY, list.slice(0, 100));
  } catch {}
}

function normalizeStatus(s: string): FeedbackTicket["status"] {
  if (s === "processing" || s === "resolved" || s === "pending") return s;
  return "pending";
}

async function uploadImages(paths: string[]): Promise<string[]> {
  if (!wx.cloud || !paths.length) return [];
  const fileIds: string[] = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const cloudPath = `feedback/${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    try {
      const res = await wx.cloud.uploadFile({ cloudPath, filePath: p });
      if (res.fileID) fileIds.push(res.fileID);
    } catch (e) {
      console.warn("[helpFeedback] uploadFile fail", e);
    }
  }
  return fileIds;
}

export async function submitFeedback(input: {
  type: FeedbackTypeId;
  content: string;
  images: string[];
  contact: string;
}): Promise<{ feedbackNo: string; ticket: FeedbackTicket }> {
  const feedbackNo = genFeedbackNo();
  const createdAt = Date.now();
  const imageFileIds = await uploadImages(input.images.slice(0, 3));

  const ticket: FeedbackTicket = {
    feedbackNo,
    type: input.type,
    content: input.content.trim(),
    images: input.images.slice(0, 3),
    contact: (input.contact || "").trim(),
    status: "pending",
    createdAt,
    imageFileIds: imageFileIds.length ? imageFileIds : undefined,
  };

  const list = readLocal();
  list.unshift(ticket);
  writeLocal(list);

  if (wx.cloud) {
    try {
      const addRes = await wx.cloud.database().collection(CLOUD_COLLECTION).add({
        data: {
          clientFeedbackNo: feedbackNo,
          type: ticket.type,
          content: ticket.content,
          contact: ticket.contact,
          imageFileIds,
          status: ticket.status,
          createdAt,
        },
      });
      if (addRes._id) {
        ticket.cloudDocId = addRes._id;
        const next = readLocal().map((t) =>
          t.feedbackNo === feedbackNo ? { ...t, cloudDocId: addRes._id } : t
        );
        writeLocal(next);
      }
    } catch (e) {
      console.warn("[helpFeedback] cloud add failed", e);
    }
  }

  return { feedbackNo, ticket };
}

export async function fetchFeedbackHistory(): Promise<FeedbackTicket[]> {
  let list = readLocal();
  if (!wx.cloud) return list.sort((a, b) => b.createdAt - a.createdAt);

  try {
    const db = wx.cloud.database();
    const col = db.collection(CLOUD_COLLECTION);
    let res: { data?: Record<string, unknown>[] };
    try {
      res = await col.orderBy("createdAt", "desc").limit(80).get();
    } catch {
      res = await col.limit(80).get();
    }
    const byNo = new Map<string, Record<string, unknown>>();
    (res.data || []).forEach((doc: Record<string, unknown>) => {
      const no = doc.clientFeedbackNo;
      if (no) byNo.set(String(no), doc);
    });
    list = list.map((t) => {
      const doc = byNo.get(t.feedbackNo);
      if (!doc) return t;
      return {
        ...t,
        status: normalizeStatus(String(doc.status || t.status)),
        cloudDocId: String(doc._id || t.cloudDocId || ""),
      };
    });
  } catch (e) {
    console.warn("[helpFeedback] fetch cloud failed", e);
  }
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

/** 用户将单条标记为已解决（仅本地 + 尝试更新云） */
export async function markTicketResolved(feedbackNo: string): Promise<void> {
  const list = readLocal().map((t) =>
    t.feedbackNo === feedbackNo ? { ...t, status: "resolved" as const } : t
  );
  writeLocal(list);

  const t = list.find((x) => x.feedbackNo === feedbackNo);
  if (!wx.cloud || !t?.cloudDocId) return;
  try {
    await wx.cloud.database().collection(CLOUD_COLLECTION).doc(t.cloudDocId).update({
      data: { status: "resolved", resolvedAt: Date.now() },
    });
  } catch {}
}
