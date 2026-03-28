import {
  FIRE_REPORT_STATUS_LABEL,
  type FireReportListItem,
  type FireReportProcessStatus,
  type FireReportRecord,
} from "../types/fireReport";

const QUEUE_KEY = "fire_reports_queue_v1";
const HISTORY_KEY = "fire_reports_history_v1";
const CLOUD_COLLECTION = "fire_reports";

let flushing = false;
let networkBound = false;

function getBaseUrl(): string {
  const app = getApp<IAppOption>();
  return String(app?.globalData?.pythonBackendBaseUrl || "").trim();
}

function getUploadUrl(): string {
  const base = getBaseUrl();
  if (!base) return "";
  return `${base.replace(/\/+$/, "")}/fire_report`;
}

function getListUrl(): string {
  const app = getApp<IAppOption>();
  return String(app?.globalData?.fireReportListUrl || "").trim();
}

function nowText() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

function readList(key: string): FireReportRecord[] {
  try {
    const list = wx.getStorageSync(key) as unknown;
    return Array.isArray(list) ? normalizeHistoryList(list as Partial<FireReportRecord>[]) : [];
  } catch {
    return [];
  }
}

function legacyStatusToProcess(
  legacy?: string,
  processStatus?: string
): FireReportProcessStatus {
  if (processStatus === "processing" || processStatus === "done" || processStatus === "submitted") {
    return processStatus;
  }
  if (legacy === "处理中") return "processing";
  if (legacy === "已处理") return "done";
  return "submitted";
}

function normalizeHistoryList(
  raw: Array<Partial<FireReportRecord> & { status?: string; syncedAt?: string }>
): FireReportRecord[] {
  return raw.map((x) => ({
    id: String(x.id || `${Date.now()}`),
    createdAt: Number(x.createdAt) || 0,
    reportTime: String(x.reportTime || ""),
    location: String(x.location || ""),
    latitude: Number(x.latitude) || 0,
    longitude: Number(x.longitude) || 0,
    images: Array.isArray(x.images) ? (x.images as string[]) : [],
    reporterName: String(x.reporterName || ""),
    reporterPhone: String(x.reporterPhone || ""),
    processStatus: legacyStatusToProcess(x.status, x.processStatus as string),
    pendingSync: !!x.pendingSync,
  }));
}

function normalizeProcessStatus(s?: string): FireReportProcessStatus {
  if (s === "processing" || s === "done" || s === "submitted") return s;
  return "submitted";
}

function writeList(key: string, list: FireReportRecord[]) {
  try {
    wx.setStorageSync(key, list);
  } catch {}
}

export function readQueue(): FireReportRecord[] {
  return readList(QUEUE_KEY);
}

function writeQueue(list: FireReportRecord[]) {
  writeList(QUEUE_KEY, list);
}

export function readHistory(): FireReportRecord[] {
  return readList(HISTORY_KEY);
}

function addHistory(item: FireReportRecord) {
  const list = readHistory();
  const next = [item, ...list.filter((x) => x.id !== item.id)].slice(0, 100);
  writeList(HISTORY_KEY, next);
}

function removeByIds(ids: string[]) {
  const idSet = new Set(ids || []);
  const q = readQueue().filter((x) => !idSet.has(x.id));
  writeQueue(q);
}

function getNetworkType(): Promise<string> {
  return new Promise((resolve) => {
    wx.getNetworkType({
      success: (r) => resolve(r.networkType || "unknown"),
      fail: () => resolve("unknown"),
    });
  });
}

function isNetworkOk(type: string) {
  return !!type && type !== "none";
}

function persistFiles(paths: string[]) {
  const list = Array.isArray(paths) ? paths : [];
  if (!list.length) return Promise.resolve([] as string[]);
  return Promise.all(
    list.map(
      (p) =>
        new Promise<string>((resolve) => {
          wx.saveFile({
            tempFilePath: p,
            success: (r) => resolve(r.savedFilePath),
            fail: () => resolve(p),
          });
        })
    )
  );
}

function readFileAsBase64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: "base64",
      success: (res) => resolve(String(res.data || "")),
      fail: reject,
    });
  });
}

async function toBase64Images(paths: string[]) {
  const list = Array.isArray(paths) ? paths : [];
  const out: string[] = [];
  for (const p of list.slice(0, 3)) {
    try {
      const b64 = await readFileAsBase64(p);
      if (b64) out.push(b64);
    } catch {}
  }
  return out;
}

