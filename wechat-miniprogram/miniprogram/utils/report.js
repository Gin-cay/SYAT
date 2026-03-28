// 紧急上报：定位 + 离线缓存 + 联网自动批量上传

const STORAGE_KEY = "emergency_reports_v1";
let flushing = false;
let networkBound = false;

function nowText() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getDeviceInfo() {
  try {
    const s = wx.getSystemInfoSync();
    return {
      model: s.model,
      brand: s.brand,
      system: s.system,
      platform: s.platform,
      version: s.version,
      screenWidth: s.screenWidth,
      screenHeight: s.screenHeight,
      pixelRatio: s.pixelRatio,
      language: s.language,
    };
  } catch (e) {
    return {};
  }
}

function readQueue() {
  try {
    const list = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function writeQueue(list) {
  try {
    wx.setStorageSync(STORAGE_KEY, list);
  } catch (e) {}
}

function isNetworkOk(type) {
  return type && type !== "none";
}

function getNetworkType() {
  return new Promise((resolve) => {
    wx.getNetworkType({
      success: (r) => resolve(r.networkType || "unknown"),
      fail: () => resolve("unknown"),
    });
  });
}

function locateOnce() {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: true,
      timeout: 12000,
      success: (r) => resolve({ latitude: r.latitude, longitude: r.longitude, altitude: r.altitude }),
      fail: (err) => reject(err),
    });
  });
}

function getUploadUrl() {
  const app = getApp();
  const gd = (app && app.globalData) || {};
  return gd.emergencyUploadUrl || gd.reportUploadUrl || "";
}

function queueReport(report) {
  const list = readQueue();
  list.push(report);
  // 按时间升序（便于“按时间顺序存储”）
  list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  writeQueue(list);
  return report;
}

function removeAllByIds(ids) {
  const set = new Set(ids);
  const list = readQueue();
  const next = list.filter((r) => !set.has(r.id));
  writeQueue(next);
}

function createReport({ latitude, longitude, remark }) {
  const createdAt = Date.now();
  return {
    id: `${createdAt}_${Math.floor(Math.random() * 10000)}`,
    createdAt,
    timeText: nowText(),
    latitude,
    longitude,
    remark: remark || "紧急上报",
    device: getDeviceInfo(),
    synced: false,
  };
}

function uploadBatch(records) {
  const url = getUploadUrl();
  if (!url) return Promise.resolve({ ok: false, reason: "no_url" });

  return new Promise((resolve) => {
    wx.request({
      url,
      method: "POST",
      timeout: 15000,
      header: { "content-type": "application/json" },
      data: { records },
      success: (res) => {
        const codeOk = res && res.statusCode >= 200 && res.statusCode < 300;
        resolve({ ok: !!codeOk });
      },
      fail: () => resolve({ ok: false }),
    });
  });
}

async function flushOfflineReports() {
  if (flushing) return { flushed: false, uploadedCount: 0 };
  const url = getUploadUrl();
  if (!url) return { flushed: false, uploadedCount: 0 };

  const netType = await getNetworkType();
  if (!isNetworkOk(netType)) return { flushed: false, uploadedCount: 0 };

  const queue = readQueue();
  if (!queue.length) return { flushed: false, uploadedCount: 0 };

  flushing = true;
  try {
    const pending = queue; // 全是离线待上传
    const ids = pending.map((r) => r.id);
    const res = await uploadBatch(pending);
    if (res && res.ok) {
      removeAllByIds(ids);
      wx.showToast({ title: `离线上报已上传（${pending.length}条）`, icon: "success" });
      return { flushed: true, uploadedCount: pending.length };
    }
    return { flushed: false, uploadedCount: 0 };
  } finally {
    flushing = false;
  }
}

function bindNetworkFlush() {
  if (networkBound) return;
  networkBound = true;
  if (!wx.onNetworkStatusChange) return;
  wx.onNetworkStatusChange(() => {
    flushOfflineReports();
  });
}

async function submitEmergency({ latitude, longitude, remark }) {
  const report = createReport({ latitude, longitude, remark });

  const netType = await getNetworkType();
  if (!isNetworkOk(netType)) {
    queueReport(report);
    return { report, queued: true, queuedReason: "offline", uploaded: false };
  }

  // 有网：尝试上传；失败则退回缓存（避免丢失）
  const res = await uploadBatch([report]);
  if (res && res.ok) return { report, queued: false, queuedReason: "", uploaded: true };

  queueReport(report);
  return { report, queued: true, queuedReason: "upload_fail", uploaded: false };
}

module.exports = {
  STORAGE_KEY,
  locateOnce,
  submitEmergency,
  queueReport,
  readQueue,
  flushOfflineReports,
  bindNetworkFlush,
};

