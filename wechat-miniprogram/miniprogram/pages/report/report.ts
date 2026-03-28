import type { FireReportListItem } from "../../types/fireReport";

const fireReport = require("../../utils/fireReportSync");

Page({
  data: {
    list: [] as FireReportListItem[],
    loading: true,
    empty: false,
  },

  onShow() {
    fireReport.flushOfflineReports().finally(() => this.loadList());
  },

  loadList() {
    this.setData({ loading: true });
    fireReport
      .fetchAllFireReports()
      .then((list: FireReportListItem[]) => {
        this.setData({
          list,
          empty: !list.length,
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
    const lat = Number(e.currentTarget.dataset.lat);
    const lng = Number(e.currentTarget.dataset.lng);
    const place = String(e.currentTarget.dataset.place || "");
    if (!lat && !lng) return;
    wx.openLocation({
      latitude: lat,
      longitude: lng,
      name: "上报位置",
      address: place,
    });
  },
});