function queueRecord(record: FireReportRecord) {
  const q = readQueue();
  q.push({ ...record, pendingSync: true });
  q.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  writeQueue(q);
}

function mapToListItem(r: FireReportRecord): FireReportListItem {
  return {
    ...r,
    statusLabel: FIRE_REPORT_STATUS_LABEL[r.processStatus] || FIRE_REPORT_STATUS_LABEL.submitted,
    coordText: `${Number(r.latitude).toFixed(6)}, ${Number(r.longitude).toFixed(6)}`,
  };
}

function mergeById(...groups: FireReportRecord[][]): FireReportRecord[] {
  const map = new Map<string, FireReportRecord>();
  groups.flat().forEach((r) => {
    const prev = map.get(r.id);
    map.set(r.id, prev ? { ...prev, ...r } : { ...r });
  });
  return Array.from(map.values());
}

async function saveToCloud(record: FireReportRecord, processStatus: FireReportProcessStatus) {
  if (!wx.cloud) return;
  try {
    await wx.cloud.database().collection(CLOUD_COLLECTION).add({
      data: {
        clientId: record.id,
        location: record.location,
        latitude: record.latitude,
        longitude: record.longitude,
        reportTime: record.reportTime,
        reporterName: record.reporterName,
        reporterPhone: record.reporterPhone,
        processStatus,
        createdAt: record.createdAt,
      },
    });
  } catch (e) {
    console.warn("[fireReportSync] cloud add failed", e);
  }
}

async function uploadOne(record: FireReportRecord): Promise<{ ok: boolean; processStatus?: FireReportProcessStatus }> {
  const url = getUploadUrl();
  if (!url) return { ok: false };

  const images = await toBase64Images(record.images || []);
  if (!images.length) return { ok: false };

  const payload = {
    location: record.location || "",
    latitude: Number(record.latitude),
    longitude: Number(record.longitude),
    report_time: record.reportTime || nowText(),
    status: "submitted",
    reporter_name: record.reporterName,
    reporter_phone: record.reporterPhone || "",
    images,
  };

  return new Promise((resolve) => {
    wx.request({
      url,
      method: "POST",
      timeout: 30000,
      header: { "content-type": "application/json" },
      data: payload,
      success: (res) => {
        const data = res.data as { code?: number; process_status?: string; status?: string } | undefined;
        const ok =
          res && res.statusCode >= 200 && res.statusCode < 300 && data && (data as { code?: number }).code === 200;
        let processStatus: FireReportProcessStatus = "submitted";
        const ps = (data && (data.process_status || data.status)) || "";
        if (ps === "processing" || ps === "处理中") processStatus = "processing";
        else if (ps === "done" || ps === "已处理") processStatus = "done";
        resolve({ ok: !!ok, processStatus });
      },
      fail: () => resolve({ ok: false }),
    });
  });
}

export async function flushOfflineReports() {
  if (flushing) return { flushed: false, count: 0 };
  const net = await getNetworkType();
  if (!isNetworkOk(net)) return { flushed: false, count: 0 };
  const q = readQueue();
  if (!q.length) return { flushed: false, count: 0 };

  flushing = true;
  try {
    const successIds: string[] = [];
    for (const item of q) {
      const restUrl = getUploadUrl();
      if (!restUrl) {
        const ps = item.processStatus || "submitted";
        await saveToCloud({ ...item, processStatus: ps }, ps);
        addHistory({ ...item, processStatus: ps, pendingSync: false });
        successIds.push(item.id);
        continue;
      }
      const r = await uploadOne(item);
      if (r && r.ok) {
        successIds.push(item.id);
        const ps = r.processStatus || item.processStatus;
        addHistory({
          ...item,
          processStatus: ps,
          pendingSync: false,
        });
        await saveToCloud({ ...item, processStatus: ps }, ps);
      }
    }
    if (successIds.length) {
      removeByIds(successIds);
      return { flushed: true, count: successIds.length };
    }
    return { flushed: false, count: 0 };
  } finally {
    flushing = false;
  }
}

export function bindNetworkFlush() {
  if (networkBound) return;
  networkBound = true;
  if (!wx.onNetworkStatusChange) return;
  wx.onNetworkStatusChange((res) => {
    if (res && res.isConnected) flushOfflineReports();
  });
}

