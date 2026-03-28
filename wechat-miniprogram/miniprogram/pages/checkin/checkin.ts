import type { PatrolCheckinRecord, PatrolStatus } from "../../types/patrol";
import { savePatrolRecord } from "../../utils/patrolService";
import { bindNetworkFlush } from "../../utils/patrolSync";

const patrolTrackSession = require("../../utils/patrolTrackSession.js");
const { load } = require("../../utils/userProfileStorage.js");

const ALT_FIRE_M = 3500;

function pad(n: number) {
  return `${n}`.padStart(2, "0");
}

function formatNow() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTs(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

Page({
  data: {
    inspectorName: "",
    checkTime: "",
    patrolPlace: "",
    locating: false,
    locationError: "",
    latitude: 0,
    longitude: 0,
    mapScale: 15,
    markers: [] as WechatMiniprogram.MapMarker[],
    polyline: [] as WechatMiniprogram.MapPolyline[],
    showRouteMap: true,
    patrolStatus: "normal" as PatrolStatus,
    hazardDesc: "",
    hazardImages: [] as string[],
    submitting: false,
    hasMap: false,
    lastAltM: undefined as number | undefined,
    highFireRiskAltitude: false,
    altitudeTip: "",
  },

  onLoad() {
    const p = load();
    this.setData({
      checkTime: formatNow(),
      inspectorName: p.name || "巡查员",
    });
    bindNetworkFlush();
    this.ensureTrackStartAt();
    this.refreshLocation();
  },

  onShow() {
    this.setData({ checkTime: formatNow() });
  },

  buildRoute(lat: number, lng: number, step = 0.0025) {
    return [
      { latitude: lat, longitude: lng },
      { latitude: lat + step, longitude: lng },
      { latitude: lat + step, longitude: lng + step * 1.2 },
      { latitude: lat, longitude: lng + step * 1.1 },
      { latitude: lat - step * 0.4, longitude: lng + step * 0.5 },
      { latitude: lat, longitude: lng },
    ];
  },

  applyLocation(latitude: number, longitude: number, placeText: string, altM?: number) {
    const hasAlt = typeof altM === "number" && !Number.isNaN(altM);
    const hi = hasAlt && altM > ALT_FIRE_M;
    const points = this.buildRoute(latitude, longitude);
    this.setData({
      locating: false,
      hasMap: true,
      latitude,
      longitude,
      patrolPlace: placeText,
      lastAltM: hasAlt ? altM : undefined,
      highFireRiskAltitude: hi,
      altitudeTip: hi ? `当前海拔约 ${Math.round(altM)}m，已进入高火险区域，请加强盯防。` : "",
      markers: [
        {
          id: 1,
          latitude,
          longitude,
          width: 28,
          height: 28,
          callout: { content: "当前位置", display: "BYCLICK" },
        },
      ],
      polyline: [{ points, color: "#1677FF99", width: 4 }],
    });
  },

  refreshLocation() {
    this.setData({ locating: true, locationError: "" });
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: false,
      success: (res) => {
        const { latitude, longitude, altitude } = res;
        const place = `当前定位（${latitude.toFixed(5)}，${longitude.toFixed(5)}）`;
        this.applyLocation(latitude, longitude, place, altitude);
      },
      fail: () => {
        this.setData({
          locating: false,
          locationError: "未能获取定位，请检查权限或在设置中开启位置权限。",
          patrolPlace: "",
        });
        wx.showModal({
          title: "定位失败",
          content: "需要位置权限以填充巡查地点并展示路线示意。可到系统或小程序设置中授权。",
          showCancel: false,
        });
      },
    });
  },

  onPickMapLocation() {
    wx.chooseLocation({
      success: (res) => {
        const { latitude, longitude, name, address } = res;
        const label = name || address || `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
        this.applyLocation(latitude, longitude, label, undefined);
        this.setData({ locationError: "" });
      },
    });
  },

  onToggleRouteMap(e: WechatMiniprogram.SwitchChange) {
    this.setData({ showRouteMap: !!e.detail.value });
  },

  ensureTrackStartAt() {
    const sess = patrolTrackSession.read();
    if (sess && sess.startAt) return;
    patrolTrackSession.write(Date.now());
  },

  onPatrolPlaceInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ patrolPlace: e.detail.value });
  },

  onPatrolStatusChange(e: WechatMiniprogram.RadioGroupChange) {
    const v = e.detail.value as PatrolStatus;
    this.setData({
      patrolStatus: v,
      hazardDesc: v === "normal" ? "" : this.data.hazardDesc,
      hazardImages: v === "normal" ? [] : this.data.hazardImages,
    });
  },

  onHazardDescInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ hazardDesc: e.detail.value });
  },

  chooseHazardImages() {
    const remain = 9 - this.data.hazardImages.length;
    if (remain <= 0) return wx.showToast({ title: "最多9张图片", icon: "none" });
    const append = (paths: string[]) => {
      this.setData({ hazardImages: this.data.hazardImages.concat(paths) });
    };
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: remain,
        mediaType: ["image"],
        sizeType: ["compressed"],
        sourceType: ["album", "camera"],
        success: (res) => append(res.tempFiles.map((f) => f.tempFilePath)),
        fail: () => this.fallbackChooseImage(remain, append),
      });
    } else this.fallbackChooseImage(remain, append);
  },

  fallbackChooseImage(remain: number, append: (paths: string[]) => void) {
    wx.chooseImage({
      count: remain,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (res) => append(res.tempFilePaths),
    });
  },

  removeHazardImage(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    this.setData({ hazardImages: this.data.hazardImages.filter((_, i) => i !== idx) });
  },

  previewHazardImage(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    wx.previewImage({ current: this.data.hazardImages[idx], urls: this.data.hazardImages });
  },

  persistImages(tempPaths: string[]) {
    if (!tempPaths.length) return Promise.resolve([] as string[]);
    return Promise.all(
      tempPaths.map(
        (p) =>
          new Promise<string>((resolve) => {
            wx.saveFile({
              tempFilePath: p,
              success: (r) => resolve(r.savedFilePath),
              fail: () => resolve(p),
            });
          })
      )
    );
  },

  submitCheckin() {
    if (this.data.submitting) return;
    const place = (this.data.patrolPlace || "").trim();
    if (!place) return wx.showToast({ title: "请先获取或填写巡查地点", icon: "none" });

    if (this.data.patrolStatus === "hazard") {
      const desc = (this.data.hazardDesc || "").trim();
      const hasImages = this.data.hazardImages.length > 0;
      if (!desc && !hasImages) {
        return wx.showToast({ title: "请填写隐患描述或上传图片", icon: "none" });
      }
    }

    this.setData({ submitting: true });
    const endAt = Date.now();
    const sess = patrolTrackSession.read();
    const startAt = sess && sess.startAt ? sess.startAt : null;
    patrolTrackSession.write(null);

    const patrolStartText = startAt ? formatTs(startAt) : "";
    const patrolEndText = formatTs(endAt);
    let patrolDurationMin: number | null = null;
    if (startAt && endAt > startAt) patrolDurationMin = Math.max(1, Math.round((endAt - startAt) / 60000));

    this.persistImages(this.data.hazardImages)
      .then((savedPaths) => {
        const record: PatrolCheckinRecord = {
          id: `${Date.now()}`,
          place,
          latitude: this.data.latitude,
          longitude: this.data.longitude,
          status: this.data.patrolStatus,
          hazardDesc: this.data.patrolStatus === "hazard" ? (this.data.hazardDesc || "").trim() : "",
          images: savedPaths,
          inspector: this.data.inspectorName,
          time: patrolEndText,
          createdAt: endAt,
          patrolStartText,
          patrolEndText,
          patrolDurationMin,
          highFireRiskAltitude: this.data.highFireRiskAltitude,
          altitudeM: this.data.lastAltM,
        };
        return savePatrolRecord(record).then(() => undefined);
      })
      .then(() => {
        this.setData({ submitting: false });
        wx.showToast({ title: "打卡成功", icon: "success" });
        setTimeout(() => {
          wx.navigateBack({
            fail: () => wx.redirectTo({ url: "/pages/patrol-records/patrol-records" }),
          });
        }, 500);
      })
      .catch(() => {
        this.setData({ submitting: false });
        wx.showToast({ title: "保存失败", icon: "none" });
      });
  },
});
