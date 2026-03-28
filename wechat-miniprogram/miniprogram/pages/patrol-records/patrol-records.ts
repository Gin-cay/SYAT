import type { PatrolCheckinRecord, PatrolStatus } from "../../types/patrol";
import { getPatrolRecords } from "../../utils/patrolStorage";
import { fetchAllPatrolRecords } from "../../utils/patrolService";

function statusLabel(s: PatrolStatus) {
  return s === "hazard" ? "发现隐患" : "正常";
}

Page({
  data: {
    list: [] as Array<
      PatrolCheckinRecord & {
        statusLabel: string;
        coordText: string;
      }
    >,
    loading: true,
    empty: false,
  },

  onLoad() {
    this.refresh();
  },

  onShow() {
    fetchAllPatrolRecords()
      .then((merged) => this.setList(merged))
      .catch(() => this.applyLocal());
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  applyLocal() {
    const raw = getPatrolRecords();
    this.setList(raw);
  },

  setList(raw: PatrolCheckinRecord[]) {
    const sorted = raw.slice().sort((a, b) => b.createdAt - a.createdAt);
    const list = sorted.map((r) => ({
      ...r,
      statusLabel: statusLabel(r.status),
      coordText: `${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}`,
    }));
    this.setData({
      list,
      empty: list.length === 0,
      loading: false,
    });
  },

  refresh() {
    this.setData({ loading: true });
    return fetchAllPatrolRecords()
      .then((merged) => this.setList(merged))
      .catch(() => {
        this.applyLocal();
      });
  },

  openMap(e: WechatMiniprogram.TouchEvent) {
    const lat = Number(e.currentTarget.dataset.lat);
    const lng = Number(e.currentTarget.dataset.lng);
    if (!lat && !lng) return;
    wx.openLocation({
      latitude: lat,
      longitude: lng,
      name: "巡查位置",
      address: String(e.currentTarget.dataset.place || ""),
    });
  },
});