function createRecord(input: {
  location: string;
  latitude: number | string;
  longitude: number | string;
  images: string[];
  reporterName: string;
  reporterPhone: string;
  reportTime: string;
}): FireReportRecord {
  const ts = Date.now();
  return {
    id: `${ts}_${Math.floor(Math.random() * 10000)}`,
    createdAt: ts,
    location: input.location || "",
    latitude: Number(input.latitude) || 0,
    longitude: Number(input.longitude) || 0,
    reportTime: input.reportTime || nowText(),
    images: (Array.isArray(input.images) ? input.images : []).slice(0, 3),
    reporterName: input.reporterName || "",
    reporterPhone: input.reporterPhone || "",
    processStatus: "submitted",
    pendingSync: false,
  };
}

export async function submitFireReport(input: {
  location: string;
  latitude: number | string;
  longitude: number | string;
  images: string[];
  reporterName: string;
  reporterPhone: string;
  reportTime: string;
}): Promise<{ queued: boolean; uploaded: boolean; record: FireReportRecord }> {
  const savedImages = await persistFiles(input.images || []);
  const record = createRecord({
    ...input,
    images: savedImages,
  });

  const net = await getNetworkType();
  if (!isNetworkOk(net)) {
    queueRecord(record);
    return { queued: true, uploaded: false, record };
  }

  const restUrl = getUploadUrl();
  if (!restUrl) {
    const saved: FireReportRecord = { ...record, processStatus: "submitted", pendingSync: false };
    addHistory(saved);
    await saveToCloud(saved, "submitted");
    return { queued: false, uploaded: true, record: saved };
  }

  const r = await uploadOne(record);
  if (r && r.ok) {
    const ps = r.processStatus || "submitted";
    const saved: FireReportRecord = { ...record, processStatus: ps, pendingSync: false };
    addHistory(saved);
    await saveToCloud(saved, ps);
    return { queued: false, uploaded: true, record: saved };
  }

  queueRecord(record);
  return { queued: true, uploaded: false, record };
}

function cloudDocToRecord(doc: Record<string, unknown>): FireReportRecord {
  const id = String(doc.clientId || doc._id || Date.now());
  return {
    id,
    createdAt: Number(doc.createdAt) || 0,
    reportTime: String(doc.reportTime || ""),
    location: String(doc.location || ""),
    latitude: Number(doc.latitude) || 0,
    longitude: Number(doc.longitude) || 0,
    images: [],
    reporterName: String(doc.reporterName || ""),
    reporterPhone: String(doc.reporterPhone || ""),
    processStatus: normalizeProcessStatus(String(doc.processStatus || "")),
    pendingSync: false,
  };
}

async function fetchCloudList(): Promise<FireReportRecord[]> {
  if (!wx.cloud) return [];
  const db = wx.cloud.database();
  const col = db.collection(CLOUD_COLLECTION);
  try {
    const res = await col.orderBy("createdAt", "desc").limit(200).get();
    return (res.data || []).map((d) => cloudDocToRecord(d as Record<string, unknown>));
  } catch {
    try {
      const res = await col.limit(200).get();
      return (res.data || []).map((d) => cloudDocToRecord(d as Record<string, unknown>));
    } catch (e) {
      console.warn("[fireReportSync] cloud list failed", e);
      return [];
    }
  }
}

async function fetchRemoteList(): Promise<FireReportRecord[]> {
  const url = getListUrl();
  if (!url) return [];
  return new Promise((resolve) => {
    wx.request({
      url,
      method: "GET",
      timeout: 15000,
      success: (res) => {
        const body = res.data as { records?: FireReportRecord[]; data?: FireReportRecord[] };
        const arr = body?.records || body?.data;
        resolve(Array.isArray(arr) ? normalizeHistoryList(arr as Partial<FireReportRecord>[]) : []);
      },
      fail: () => resolve([]),
    });
  });
}

/** 合并本地历史、离线队列、云库与可选 REST 列表，按时间倒序 */
export async function fetchAllFireReports(): Promise<FireReportListItem[]> {
  const local = readHistory();
  const queue = readQueue();
  const qids = new Set(queue.map((q) => q.id));
  const [cloud, remote] = await Promise.all([fetchCloudList(), fetchRemoteList()]);
  const merged = mergeById(local, cloud, remote, queue);
  merged.forEach((r) => {
    if (qids.has(r.id)) r.pendingSync = true;
  });
  const sorted = merged.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return sorted.map(mapToListItem);
}
