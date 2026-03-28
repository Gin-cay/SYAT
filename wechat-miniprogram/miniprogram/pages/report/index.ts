const fireReport = require("../../utils/fireReportSync");
const { load } = require("../../utils/userProfileStorage.js");
const lang = require("../../utils/lang.js");
const i18nBehavior = require("../../utils/i18nBehavior.js");

function getL() {
  return lang.getStrings((getApp().globalData || {}).lang || "zh");
}

Page({
  behaviors: [i18nBehavior],

  onI18nReady(L: Record<string, string>) {
    wx.setNavigationBarTitle({ title: L.navTitleReport });
    const d = this.data;
    if (d.hasLocation && d.markers && d.markers.length) {
      const markers = [...d.markers];
      const m0 = markers[0] as WechatMiniprogram.MapMarker;
      markers[0] = {
        ...m0,
        callout: { content: L.reportMapCallout, display: m0.callout?.display || "BYCLICK" },
      };
      this.setData({ markers });
    }
  },

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
    const L = getL();
    this.setData({
      "form.reporterName": p.name || L.defaultInspector,
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
    const L = getL();
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
          callout: { content: L.reportMapCallout, display: "BYCLICK" },
        },
      ],
    });
  },

  autoLocate() {
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: true,
      success: (res) => {
        const L = getL();
        const lat = Number(res.latitude);
        const lng = Number(res.longitude);
        const latStr = lat.toFixed(6);
        const lngStr = lng.toFixed(6);
        this.setData({
          "form.latitude": latStr,
          "form.longitude": lngStr,
          "form.location": L.reportCoordFmt.replace("{a}", latStr).replace("{b}", lngStr),
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
    wx.showToast({ title: getL().reportLocUpdated, icon: "none" });
  },

  onChooseLocationManual() {
    const L = getL();
    wx.chooseLocation({
      success: (res) => {
        const lat = Number(res.latitude);
        const lng = Number(res.longitude);
        const latStr = lat.toFixed(6);
        const lngStr = lng.toFixed(6);
        this.setData({
          "form.location":
            res.name || res.address || L.reportCoordFmt.replace("{a}", latStr).replace("{b}", lngStr),
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
    if (remain <= 0) return wx.showToast({ title: getL().reportMaxImg, icon: "none" });
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
    const L = getL();
    wx.showModal({
      title: L.reportClearImgTitle,
      content: L.reportClearImgContent,
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ "form.images": [] });
        wx.showToast({ title: L.reportCleared, icon: "none" });
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
    const L = getL();
    const { location, images, latitude, longitude, reporterName, reporterPhone } = this.data.form;
    if (!images || !images.length) {
      wx.showToast({ title: L.reportNeedImg, icon: "none" });
      return;
    }
    if (!location || !latitude || !longitude) {
      wx.showToast({ title: L.reportNeedLoc, icon: "none" });
      return;
    }

    const reportTime = this.nowText();
    this.setData({ "form.reportTime": reportTime });

    wx.showLoading({ title: L.reportSubmitting, mask: true });
    fireReport
      .submitFireReport({
        location,
        latitude,
        longitude,
        images,
        reporterName: reporterName || L.defaultInspector,
        reporterPhone: reporterPhone || "",
        reportTime,
      })
      .then(({ queued, uploaded }: { queued: boolean; uploaded: boolean; record: unknown }) => {
        wx.hideLoading();
        if (uploaded && !queued) {
          wx.showToast({ title: L.reportSuccess, icon: "success" });
          this.setData({
            "form.images": [],
            "form.reportTime": this.nowText(),
          });
          setTimeout(() => {
            wx.switchTab({ url: "/pages/index/index" });
          }, 800);
          return;
        }
        wx.showToast({ title: L.reportOffline, icon: "none" });
        setTimeout(() => {
          wx.switchTab({ url: "/pages/index/index" });
        }, 800);
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: L.reportFail, icon: "none" });
      });
  },

  onPullDownRefresh() {
    this.autoLocate();
    fireReport.flushOfflineReports().finally(() => {
      wx.stopPullDownRefresh();
    });
  },
});
