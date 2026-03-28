import type { PatrolCheckinRecord, PatrolStatus } from "../../types/patrol";
import { savePatrolRecord } from "../../utils/patrolService";
import { bindNetworkFlush } from "../../utils/patrolSync";

const patrolTrackSession = require("../../utils/patrolTrackSession.js");
const { load } = require("../../utils/userProfileStorage.js");
const lang = require("../../utils/lang.js");
const i18nBehavior = require("../../utils/i18nBehavior.js");

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
  behaviors: [i18nBehavior],

  onI18nReady(L: Record<string, string>) {
    wx.setNavigationBarTitle({ title: L.navTitleCheckin });
    const d = this.data;
    if (d.highFireRiskAltitude && typeof d.lastAltM === "number") {
      this.setData({
        altitudeTip: L.checkinAltitudeLine.replace("{m}", String(Math.round(d.lastAltM))),
      });
    }
    if (d.hasMap && d.markers && d.markers.length) {
      const markers = [...d.markers];
      const m0 = markers[0] as WechatMiniprogram.MapMarker;
      markers[0] = {
        ...m0,
        callout: { content: L.calloutCurrent, display: m0.callout?.display || "BYCLICK" },
      };
      this.setData({ markers });
    }
    if (d.locationError) {
      this.setData({ locationError: L.checkinLocErrorShort });
    }
  },

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
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    this.setData({
      checkTime: formatNow(),
      inspectorName: p.name || L.defaultInspector,
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
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    const hasAlt = typeof altM === "number" && !Number.isNaN(altM);
    const hi = hasAlt && altM! > ALT_FIRE_M;
    const points = this.buildRoute(latitude, longitude);
    this.setData({
      locating: false,
      hasMap: true,
      latitude,
      longitude,
      patrolPlace: placeText,
      lastAltM: hasAlt ? altM : undefined,
      highFireRiskAltitude: hi,
      altitudeTip: hi ? L.checkinAltitudeLine.replace("{m}", String(Math.round(altM!))) : "",
      markers: [
        {
          id: 1,
          latitude,
          longitude,
          width: 28,
          height: 28,
          callout: { content: L.calloutCurrent, display: "BYCLICK" },
        },
      ],
      polyline: [{ points, color: "#1677FF99", width: 4 }],
    });
  },

  refreshLocation() {
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    this.setData({ locating: true, locationError: "" });
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: false,
      success: (res) => {
        const { latitude, longitude, altitude } = res;
        const place = L.checkinLocCurrent.replace("{a}", latitude.toFixed(5)).replace("{b}", longitude.toFixed(5));
        this.applyLocation(latitude, longitude, place, altitude);
      },
      fail: () => {
        this.setData({
          locating: false,
          locationError: L.checkinLocErrorShort,
          patrolPlace: "",
        });
        wx.showModal({
          title: L.checkinLocFailTitle,
          content: L.checkinLocFailContent,
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
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    const remain = 9 - this.data.hazardImages.length;
    if (remain <= 0) return wx.showToast({ title: L.checkinMaxImg, icon: "none" });
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
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    if (this.data.submitting) return;
    const place = (this.data.patrolPlace || "").trim();
    if (!place) return wx.showToast({ title: L.checkinPlaceRequired, icon: "none" });

    if (this.data.patrolStatus === "hazard") {
      const desc = (this.data.hazardDesc || "").trim();
      const hasImages = this.data.hazardImages.length > 0;
      if (!desc && !hasImages) {
        return wx.showToast({ title: L.checkinHazardRequired, icon: "none" });
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
        wx.showToast({ title: L.checkinSuccess, icon: "success" });
        setTimeout(() => {
          wx.navigateBack({
            fail: () => wx.redirectTo({ url: "/pages/patrol-records/patrol-records" }),
          });
        }, 500);
      })
      .catch(() => {
        this.setData({ submitting: false });
        wx.showToast({ title: L.checkinFail, icon: "none" });
      });
  },
});
