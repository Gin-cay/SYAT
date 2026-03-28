const emergency = require("../../utils/report.js");
const EMERGENCY_TRIGGER_URL =
  "https://flask-vnaf-239145-8-1416119344.sh.run.tcloudbase.com/emergency_trigger";

Page({
  data: {
    riskCardClass: "normal",
    riskChipText: "事前研判",
    statusDesc: "打开「预警」页可生成未来6小时火险热力图与雷电/干旱指数。",
    todayData: {
      riskLevel: "I级（低）",
      temperature: 24,
      humidity: 63,
      wind: 2
    },
    historyList: [
      {
        id: 1,
        time: "09:20",
        area: "南山林区-3号网格",
        level: "绿色正常"
      },
      {
        id: 2,
        time: "08:10",
        area: "北坡林区-1号网格",
        level: "绿色正常"
      },
      {
        id: 3,
        time: "昨日 18:45",
        area: "东部防护带-2号网格",
        level: "绿色正常"
      }
    ]
    ,
    emergencyRecords: []
  },

  onShow() {
    const b = (getApp().globalData || {}).fireBrief;
    if (!b || !b.todayData) return;
    let riskCardClass = "normal";
    let riskChipText = "相对平稳";
    if (b.maxFire >= 72) {
      riskCardClass = "danger";
      riskChipText = "火险偏高";
    } else if (b.maxFire >= 45) {
      riskCardClass = "warn";
      riskChipText = "中等火险";
    }
    this.setData({
      riskCardClass,
      riskChipText,
      todayData: b.todayData,
      statusDesc: b.headline || this.data.statusDesc,
    });

    this.loadEmergencyRecords();
  },

  loadEmergencyRecords() {
    try {
      const q = emergency.readQueue ? emergency.readQueue() : [];
      const records = (q || [])
        .slice(-5)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map((r) => ({
          id: r.id,
          timeText: r.timeText,
          statusText: "已离线记录",
        }));
      this.setData({ emergencyRecords: records });
    } catch (e) {}
  },

  onEmergencyReport() {
    // 1) 定位
    wx.showLoading({ title: "定位中...", mask: true });
    emergency
      .locateOnce()
      .then((loc) => {
        wx.hideLoading();
        const lat = loc.latitude;
        const lng = loc.longitude;

        // 2) 确认框
        wx.showModal({
          title: "确认上报火情？",
          content: "",
          cancelText: "取消",
          confirmText: "确认",
          success: (res) => {
            if (!res.confirm) return;

            // 3) 上传/缓存
            wx.showLoading({ title: "上报中...", mask: true });
            emergency
              .submitEmergency({ latitude: lat, longitude: lng, remark: "紧急上报" })
              .then(({ queued, queuedReason, report }) => {
                wx.hideLoading();
                if (queued && queuedReason === "offline") {
                  wx.showToast({
                    title: "当前无网络，已记录位置，联网后将自动上报",
                    icon: "none",
                  });
                } else {
                  if (!queued) {
                    wx.showToast({ title: "上报成功", icon: "success" });
                    // 联动报警接口：不影响现有 UI 流程，失败也静默。
                    this.triggerEmergencyAlarm(report);
                  }
                  else wx.showToast({ title: "暂无法上传，已缓存（联网后自动上报）", icon: "none" });
                }
                // 无网/有网都在页面显示最新一条（缓存成功上传后会自动清除缓存）
                this.setData({
                  emergencyRecords: [
                    {
                      id: (report && report.id) || String(Date.now()),
                      timeText: (report && report.timeText) || "",
                      statusText: queued ? "已离线记录" : "已上报",
                    },
                    ...(this.data.emergencyRecords || []).slice(0, 4),
                  ],
                });
              })
              .catch(() => {
                wx.hideLoading();
                wx.showToast({ title: "上报失败，请稍后重试", icon: "none" });
              });
          },
        });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: "定位失败，请检查权限", icon: "none" });
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
      url: "/pages/checkin/checkin"
    });
  },

  onFireReport() {
    wx.navigateTo({
      url: "/pages/report/index"
    });
  }
});
