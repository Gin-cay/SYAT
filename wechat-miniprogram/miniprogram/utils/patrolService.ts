import type { PatrolCheckinRecord } from "../types/patrol";
import { addPatrolRecord, getPatrolRecords, upsertPatrolRecords } from "./patrolStorage";
import { flushPatrolUpload } from "./patrolSync";

/** 云开发数据库集合名，需在控制台创建并配置权限 */
const CLOUD_COLLECTION = "patrol_checkins";

function getAppSafe(): IAppOption | null {
  return typeof getApp === "function" ? getApp<IAppOption>() : null;
}

function cloudDocToRecord(doc: Record<string, unknown>): PatrolCheckinRecord {
  const clientId = (doc.clientId as string) || (doc._id as string) || String(Date.now());
  return {
    id: clientId,
    place: String(doc.place ?? ""),
    latitude: Number(doc.latitude) || 0,
    longitude: Number(doc.longitude) || 0,
    inspector: String(doc.inspector ?? ""),
    time: String(doc.time ?? ""),
    createdAt: Number(doc.createdAt) || 0,
    status: doc.status === "hazard" ? "hazard" : "normal",
    hazardDesc: String(doc.hazardDesc ?? ""),
    images: Array.isArray(doc.images) ? (doc.images as string[]) : [],
    patrolStartText: String(doc.patrolStartText ?? ""),
    patrolEndText: String(doc.patrolEndText ?? ""),
    patrolDurationMin:
      doc.patrolDurationMin === null || doc.patrolDurationMin === undefined
        ? null
        : Number(doc.patrolDurationMin),
    highFireRiskAltitude: !!doc.highFireRiskAltitude,
    altitudeM: doc.altitudeM === undefined ? undefined : Number(doc.altitudeM),
    voicePath: doc.voicePath ? String(doc.voicePath) : "",
    voiceDurationSec: Number(doc.voiceDurationSec) || 0,
    synced: true,
  };
}

/**
 * 保存打卡：先写本地（离线可用），再尝试云数据库与可选单条 REST。
 */
export function savePatrolRecord(record: PatrolCheckinRecord): Promise<void> {
  addPatrolRecord(record);
  flushPatrolUpload();

  const app = getAppSafe();
  const singleUrl = (app?.globalData?.patrolSingleSubmitUrl || "").trim();
  if (singleUrl) {
    wx.request({
      url: singleUrl,
      method: "POST",
      header: { "content-type": "application/json" },
      data: record,
      timeout: 15000,
      fail: () => {},
    });
  }

  if (!wx.cloud) return Promise.resolve();

  return wx.cloud
    .database()
    .collection(CLOUD_COLLECTION)
    .add({
      data: {
        clientId: record.id,
        place: record.place,
        latitude: record.latitude,
        longitude: record.longitude,
        inspector: record.inspector,
        time: record.time,
        status: record.status,
        createdAt: record.createdAt,
        hazardDesc: record.hazardDesc || "",
        images: record.images || [],
        patrolStartText: record.patrolStartText || "",
        patrolEndText: record.patrolEndText || "",
        patrolDurationMin: record.patrolDurationMin,
        highFireRiskAltitude: !!record.highFireRiskAltitude,
        altitudeM: record.altitudeM,
        voicePath: record.voicePath || "",
        voiceDurationSec: record.voiceDurationSec || 0,
      },
    })
    .then(() => undefined)
    .catch((e) => {
      console.warn("[patrolService] cloud add failed", e);
    });
}

function mergeById(local: PatrolCheckinRecord[], remote: PatrolCheckinRecord[]): PatrolCheckinRecord[] {
  const map = new Map<string, PatrolCheckinRecord>();
  local.forEach((r) => map.set(r.id, r));
  remote.forEach((r) => {
    const prev = map.get(r.id);
    if (!prev || r.createdAt >= prev.createdAt) map.set(r.id, r);
  });
  return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 查询全部巡查记录：合并本地缓存与云库（需网络与集合权限）。
 * 可选：若配置了 patrolListUrl，则 GET 合并。
 */
export function fetchAllPatrolRecords(): Promise<PatrolCheckinRecord[]> {
  const local = getPatrolRecords();
  const app = getAppSafe();
  const listUrl = (app?.globalData?.patrolListUrl || "").trim();

  const tasks: Promise<PatrolCheckinRecord[]>[] = [];

  if (wx.cloud) {
    const db = wx.cloud.database();
    const col = db.collection(CLOUD_COLLECTION);
    const mapRows = (res: { data?: Record<string, unknown>[] }) =>
      (res.data || []).map((d) => cloudDocToRecord(d as Record<string, unknown>));
    tasks.push(
      col
        .orderBy("createdAt", "desc")
        .limit(200)
        .get()
        .then(mapRows)
        .catch(() =>
          col
            .limit(200)
            .get()
            .then(mapRows)
            .catch((e) => {
              console.warn("[patrolService] cloud list failed", e);
              return [] as PatrolCheckinRecord[];
            })
        )
    );
  }

  if (listUrl) {
    tasks.push(
      new Promise<PatrolCheckinRecord[]>((resolve) => {
        wx.request({
          url: listUrl,
          method: "GET",
          timeout: 15000,
          success: (res) => {
            const body = res.data as { records?: PatrolCheckinRecord[]; data?: PatrolCheckinRecord[] };
            const arr = body?.records || body?.data;
            resolve(Array.isArray(arr) ? arr : []);
          },
          fail: () => resolve([]),
        });
      })
    );
  }

  if (!tasks.length) return Promise.resolve(local.slice().sort((a, b) => b.createdAt - a.createdAt));

  return Promise.all(tasks).then((chunks) => {
    const remote = chunks.reduce<PatrolCheckinRecord[]>((acc, c) => acc.concat(c), []);
    const merged = mergeById(local, remote);
    upsertPatrolRecords(merged);
    return merged;
  });
}
