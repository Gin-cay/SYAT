import type {
  WarningReceiveLogItem,
  WarningSettingsState,
} from "../types/warningSettings";

const LOCAL_KEY = "warning_settings_v1";
const LOG_KEY = "warning_receive_logs_v1";
const CLOUD_COLLECTION = "user_warning_settings";

function defaults(): WarningSettingsState {
  return {
    masterEnabled: true,
    categorySnapshot: {
      fireRiskLevels: true,
      lightningDrought: true,
      fireReportNotify: true,
      patrolReminder: true,
    },
    categories: {
      fireRiskLevels: true,
      lightningDrought: true,
      fireReportNotify: true,
      patrolReminder: true,
    },
    channels: {
      serviceTemplate: true,
      inApp: true,
      sms: false,
    },
    dnd: {
      enabled: false,
      start: "22:00",
      end: "07:00",
    },
    region: {
      forestIndex: 0,
      gridIndex: 0,
      radiusKm: 5,
    },
    content: {
      templateId: "default",
      voiceBroadcast: false,
    },
    updatedAt: Date.now(),
  };
}

function normalize(raw: Partial<WarningSettingsState> | null | undefined): WarningSettingsState {
  const d = defaults();
  if (!raw || typeof raw !== "object") return d;
  return {
    ...d,
    ...raw,
    categorySnapshot: { ...d.categorySnapshot, ...(raw.categorySnapshot || {}) },
    categories: { ...d.categories, ...(raw.categories || {}) },
    channels: { ...d.channels, ...(raw.channels || {}) },
    dnd: { ...d.dnd, ...(raw.dnd || {}) },
    region: { ...d.region, ...(raw.region || {}) },
    content: { ...d.content, ...(raw.content || {}) },
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

export function loadLocalSettings(): WarningSettingsState {
  try {
    const s = wx.getStorageSync(LOCAL_KEY) as unknown;
    if (s && typeof s === "object") return normalize(s as Partial<WarningSettingsState>);
  } catch {}
  return defaults();
}

export function saveLocalSettings(state: WarningSettingsState) {
  const next = { ...state, updatedAt: Date.now() };
  try {
    wx.setStorageSync(LOCAL_KEY, next);
  } catch {}
  return next;
}

/** 总开关关闭时备份分类；打开时可恢复 */
export function applyMasterSwitch(
  state: WarningSettingsState,
  masterOn: boolean
): WarningSettingsState {
  if (!masterOn) {
    return saveLocalSettings({
      ...state,
      masterEnabled: false,
      categorySnapshot: { ...state.categories },
      categories: {
        fireRiskLevels: false,
        lightningDrought: false,
        fireReportNotify: false,
        patrolReminder: false,
      },
    });
  }
  return saveLocalSettings({
    ...state,
    masterEnabled: true,
    categories: { ...state.categorySnapshot },
  });
}

async function cloudGetFirstDoc(): Promise<{ _id: string; [k: string]: unknown } | null> {
  if (!wx.cloud) return null;
  try {
    const db = wx.cloud.database();
    const res = await db.collection(CLOUD_COLLECTION).limit(1).get();
    const row = res.data && res.data[0];
    return row ? (row as { _id: string; [k: string]: unknown }) : null;
  } catch (e) {
    console.warn("[warningSettings] cloud get failed", e);
    return null;
  }
}

export async function syncSettingsToCloud(state: WarningSettingsState): Promise<void> {
  if (!wx.cloud) return;
  const db = wx.cloud.database();
  const col = db.collection(CLOUD_COLLECTION);
  const payload = {
    settings: state,
    updatedAt: Date.now(),
  };
  try {
    const existing = await cloudGetFirstDoc();
    if (existing && existing._id) {
      await col.doc(existing._id).update({ data: payload });
    } else {
      await col.add({ data: { ...payload, createdAt: Date.now() } });
    }
  } catch (e) {
    console.warn("[warningSettings] cloud save failed", e);
  }
}

export async function fetchSettingsFromCloud(): Promise<WarningSettingsState | null> {
  if (!wx.cloud) return null;
  try {
    const row = await cloudGetFirstDoc();
    if (!row) return null;
    const settings = (row.settings as WarningSettingsState) || null;
    if (!settings) return null;
    return normalize(settings);
  } catch {
    return null;
  }
}

/** 合并策略：云端较新则覆盖本地 */
export function mergeSettings(
  local: WarningSettingsState,
  remote: WarningSettingsState | null
): WarningSettingsState {
  if (!remote) return local;
  if ((remote.updatedAt || 0) > (local.updatedAt || 0)) return normalize(remote);
  return local;
}

export function loadLocalLogs(): WarningReceiveLogItem[] {
  try {
    const list = wx.getStorageSync(LOG_KEY) as unknown;
    return Array.isArray(list) ? (list as WarningReceiveLogItem[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalLogs(list: WarningReceiveLogItem[]) {
  try {
    wx.setStorageSync(LOG_KEY, list.slice(0, 200));
  } catch {}
}

/** 最近 7 天（按日期字符串比较） */
export function getLogsLast7Days(): WarningReceiveLogItem[] {
  const all = loadLocalLogs();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return all
    .filter((x) => {
      const t = parseTime(x.time);
      return t >= cutoff;
    })
    .sort((a, b) => parseTime(b.time) - parseTime(a.time));
}

function parseTime(s: string): number {
  const d = Date.parse(s.replace(/-/g, "/"));
  return Number.isNaN(d) ? 0 : d;
}

/** 演示：写入一条接收记录（真实场景可由云推送回调写入） */
export function appendReceiveLog(item: Omit<WarningReceiveLogItem, "id">) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const list = [ { ...item, id }, ...loadLocalLogs() ];
  saveLocalLogs(list);
}
