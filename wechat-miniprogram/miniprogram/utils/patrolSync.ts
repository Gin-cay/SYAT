import { getPatrolRecords, markSyncedByIds } from "./patrolStorage";

let flushing = false;
let networkBound = false;

function networkOk(t: string) {
  return t && t !== "none";
}

export function getNet(): Promise<string> {
  return new Promise((resolve) => {
    wx.getNetworkType({
      success: (r) => resolve(r.networkType || "unknown"),
      fail: () => resolve("unknown"),
    });
  });
}

/** 有网且配置了 patrolUploadUrl 时批量 POST；失败则保留未同步标记 */
export function flushPatrolUpload(): Promise<void> {
  if (flushing) return Promise.resolve();
  const app = typeof getApp === "function" ? getApp<IAppOption>() : null;
  const url = (app?.globalData?.patrolUploadUrl || "").trim();
  if (!url) return Promise.resolve();

  flushing = true;
  return getNet()
    .then((t) => {
      if (!networkOk(t)) return;
      const pending = getPatrolRecords().filter((r) => !r.synced);
      if (!pending.length) return;
      return new Promise<string[]>((resolve, reject) => {
        wx.request({
          url,
          method: "POST",
          data: { records: pending },
          header: { "content-type": "application/json" },
          timeout: 12000,
          success: (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(pending.map((p) => p.id));
            } else reject(new Error("http"));
          },
          fail: reject,
        });
      }).then((ids) => markSyncedByIds(ids));
    })
    .catch(() => {})
    .finally(() => {
      flushing = false;
    });
}

export function bindNetworkFlush() {
  if (networkBound) return;
  networkBound = true;
  wx.onNetworkStatusChange((r) => {
    if (r.isConnected) flushPatrolUpload();
  });
}
