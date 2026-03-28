import type { PatrolCheckinRecord, PatrolStatus } from "../../types/patrol";
import { getPatrolRecords } from "../../utils/patrolStorage";
import { fetchAllPatrolRecords } from "../../utils/patrolService";

const lang = require("../../utils/lang.js");
const i18nBehavior = require("../../utils/i18nBehavior.js");

function statusLabel(L: Record<string, string>, s: PatrolStatus) {
  return s === "hazard" ? L.checkinHazard : L.checkinNormal;
}

Page({
  behaviors: [i18nBehavior],

  onI18nReady(L: Record<string, string>) {
    wx.setNavigationBarTitle({ title: L.navTitlePatrolRecords });
    const cur = this.data.list as Array<
      PatrolCheckinRecord & { statusLabel: string; coordText: string }
    >;
    if (!cur.length) return;
    this.setData({
      list: cur.map((r) => ({
        ...r,
        statusLabel: statusLabel(L, r.status),
      })),
    });
  },

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
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    const sorted = raw.slice().sort((a, b) => b.createdAt - a.createdAt);
    const list = sorted.map((r) => ({
      ...r,
      statusLabel: statusLabel(L, r.status),
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
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    const lat = Number(e.currentTarget.dataset.lat);
    const lng = Number(e.currentTarget.dataset.lng);
    if (!lat && !lng) return;
    wx.openLocation({
      latitude: lat,
      longitude: lng,
      name: L.patrolOpenLocationName,
      address: String(e.currentTarget.dataset.place || ""),
    });
  },
});
