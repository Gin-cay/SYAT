import type { FireReportListItem, FireReportProcessStatus } from "../../types/fireReport";

const fireReport = require("../../utils/fireReportSync");
const lang = require("../../utils/lang.js");
const i18nBehavior = require("../../utils/i18nBehavior.js");

function statusLabelFor(L: Record<string, string>, s: FireReportProcessStatus) {
  if (s === "processing") return L.reportStatusProcessing;
  if (s === "done") return L.reportStatusDone;
  return L.reportStatusSubmitted;
}

Page({
  behaviors: [i18nBehavior],

  onI18nReady(L: Record<string, string>) {
    wx.setNavigationBarTitle({ title: L.navTitleReportList });
    const list = this.remapListLabels(this.data.list as FireReportListItem[], L);
    if (list.length) this.setData({ list });
  },

  data: {
    list: [] as FireReportListItem[],
    loading: true,
    empty: false,
  },

  remapListLabels(list: FireReportListItem[], L: Record<string, string>) {
    return list.map((item) => ({
      ...item,
      statusLabel: statusLabelFor(L, item.processStatus),
    }));
  },

  onShow() {
    fireReport.flushOfflineReports().finally(() => this.loadList());
  },

  loadList() {
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    this.setData({ loading: true });
    fireReport
      .fetchAllFireReports()
      .then((list: FireReportListItem[]) => {
        const mapped = this.remapListLabels(list, L);
        this.setData({
          list: mapped,
          empty: !mapped.length,
          loading: false,
        });
      })
      .catch(() => {
        this.setData({ loading: false, empty: true });
      });
  },

  onPullDownRefresh() {
    fireReport.flushOfflineReports().finally(() => {
      this.loadList();
      wx.stopPullDownRefresh();
    });
  },

  openMap(e: WechatMiniprogram.TouchEvent) {
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    const lat = Number(e.currentTarget.dataset.lat);
    const lng = Number(e.currentTarget.dataset.lng);
    const place = String(e.currentTarget.dataset.place || "");
    if (!lat && !lng) return;
    wx.openLocation({
      latitude: lat,
      longitude: lng,
      name: L.reportOpenLocationName,
      address: place,
    });
  },
});
