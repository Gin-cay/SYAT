const fireReport = require("../../utils/fireReportSync");
const { load } = require("../../utils/userProfileStorage.js");

Page({
  data: {
    form: {
      location: "",
      images: [] as string[],
      latitude: "",
      longitude: "",
      reportTime: "",
      reporterName: "",
      reporterPhone: "",
    },
    latNum: 0,
    lngNum: 0,
    hasLocation: false,
    mapScale: 16,
    markers: [] as WechatMiniprogram.MapMarker[],
  },

  onLoad() {
    const p = load();
    this.setData({
      "form.reporterName": p.name || "巡查员",
      "form.reporterPhone": p.phone || "",
    });
    this.autoLocate();
  },

  nowText() {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
      d.getMinutes()
    )}:${p(d.getSeconds())}`;
  },

  applyMap(lat: number, lng: number) {
    this.setData({
      latNum: lat,
      lngNum: lng,
      hasLocation: true,
      markers: [
        {
          id: 1,
          latitude: lat,
          longitude: lng,
          width: 28,
          height: 28,
          callout: { content: "火情位置", display: "BYCLICK" },
        },
      ],
    });
  },

  autoLocate() {
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: true,
      success: (res) => {
        const lat = Number(res.latitude);
        const lng = Number(res.longitude);
        const latStr = lat.toFixed(6);
        const lngStr = lng.toFixed(6);
        this.setData({
          "form.latitude": latStr,
          "form.longitude": lngStr,
          "form.location": `经纬度(${latStr}, ${lngStr})`,
          "form.reportTime": this.nowText(),
        });
        this.applyMap(lat, lng);
      },
      fail: () => {
        this.setData({
          "form.reportTime": this.nowText(),
          hasLocation: false,
        });
      },
    });
  },

  onRefreshLocation() {
    this.autoLocate();
    wx.showToast({ title: "位置已更新", icon: "none" });
  },

  onChooseLocationManual() {
    wx.chooseLocation({
      success: (res) => {
        const lat = Number(res.latitude);
        const lng = Number(res.longitude);
        const latStr = lat.toFixed(6);
        const lngStr = lng.toFixed(6);
        this.setData({
          "form.location": res.name || res.address || `经纬度(${latStr}, ${lngStr})`,
          "form.latitude": latStr,
          "form.longitude": lngStr,
          "form.reportTime": this.nowText(),
        });
        this.applyMap(lat, lng);
      },
    });
  },

  onChooseImage() {
    const remain = 3 - this.data.form.images.length;
    if (remain <= 0) return wx.showToast({ title: "最多3张图片", icon: "none" });
    wx.chooseImage({
      count: remain,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (res) => {
        this.setData({
          "form.images": this.data.form.images.concat(res.tempFilePaths).slice(0, 3),
        });
      },
    });
  },

  onClearAndReselectImages() {
    wx.showModal({
      title: "重新选择图片",
      content: "将清空当前已选图片，是否继续？",
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ "form.images": [] });
        wx.showToast({ title: "已清空，请重新添加", icon: "none" });
      },
    });
  },

  onRemoveImage(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const images = [...this.data.form.images];
    images.splice(index, 1);
    this.setData({ "form.images": images });
  },

  onPreviewImage(e: WechatMiniprogram.TouchEvent) {
    const src = e.currentTarget.dataset.src as string;
    wx.previewImage({
      current: src,
      urls: this.data.form.images,
    });
  },

  onLocationInput(e: WechatMiniprogram.Input) {
    this.setData({ "form.location": e.detail.value });
  },

  submitReport() {
    const { location, images, latitude, longitude, reporterName, reporterPhone } = this.data.form;
    if (!images || !images.length) {
      wx.showToast({ title: "请至少上传1张图片", icon: "none" });
      return;
    }
    if (!location || !latitude || !longitude) {
      wx.showToast({ title: "请先获取定位", icon: "none" });
      return;
    }

    const reportTime = this.nowText();
    this.setData({ "form.reportTime": reportTime });

    wx.showLoading({ title: "提交中", mask: true });
    fireReport
      .submitFireReport({
        location,
        latitude,
        longitude,
        images,
        reporterName: reporterName || "巡查员",
        reporterPhone: reporterPhone || "",
        reportTime,
      })
      .then(({ queued, uploaded }: { queued: boolean; uploaded: boolean; record: unknown }) => {
        wx.hideLoading();
        if (uploaded && !queued) {
          wx.showToast({ title: "火情上报成功", icon: "success" });
          this.setData({
            "form.images": [],
            "form.reportTime": this.nowText(),
          });
          setTimeout(() => {
            wx.switchTab({ url: "/pages/index/index" });
          }, 800);
          return;
        }
        wx.showToast({ title: "无网络或上传失败，已缓存待同步", icon: "none" });
        setTimeout(() => {
          wx.switchTab({ url: "/pages/index/index" });
        }, 800);
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: "提交失败，请稍后重试", icon: "none" });
      });
  },

  onPullDownRefresh() {
    this.autoLocate();
    fireReport.flushOfflineReports().finally(() => {
      wx.stopPullDownRefresh();
    });
  },
});
