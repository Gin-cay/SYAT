const emergency = require("../../utils/report.js");
const lang = require("../../utils/lang.js");
const i18nBehavior = require("../../utils/i18nBehavior.js");

const EMERGENCY_TRIGGER_URL =
  "https://flask-vnaf-239145-8-1416119344.sh.run.tcloudbase.com/emergency_trigger";

Page({
  behaviors: [i18nBehavior],

  data: {
    riskCardClass: "normal",
    riskChipText: "",
    statusDesc: "",
    todayData: {
      riskLevel: "",
      temperature: 24,
      humidity: 63,
      wind: 2,
    },
    historyList: [
      { id: 1, time: "09:20", area: "南山林区-3号网格", level: "绿色正常" },
      { id: 2, time: "08:10", area: "北坡林区-1号网格", level: "绿色正常" },
      { id: 3, time: "昨日 18:45", area: "东部防护带-2号网格", level: "绿色正常" },
    ],
    emergencyRecords: [],
  },

  onShow() {
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    const b = (getApp().globalData || {}).fireBrief;
    if (!b || !b.todayData) {
      this.setData({
        riskChipText: L.indexChipPreRisk,
        statusDesc: L.indexDescDefault,
        todayData: {
          riskLevel: "I级（低）",
          temperature: 24,
          humidity: 63,
          wind: 2,
        },
      });
      this.loadEmergencyRecords();
      return;
    }
    let riskCardClass = "normal";
    let riskChipText = L.indexChipStable;
    if (b.maxFire >= 72) {
      riskCardClass = "danger";
      riskChipText = L.indexChipHigh;
    } else if (b.maxFire >= 45) {
      riskCardClass = "warn";
      riskChipText = L.indexChipMedium;
    }
    this.setData({
      riskCardClass,
      riskChipText,
      todayData: b.todayData,
      statusDesc: b.headline || L.indexDescDefault,
    });

    this.loadEmergencyRecords();
  },

  loadEmergencyRecords() {
    try {
      const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
      const q = emergency.readQueue ? emergency.readQueue() : [];
      const records = (q || [])
        .slice(-5)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map((r) => ({
          id: r.id,
          timeText: r.timeText,
          statusText: L.indexEmergencyOffline,
        }));
      this.setData({ emergencyRecords: records });
    } catch (e) {}
  },

  onEmergencyReport() {
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    wx.showLoading({ title: L.indexLocating, mask: true });
    emergency
      .locateOnce()
      .then((loc) => {
        wx.hideLoading();
        const lat = loc.latitude;
        const lng = loc.longitude;

        wx.showModal({
          title: L.indexConfirmFire,
          content: "",
          cancelText: L.cancel,
          confirmText: L.confirm,
          success: (res) => {
            if (!res.confirm) return;

            wx.showLoading({ title: L.reportSubmitting, mask: true });
            emergency
              .submitEmergency({ latitude: lat, longitude: lng, remark: L.indexEmergencyBtn })
              .then(({ queued, queuedReason, report }) => {
                wx.hideLoading();
                if (queued && queuedReason === "offline") {
                  wx.showToast({
                    title: L.indexOfflineSaved,
                    icon: "none",
                  });
                } else {
                  if (!queued) {
                    wx.showToast({ title: L.indexUploadOk, icon: "success" });
                    this.triggerEmergencyAlarm(report);
                  } else wx.showToast({ title: L.indexUploadQueued, icon: "none" });
                }
                this.setData({
                  emergencyRecords: [
                    {
                      id: (report && report.id) || String(Date.now()),
                      timeText: (report && report.timeText) || "",
                      statusText: queued ? L.indexEmergencyOffline : L.indexEmergencyReported,
                    },
                    ...(this.data.emergencyRecords || []).slice(0, 4),
                  ],
                });
              })
              .catch(() => {
                wx.hideLoading();
                wx.showToast({ title: L.indexUploadFail, icon: "none" });
              });
          },
        });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: L.indexLocFail, icon: "none" });
      });
  },

  triggerEmergencyAlarm(report) {
    wx.request({
      url: EMERGENCY_TRIGGER_URL,
      method: "POST",
      timeout: 12000,
      header: { "content-type": "application/json" },
      data: {
        source: "miniprogram_emergency_button",
        reportId: (report && report.id) || "",
        timeText: (report && report.timeText) || "",
        createdAt: (report && report.createdAt) || Date.now(),
      },
      success: () => {},
      fail: () => {},
    });
  },

  goWarning() {
    wx.switchTab({ url: "/pages/warning/index" });
  },

  onPatrolCheckin() {
    wx.navigateTo({
      url: "/pages/checkin/checkin",
    });
  },

  onFireReport() {
    wx.navigateTo({
      url: "/pages/report/index",
    });
  },
});
