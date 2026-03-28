Page({
  data: {
    L: {
      labelTime: "预警时间",
      labelPlace: "预警地点",
      labelStatus: "处理状态",
      warningDetail: "预警详情",
      photos: "现场图片",
      records: "处理记录",
      accept: "接警",
      arrive: "到场处置",
      finish: "完成处置",
      operatorPrefix: "执行人：",
    },
    detail: {
      id: "",
      warningTime: "",
      location: "",
      riskLevel: "中",
      riskLevelKey: "medium",
      status: "待处理",
      statusKey: "pending",
      description: "",
      photos: [],
      records: []
    }
  },

  onLoad(options) {
    const langUtils = require("../../utils/lang.js");
    const app = getApp();
    const l = (app.globalData || {}).lang || "zh";
    const L = langUtils.getStrings(l);
    this.setData({ L });

    const payload = options.payload ? JSON.parse(decodeURIComponent(options.payload)) : {};
    const fallbackDetail = this.getFallbackDetail(options.id || "W20260325001");
    const detail = {
      ...fallbackDetail,
      ...payload,
      photos: fallbackDetail.photos,
      records: fallbackDetail.records
    };
    this.setData({ detail });

    if (app && typeof app.onLangChange === "function") {
      app.onLangChange((nextL) => {
        const nextStrings = langUtils.getStrings(nextL);
        this.setData({ L: nextStrings });
        // 根据 key 刷新 status/risk label（若 payload 没带显示文案，也不会影响 CSS）
        const d = this.data.detail || {};
        const riskLabelMap = {
          low: nextStrings.riskLow,
          medium: nextStrings.riskMedium,
          high: nextStrings.riskHigh,
          critical: nextStrings.riskCritical,
        };
        const statusLabelMap = {
          pending: nextStrings.statusPending,
          processing: nextStrings.statusProcessing,
          done: nextStrings.statusDone,
        };
        this.setData({
          "detail.riskLevel": riskLabelMap[d.riskLevelKey] || d.riskLevelKey,
          "detail.status": statusLabelMap[d.statusKey] || d.statusKey,
        });
      });
    }
  },

  getFallbackDetail(id) {
    return {
      id,
      warningTime: "2026-03-25 09:20",
      location: "青松林场-北坡3号瞭望点",
      riskLevel: "极高",
      riskLevelKey: "critical",
      status: "待处理",
      statusKey: "pending",
      description: "热红外监测发现持续高温热点，受风力影响扩散风险较高，建议立即核查。",
      photos: [
        "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=900&q=80",
        "https://images.unsplash.com/photo-1420745981456-b95fe23f5753?auto=format&fit=crop&w=900&q=80"
      ],
      records: [
        {
          time: "2026-03-25 09:21",
          content: "系统自动生成预警并推送到辖区护林员。",
          operator: "预警平台"
        },
        {
          time: "2026-03-25 09:28",
          content: "值班员确认信息有效，已通知机动巡护组出发。",
          operator: "指挥中心-李强"
        }
      ]
    };
  },

  previewImage(e) {
    const current = e.currentTarget.dataset.src;
    wx.previewImage({
      current,
      urls: this.data.detail.photos
    });
  },

  appendRecord(content) {
    const now = this.formatNow();
    const records = this.data.detail.records.concat({
      time: now,
      content,
      operator: "当前用户"
    });
    this.setData({
      "detail.records": records
    });
  },

  onAccept() {
    if (this.data.detail.statusKey !== "pending") {
      wx.showToast({ title: "当前状态不可接警", icon: "none" });
      return;
    }
    this.setData({
      "detail.status": "处理中",
      "detail.statusKey": "processing"
    });
    this.appendRecord("已接警，任务已分派到属地巡护队。");
    wx.showToast({ title: "已接警", icon: "success" });
  },

  onArrive() {
    if (this.data.detail.statusKey === "done") {
      wx.showToast({ title: "该预警已完成处置", icon: "none" });
      return;
    }
    this.setData({
      "detail.status": "处理中",
      "detail.statusKey": "processing"
    });
    this.appendRecord("现场人员已到达预警点，正在核查火情。");
    wx.showToast({ title: "到场记录成功", icon: "success" });
  },

  onFinish() {
    if (this.data.detail.statusKey === "done") {
      wx.showToast({ title: "已完成处置", icon: "none" });
      return;
    }
    this.setData({
      "detail.status": "已处置",
      "detail.statusKey": "done"
    });
    this.appendRecord("现场处置完成，已提交结案记录。");
    wx.showToast({ title: "处置完成", icon: "success" });
  },

  formatNow() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
});
