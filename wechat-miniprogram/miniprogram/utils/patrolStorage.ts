import type { PatrolCheckinRecord } from "../types/patrol";

const STORAGE_KEY = "patrol_records_v1";

export function getPatrolRecords(): PatrolCheckinRecord[] {
  try {
    const list = wx.getStorageSync(STORAGE_KEY) as unknown;
    return Array.isArray(list) ? (list as PatrolCheckinRecord[]) : [];
  } catch {
    return [];
  }
}

function savePatrolRecords(list: PatrolCheckinRecord[]) {
  wx.setStorageSync(STORAGE_KEY, list);
}

export function addPatrolRecord(record: PatrolCheckinRecord): PatrolCheckinRecord[] {
  const row: PatrolCheckinRecord = { ...record, synced: false };
  const list = getPatrolRecords();
  list.unshift(row);
  savePatrolRecords(list);
  return list;
}

export function markSyncedByIds(ids: string[]) {
  const set = new Set(ids);
  const list = getPatrolRecords().map((r) =>
    set.has(r.id) ? { ...r, synced: true } : r
  );
  savePatrolRecords(list);
}

export function upsertPatrolRecords(records: PatrolCheckinRecord[]) {
  const map = new Map<string, PatrolCheckinRecord>();
  getPatrolRecords().forEach((r) => map.set(r.id, r));
  records.forEach((r) => map.set(r.id, r));
  const merged = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
  savePatrolRecords(merged);
}

export { STORAGE_KEY };
