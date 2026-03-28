const langUtils = require("../../utils/lang.js");

// ====== AI 接入方式 ======
// true：调用云函数 aiForestRisk
// false：走你本地/服务器的 HTTP 后端（wx.request）
const USE_BAIDU_EASYDL_CLOUD = false;

// ====== HTTP 后端地址（方案B：云托管 Python 服务） ======
// 优先读取 app.globalData.pythonBackendBaseUrl；
// 若未配置，使用占位地址并自动进入 mock，避免本地 127.0.0.1 报错。
const AI_BASE_URL_DEFAULT = "https://your-ai-api-domain.com";
function getAiBaseUrl() {
  try {
    const app = getApp();
    const v = String(app?.globalData?.pythonBackendBaseUrl || "").trim();
    return v || AI_BASE_URL_DEFAULT;
  } catch (e) {
    return AI_BASE_URL_DEFAULT;
  }
}
const AI_ENDPOINT = "/api/forest/risk/analyze";
/** 热力图：GET 全量点位，约定 { code:200, data:[{lat,lng,risk}] } */
const HEAT_POINTS_ENDPOINT = "/api/fire-risk/points";
/** 热力图：POST 单点落库 latitude + longitude + risk_score */
const HEAT_POINT_POST_ENDPOINT = "/api/fire-risk/point";
/** 开发者工具走 mock 且无后端时，拍照落点写入本地供热力图展示 */
const LOCAL_HEAT_STORAGE_KEY = "fire_heat_points_local_v1";
/** 热力点位本地持久化（30天内有效） */
const HEAT_MARKERS_STORAGE_KEY = "warning_heat_markers_v1";
const HEAT_MARKERS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** 用户曾成功定位时缓存，供拒绝权限且无热力点时的视野兜底（非固定城市） */
const WARNING_LAST_GCJ02 = "warning_last_gcj02";
/** 热力扩散半径（米） */
const HEATMAP_RADIUS_M = 1800;

const AI_CONFIG = {
  type: "forest_fire_risk",
  maxCount: 3,
  // base64 长度限制（不含前缀，仅纯 base64 字符串）
  base64MaxLen: 1_300_000,
  // compressImage 质量（0~100）
  compressQuality: 70,
  // 历史记录最多保存条数
  historyMax: 10,
  // 当 BASE_URL 还是占位时，自动使用本地模拟（便于先看 UI/流程）
  autoUseMockWhenPlaceholder: true,
  storageKey: "ai_alert_history_v1"
};

function isPlaceholderBaseUrl(url) {
  return !url || url.indexOf("your-ai-api-domain.com") >= 0;
}

function joinUrl(base, path) {
  if (!base) return path || "";
  if (!path) return base;
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return b + p;
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function to2(n) {
  return clamp01(n).toFixed(2);
}

function nowText() {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function riskLevelFromScore(score) {
  const s = clamp01(score);
  if (s < 0.25) return "低";
  if (s < 0.5) return "中";
  if (s < 0.75) return "高";
  return "危";
}

function levelKeyFromCn(level) {
  if (level === "低") return "low";
  if (level === "中") return "mid";
  if (level === "高") return "high";
  if (level === "危") return "crit";
  return "low";
}

function makeAiView(result) {
  const data = result?.data || {};
  const veg = clamp01(data.vegetation_density);
  const dry = clamp01(data.dryness);
  const risk = clamp01(data.risk_score);
  const msg = (result?.message || "").trim();
  const autoMsg = `本次识别到植被密度 ${to2(veg)}、干燥程度 ${to2(dry)}，综合风险系数 ${to2(risk)}（${data.risk_level || riskLevelFromScore(risk)}风险）。`;
  const levelKey = levelKeyFromCn(data.risk_level || riskLevelFromScore(risk));
  return {
    vegText: to2(veg),
    dryText: to2(dry),
    riskScoreText: to2(risk),
    vegPct: Math.round(veg * 100),
    dryPct: Math.round(dry * 100),
    riskScorePct: Math.round(risk * 100),
    messageText: msg || autoMsg,
    levelKey
  };
}

function readFileAsBase64(filePath) {
  return new Promise((resolve, reject) => {
    const fsm = wx.getFileSystemManager();
    fsm.readFile({
      filePath,
      encoding: "base64",
      success: (res) => resolve(res.data),
      fail: reject
    });
  });
}

function checkNetwork() {
  return new Promise((resolve) => {
    wx.getNetworkType({
      success: (res) => resolve(res.networkType && res.networkType !== "none"),
      fail: () => resolve(true)
    });
  });
}

// 本地模拟：无真实接口时可先看 UI
function mockAnalyze(base64Str) {
  return new Promise((resolve) => {
    const len = (base64Str || "").length;
    const seed = (len % 997) / 997;
    const vegetation_density = clamp01(0.35 + seed * 0.55);
    const dryness = clamp01(0.25 + (1 - seed) * 0.65);
    const risk_score = clamp01(0.4 * dryness + 0.6 * vegetation_density);
    const risk_level = riskLevelFromScore(risk_score);
    setTimeout(() => {
      resolve({
        success: true,
        code: 200,
        message: "（模拟）已完成 AI 风险评估，可对接真实接口替换结果。",
        data: { vegetation_density, dryness, risk_score, risk_level }
      });
    }, 650);
  });
}

function normalizeAiResult(raw) {
  const fail = (message, code = 500) => ({
    success: false,
    code,
    message: message || "服务异常",
    data: {
      vegetation_density: 0,
      dryness: 0,
      risk_score: 0,
      risk_level: "低"
    }
  });

  if (!raw || typeof raw !== "object") return fail("返回数据格式错误", 500);
  const success = !!raw.success;
  const code = [200, 400, 500].includes(raw.code) ? raw.code : (success ? 200 : 500);
  const message = typeof raw.message === "string" ? raw.message : (success ? "分析成功" : "分析失败");

  const d = raw.data || {};
  const vegetation_density = clamp01(d.vegetation_density);
  const dryness = clamp01(d.dryness);
  const risk_score = clamp01(d.risk_score);
  const risk_level = (d.risk_level === "低" || d.risk_level === "中" || d.risk_level === "高" || d.risk_level === "危")
    ? d.risk_level
    : riskLevelFromScore(risk_score);

  return {
    success,
    code,
    message,
    data: { vegetation_density, dryness, risk_score, risk_level }
  };
}

function maxByRisk(results) {
  const arr = Array.isArray(results) ? results : [];
  if (!arr.length) return null;
  let best = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const a = clamp01(best?.data?.risk_score);
    const b = clamp01(arr[i]?.data?.risk_score);
    if (b > a) best = arr[i];
  }
  return best;
}

/**
 * 热力图颜色分级（与产品需求一致）
 * - 绿：0 ~ 0.25 安全
 * - 黄：0.25 ~ 0.45 中等
 * - 红：0.45 ~ 1 极高
 */
function heatRiskTier(score) {
  const s = clamp01(score);
  if (s < 0.25) return "low";
  if (s < 0.45) return "mid";
  return "high";
}

function heatValueByRisk(score) {
  const tier = heatRiskTier(score);
  // 固定为三个离散值（不做渐变过渡）
  if (tier === "low") return 25;
  if (tier === "mid") return 45;
  return 100;
}

function gridKey(lat, lng, decimals = 4) {
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return "";
  return `${la.toFixed(decimals)},${lo.toFixed(decimals)}`;
}

function polygonFillByRisk(score) {
  const tier = heatRiskTier(score);
  if (tier === "low") return "#00FF0066";
  if (tier === "mid") return "#FFFF0066";
  return "#FF000066";
}

function pointToPolygon(lat, lng, score, halfStep = 0.008) {
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return {
    points: [
      { latitude: la - halfStep, longitude: lo - halfStep },
      { latitude: la - halfStep, longitude: lo + halfStep },
      { latitude: la + halfStep, longitude: lo + halfStep },
      { latitude: la + halfStep, longitude: lo - halfStep }
    ],
    strokeWidth: 0,
    strokeColor: "#00000000",
    fillColor: polygonFillByRisk(score),
    zIndex: heatRiskTier(score) === "high" ? 3 : heatRiskTier(score) === "mid" ? 2 : 1
  };
}

/** 视野包含：全部火险点位（gcj02） */
function buildHeatIncludePoints(points) {
  const list = Array.isArray(points) ? points : [];
  return list
    .map((p) => {
      const lat = Number(p.latitude);
      const lng = Number(p.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { latitude: lat, longitude: lng };
    })
    .filter(Boolean);
}

/**
 * 小程序 map 原生 heatmap 图层（多 intensity 点融合为渐变热区）。
 * radius 2000、opacity 0.8；渐变对应风险 0~0.25 绿、0.25~0.45 黄、0.45~1 红。
 * 注：极低版本基础库可能不渲染，此时 onHeatMapError 后走叠色圆降级。
 */
function buildMapHeatmapLayer(points) {
  const list = Array.isArray(points) ? points : [];
  const pts = list
    .map((p) => {
      const lat = Number(p.latitude);
      const lng = Number(p.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const risk = clamp01(p.risk_score);
      return {
        latitude: lat,
        longitude: lng,
        intensity: Math.max(1, Math.min(100, Math.round(risk * 100)))
      };
    })
    .filter(Boolean);
  if (!pts.length) return {};
  // map 组件 heatmap 图层：数据字段名为 data（与 polyline 的 points 不同）
  return {
    data: pts,
    radius: 2000,
    opacity: 0.8,
    gradient: {
      0.0: "rgb(0, 200, 100)",
      0.25: "rgb(80, 220, 120)",
      0.45: "rgb(255, 230, 80)",
      1.0: "rgb(220, 30, 40)"
    }
  };
}

/** heatmap 不支持时：2000m 半径半透明圆叠色，模拟聚合热区 */
function buildHeatmapFallbackCircles(points) {
  const list = Array.isArray(points) ? points : [];
  return list
    .map((p) => {
      const lat = Number(p.latitude);
      const lng = Number(p.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const risk = clamp01(p.risk_score);
      const fill =
        risk < 0.25 ? "#00A65155" : risk < 0.45 ? "#F5C40055" : "#E0202055";
      return {
        latitude: lat,
        longitude: lng,
        radius: 2000,
        strokeWidth: 0,
        color: "#00000000",
        fillColor: fill
      };
    })
    .filter(Boolean);
}

function heatUpdatedLabel() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 无用户定位时，用已有热力点位的经纬度均值作为地图中心 */
/**
 * 解析后端热力接口：优先新格式 data 为数组；兼容旧版 data.points
 * @returns {{ latitude: number, longitude: number, risk_score: number, ts?: number }[]}
 */
function normalizeHeatPointsResponse(body) {
  if (!body || typeof body !== "object") return [];
  const d = body.data;
  let raw = [];
  if (Array.isArray(d)) {
    const fail = (typeof body.code === "number" && body.code >= 400) || body.success === false;
    if (!fail) raw = d;
  } else if (d && Array.isArray(d.points)) {
    raw = d.points;
  }
  const out = [];
  for (const p of raw) {
    const lat = Number(p.lat != null ? p.lat : p.latitude);
    const lng = Number(p.lng != null ? p.lng : p.longitude);
    const risk = Number(p.risk != null ? p.risk : p.risk_score);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      latitude: lat,
      longitude: lng,
      risk_score: clamp01(Number.isFinite(risk) ? risk : 0),
      ts: p.ts
    });
  }
  return out;
}

function centroidOfHeatPoints(points) {
  const list = Array.isArray(points) ? points : [];
  let sLat = 0;
  let sLng = 0;
  let n = 0;
  for (const p of list) {
    const lat = Number(p.latitude);
    const lng = Number(p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    sLat += lat;
    sLng += lng;
    n += 1;
  }
  if (!n) return null;
  return { latitude: sLat / n, longitude: sLng / n };
}

function normalizeHeatMarkerRow(item) {
  if (!item || typeof item !== "object") return null;
  const latitude = Number(item.latitude);
  const longitude = Number(item.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const risk_score = clamp01(item.risk_score);
  let risk_level = "";
  if (item.risk_level === "低" || item.risk_level === "中" || item.risk_level === "高" || item.risk_level === "危") {
    risk_level = item.risk_level;
  } else {
    risk_level = riskLevelFromScore(risk_score);
  }

  const createdAt = Number(item.createdAt || item.ts || 0);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;

  return {
    latitude,
    longitude,
    risk_score,
    risk_level,
    createdAt,
    ts: createdAt
  };
}

Page({
  data: {
    L: langUtils.getStrings("zh"),

    /** 地图中心（火星坐标）；仅由 getLocation 与 refreshHeatMap 更新，不硬编码广州等城市 */
    latitude: 0,
    longitude: 0,
    scale: 12,

    /** 热力图点位（绑定到 <heatmap> points） */
    heatmapPoints: [],
    /** 兜底可视化：polygons 色块（heatmap 不生效时仍能随风险变化） */
    riskPolygons: [],
    /** map 原生 heatmap 图层对象（绑定到 <map heatmap="{{...}}"> ） */
    heatmapLayer: {},
    /** 热力图渐变（WXML 不写对象字面量，避免编译报错） */
    heatmapGradient: {
      0.25: "#00FF00",
      0.45: "#FFFF00",
      1.0: "#FF0000"
    },

    /**
     * 火险热力图：mapPhase loading → ready | blocked（无广州/任意城市硬编码中心）
     * mapPhase=ready 时渲染 map + heatmap；blocked 时仅提示，不影响下方 AI
     */
    heat: {
      mapPhase: "loading",
      showUserLocation: false,
      scale: 12,
      markers: [],
      includePoints: [],
      pointCount: 0,
      updatedText: "",
      locationHint: ""
    },

    // 过滤逻辑用 keys（显示用数组会随语言改变）
    levelKeys: ["all", "low", "medium", "high", "critical"],
    timeKeys: ["all", "24h", "3d", "7d", "30d"],

    levelOptions: [],
    timeOptions: [],

    levelIndex: 0,
    timeIndex: 0,

    // 基础数据只保留 key，显示文案在 syncLang/applyFilters 中生成
    warningList: [
      {
        id: "W20260325001",
        warningTime: "2026-03-25 09:20",
        warningTimestamp: new Date("2026-03-25 09:20:00").getTime(),
        location: "青松林场-北坡3号瞭望点",
        riskLevelKey: "critical",
        statusKey: "pending",
        description: "热红外监测发现持续高温热点，受风力影响扩散风险较高。"
      },
      {
        id: "W20260324008",
        warningTime: "2026-03-24 18:45",
        warningTimestamp: new Date("2026-03-24 18:45:00").getTime(),
        location: "南山防火隔离带K12区域",
        riskLevelKey: "high",
        statusKey: "processing",
        description: "无人机巡检发现疑似烟点，正在组织地面人员核查。"
      },
      {
        id: "W20260323003",
        warningTime: "2026-03-23 14:10",
        warningTimestamp: new Date("2026-03-23 14:10:00").getTime(),
        location: "白桦沟巡护线东段",
        riskLevelKey: "medium",
        statusKey: "done",
        description: "现场发现可燃物堆积，已清理并完成降温处置。"
      },
      {
        id: "W20260322006",
        warningTime: "2026-03-22 11:35",
        warningTimestamp: new Date("2026-03-22 11:35:00").getTime(),
        location: "老鹰嘴山脊西侧",
        riskLevelKey: "low",
        statusKey: "pending",
        description: "气象条件波动触发低级别预警，请保持持续监测。"
      }
    ],

    filteredWarnings: [],

    // ====== AI 模块状态（集成在预警中心） ======
    ai: {
      busy: false,
      netError: false,
      count: 0,
      images: [],
      result: null,
      view: null,
      history: []
    }
  },

  onLoad() {
    const app = getApp();
    const l = (app.globalData || {}).lang || "zh";
    this.syncLang(l);
    this.applyFilters();
    this.aiLoadHistory();

    if (app && typeof app.onLangChange === "function") {
      app.onLangChange((nextL) => {
        this.syncLang(nextL);
        this.applyFilters();
      });
    }

    /**
     * 地图中心仅在本次进入页面时通过 getLocation 获取真实位置；
     * 不使用固定城市经纬度作为「用户位置」默认值。
     */
    this._mapLocationState = "pending";
    this._userLat = null;
    this._userLng = null;
    this._heatmapFallback = false;
    wx.getLocation({
      type: "gcj02",
      success: (res) => {
        this.setData({
          longitude: res.longitude,
          latitude: res.latitude,
          "heat.mapPhase": "ready",
          "heat.showUserLocation": true,
        });
        this._mapLocationState = "ok";
        this._userLat = res.latitude;
        this._userLng = res.longitude;
        try {
          wx.setStorageSync(WARNING_LAST_GCJ02, {
            latitude: res.latitude,
            longitude: res.longitude
          });
        } catch (e) {}
        this.loadHeatmapData();
      },
      fail: () => {
        wx.showToast({ title: "请开启位置权限", icon: "none" });
        this.setData({
          "heat.mapPhase": "blocked",
          "heat.showUserLocation": false,
          "heat.locationHint": "请开启位置权限以查看热力图",
        });
        this._mapLocationState = "denied";
        this._userLat = null;
        this._userLng = null;
        this.loadHeatmapData();
      }
    });
  },

  onShow() {
    // onLoad 中定位未返回前不刷新，避免用占位坐标覆盖；返回 Tab 时再拉取热力数据
    if (this._mapLocationState !== "pending") {
      this.loadHeatmapData();
    }
  },

  onReady() {
    this._heatMapCtx = wx.createMapContext("heatMap", this);
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadHeatmapData()).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  readPersistedHeatMarkers() {
    try {
      const list = wx.getStorageSync(HEAT_MARKERS_STORAGE_KEY);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  },

  savePersistedHeatMarkers(list) {
    try {
      wx.setStorageSync(HEAT_MARKERS_STORAGE_KEY, Array.isArray(list) ? list : []);
    } catch (e) {}
  },

  /** 进入页面先清理超过30天旧点，再返回有效点 */
  cleanupExpiredHeatMarkers() {
    const now = Date.now();
    const valid = this.readPersistedHeatMarkers()
      .map(normalizeHeatMarkerRow)
      .filter((x) => !!x && now - x.createdAt <= HEAT_MARKERS_RETENTION_MS);
    this.savePersistedHeatMarkers(valid);
    return valid;
  },

  mergeHeatMarkersLastWin(points) {
    const map = new Map();
    for (const item of Array.isArray(points) ? points : []) {
      const row = normalizeHeatMarkerRow(item);
      if (!row) continue;
      const k = gridKey(row.latitude, row.longitude, 4);
      const prev = map.get(k);
      if (!prev || row.createdAt >= prev.createdAt) {
        map.set(k, row);
      }
    }
    return Array.from(map.values());
  },

  /**
   * 拉取点位并渲染热力图（含绿色安全底色）
   * GET /api/fire-risk/points -> [{lat,lng,risk_score|risk}, ...]
   */
  loadHeatmapData() {
    return new Promise((resolve) => {
      const localValid = this.cleanupExpiredHeatMarkers();
      // 云函数模式下，不再请求本地 HTTP 后端，直接使用本地已缓存点位渲染。
      if (USE_BAIDU_EASYDL_CLOUD) {
        const mergedValidRows = this.mergeHeatMarkersLastWin(localValid)
          .filter((x) => Date.now() - x.createdAt <= HEAT_MARKERS_RETENTION_MS);
        this.savePersistedHeatMarkers(mergedValidRows);

        const latestByPos = new Map();
        for (const item of mergedValidRows) {
          const latitude = Number(item.latitude);
          const longitude = Number(item.longitude);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
          const k = gridKey(latitude, longitude, 4);
          latestByPos.set(k, {
            latitude,
            longitude,
            risk: clamp01(item.risk_score),
            createdAt: item.createdAt
          });
        }
        const maxByCell = new Map();
        for (const v of latestByPos.values()) {
          const cellK = gridKey(v.latitude, v.longitude, 3);
          const cur = maxByCell.get(cellK);
          if (!cur || v.risk > cur.risk) maxByCell.set(cellK, v);
        }
        const pts = [];
        const polys = [];
        for (const v of maxByCell.values()) {
          pts.push({
            latitude: v.latitude,
            longitude: v.longitude,
            value: heatValueByRisk(v.risk)
          });
          const poly = pointToPolygon(v.latitude, v.longitude, v.risk);
          if (poly) polys.push(poly);
        }
        const curLat = Number(this.data.latitude);
        const curLng = Number(this.data.longitude);
        let nextLat = curLat;
        let nextLng = curLng;
        const hasCenter = Number.isFinite(curLat) && Number.isFinite(curLng) && !(curLat === 0 && curLng === 0);
        if (!hasCenter && pts.length) {
          const c = centroidOfHeatPoints(pts);
          if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
            nextLat = c.latitude;
            nextLng = c.longitude;
          }
        }
        const phase = (Number.isFinite(nextLat) && Number.isFinite(nextLng) && !(nextLat === 0 && nextLng === 0))
          ? "ready"
          : (this._mapLocationState === "pending" ? "loading" : "blocked");

        this.setData({
          heatmapPoints: pts,
          heatmapLayer: pts.length
            ? {
              data: pts,
              radius: HEATMAP_RADIUS_M,
              opacity: 0.8,
              max: 100,
              gradient: this.data.heatmapGradient
            }
            : {},
          riskPolygons: polys,
          latitude: nextLat,
          longitude: nextLng,
          "heat.mapPhase": phase,
          "heat.locationHint": phase === "blocked" ? "请开启位置权限以查看热力图" : "",
          "heat.showUserLocation": this._mapLocationState === "ok",
        });
        resolve(pts);
        return;
      }
      const aiBaseUrl = getAiBaseUrl();
      const url = joinUrl(aiBaseUrl, HEAT_POINTS_ENDPOINT);
      wx.request({
        url,
        method: "GET",
        timeout: 12000,
        success: (res) => {
          const body = res?.data || {};
          const list = Array.isArray(body?.data) ? body.data : [];
          const serverRows = list
            .map((item) => {
              const latitude = Number(item.lat != null ? item.lat : item.latitude);
              const longitude = Number(item.lng != null ? item.lng : item.longitude);
              const riskRaw = item.risk_score != null ? item.risk_score : (item.risk != null ? item.risk : 0);
              const risk_score = clamp01(riskRaw);
              const rawTs = Number(item.createdAt || item.ts || item.updatedAt || Date.now());
              const createdAt = Number.isFinite(rawTs) && rawTs > 0 ? rawTs : Date.now();
              return {
                latitude,
                longitude,
                risk_score,
                risk_level: item.risk_level || riskLevelFromScore(risk_score),
                createdAt,
                ts: createdAt
              };
            })
            .filter((x) => Number.isFinite(x.latitude) && Number.isFinite(x.longitude));
          const mergedValidRows = this.mergeHeatMarkersLastWin(localValid.concat(serverRows))
            .filter((x) => Date.now() - x.createdAt <= HEAT_MARKERS_RETENTION_MS);
          this.savePersistedHeatMarkers(mergedValidRows);

          // 同一经纬度只保留最新一条（后端已按 4 位小数 upsert，这里再做一次 last wins）
          const latestByPos = new Map();
          for (const item of mergedValidRows) {
            const latitude = Number(item.latitude);
            const longitude = Number(item.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
            const risk = clamp01(item.risk_score);
            const k = gridKey(latitude, longitude, 4);
            latestByPos.set(k, { latitude, longitude, risk, createdAt: item.createdAt });
          }

          // 重叠区域只显示最高优先级颜色：按网格聚合取 max（红>黄>绿）
          const maxByCell = new Map();
          for (const v of latestByPos.values()) {
            const cellK = gridKey(v.latitude, v.longitude, 3);
            const cur = maxByCell.get(cellK);
            if (!cur || v.risk > cur.risk) maxByCell.set(cellK, v);
          }

          const pts = [];
          const polys = [];
          for (const v of maxByCell.values()) {
            pts.push({
              latitude: v.latitude,
              longitude: v.longitude,
              value: heatValueByRisk(v.risk)
            });
            const poly = pointToPolygon(v.latitude, v.longitude, v.risk);
            if (poly) polys.push(poly);
          }

          const curLat = Number(this.data.latitude);
          const curLng = Number(this.data.longitude);
          let nextLat = curLat;
          let nextLng = curLng;
          const hasCenter = Number.isFinite(curLat) && Number.isFinite(curLng) && !(curLat === 0 && curLng === 0);

          if (!hasCenter && pts.length) {
            const c = centroidOfHeatPoints(pts);
            if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
              nextLat = c.latitude;
              nextLng = c.longitude;
            }
          }

          const phase = (Number.isFinite(nextLat) && Number.isFinite(nextLng) && !(nextLat === 0 && nextLng === 0))
            ? "ready"
            : (this._mapLocationState === "pending" ? "loading" : "blocked");

          const heatmapPoints = pts;

          this.setData({
            heatmapPoints,
            riskPolygons: polys,
            heatmapLayer: {
              data: heatmapPoints,
              radius: HEATMAP_RADIUS_M,
              opacity: 0.8,
              max: 100,
              gradient: this.data.heatmapGradient
            },
            latitude: nextLat,
            longitude: nextLng,
            "heat.mapPhase": phase,
            "heat.locationHint": this._mapLocationState === "ok" ? "" : (phase === "blocked" ? "请开启位置权限以查看热力图" : ""),
            "heat.showUserLocation": this._mapLocationState === "ok",
          });
          resolve(heatmapPoints);
        },
        fail: () => {
          const mergedValidRows = this.mergeHeatMarkersLastWin(localValid)
            .filter((x) => Date.now() - x.createdAt <= HEAT_MARKERS_RETENTION_MS);
          this.savePersistedHeatMarkers(mergedValidRows);

          const latestByPos = new Map();
          for (const item of mergedValidRows) {
            const latitude = Number(item.latitude);
            const longitude = Number(item.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
            const k = gridKey(latitude, longitude, 4);
            latestByPos.set(k, {
              latitude,
              longitude,
              risk: clamp01(item.risk_score),
              createdAt: item.createdAt
            });
          }
          const maxByCell = new Map();
          for (const v of latestByPos.values()) {
            const cellK = gridKey(v.latitude, v.longitude, 3);
            const cur = maxByCell.get(cellK);
            if (!cur || v.risk > cur.risk) maxByCell.set(cellK, v);
          }
          const pts = [];
          const polys = [];
          for (const v of maxByCell.values()) {
            pts.push({
              latitude: v.latitude,
              longitude: v.longitude,
              value: heatValueByRisk(v.risk)
            });
            const poly = pointToPolygon(v.latitude, v.longitude, v.risk);
            if (poly) polys.push(poly);
          }
          const curLat = Number(this.data.latitude);
          const curLng = Number(this.data.longitude);
          let nextLat = curLat;
          let nextLng = curLng;
          const hasCenter = Number.isFinite(curLat) && Number.isFinite(curLng) && !(curLat === 0 && curLng === 0);
          if (!hasCenter && pts.length) {
            const c = centroidOfHeatPoints(pts);
            if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
              nextLat = c.latitude;
              nextLng = c.longitude;
            }
          }
          const phase = (Number.isFinite(nextLat) && Number.isFinite(nextLng) && !(nextLat === 0 && nextLng === 0))
            ? "ready"
            : (this._mapLocationState === "pending" ? "loading" : "blocked");

          this.setData({
            heatmapPoints: pts,
            heatmapLayer: pts.length
              ? {
                data: pts,
                radius: HEATMAP_RADIUS_M,
                opacity: 0.8,
                max: 100,
                gradient: this.data.heatmapGradient
              }
              : {},
            riskPolygons: polys,
            latitude: nextLat,
            longitude: nextLng,
            "heat.mapPhase": phase,
            "heat.locationHint": phase === "blocked" ? "请开启位置权限以查看热力图" : "",
            "heat.showUserLocation": this._mapLocationState === "ok",
          });
          resolve(pts);
        }
      });
    });
  },

  fetchHeatPointsFromServer() {
    if (USE_BAIDU_EASYDL_CLOUD) {
      return Promise.resolve([]);
    }
    return new Promise((resolve) => {
      const aiBaseUrl = getAiBaseUrl();
      const url = joinUrl(aiBaseUrl, HEAT_POINTS_ENDPOINT);
      wx.request({
        url,
        method: "GET",
        timeout: 12000,
        success: (res) => {
          const body = res?.data || {};
          const pts = normalizeHeatPointsResponse(body);
          if (body.code === 200) {
            console.log("[fire-risk] GET /api/fire-risk/points 条数:", pts.length, body);
          } else {
            console.warn("[fire-risk] GET 点位异常:", body);
          }
          resolve(pts);
        },
        fail: (err) => {
          console.warn("[fire-risk] GET /api/fire-risk/points 失败", err);
          resolve([]);
        }
      });
    });
  },

  /**
   * 上传热力点：优先拍照时缓存的 _aiGeoForSubmit，否则临时 getLocation
   */
  resolveGeoForHeatUpload() {
    return new Promise((resolve) => {
      const g = this._aiGeoForSubmit;
      if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) {
        resolve({ latitude: g.latitude, longitude: g.longitude });
        return;
      }
      wx.getLocation({
        type: "gcj02",
        isHighAccuracy: true,
        success: (res) => resolve({ latitude: res.latitude, longitude: res.longitude }),
        fail: () => resolve(null)
      });
    });
  },

  /**
   * POST /api/fire-risk/point：latitude, longitude, risk_score（及可选植被/干燥/等级）
   */
  async uploadFireRiskPointToServer(resultData) {
    if (USE_BAIDU_EASYDL_CLOUD) {
      return;
    }
    const aiBaseUrl = getAiBaseUrl();
    if (!resultData || isPlaceholderBaseUrl(aiBaseUrl)) {
      console.log("[fire-risk] 跳过 POST：无分析数据或为占位 BASE_URL");
      return;
    }
    const geo = await this.resolveGeoForHeatUpload();
    if (!geo) {
      console.warn("[fire-risk] 跳过 POST：未获取到经纬度（定位权限或拍照前定位）");
      return;
    }
    const risk_score = clamp01(resultData.risk_score);
    const payload = {
      latitude: geo.latitude,
      longitude: geo.longitude,
      risk_score,
      vegetation_density: resultData.vegetation_density,
      dryness: resultData.dryness,
      risk_level: resultData.risk_level
    };
    console.log("[fire-risk] POST /api/fire-risk/point 发送:", JSON.stringify(payload));
    const url = joinUrl(aiBaseUrl, HEAT_POINT_POST_ENDPOINT);
    return new Promise((resolve) => {
      wx.request({
        url,
        method: "POST",
        header: { "Content-Type": "application/json" },
        data: payload,
        timeout: 12000,
        success: (res) => {
          console.log("[fire-risk] POST 响应:", res.statusCode, res.data);
          resolve(res);
        },
        fail: (err) => {
          console.warn("[fire-risk] POST 失败", err);
          resolve(null);
        }
      });
    });
  },

  readLocalHeatPoints() {
    try {
      const list = wx.getStorageSync(LOCAL_HEAT_STORAGE_KEY);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  },

  /** 无后端 / mock 模式下本地持久化落点，供热力图展示 */
  saveLocalHeatPoint(latitude, longitude, data) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !data) return;
    const row = {
      latitude,
      longitude,
      risk_score: clamp01(data.risk_score),
      ts: Date.now(),
      vegetation_density: data.vegetation_density,
      dryness: data.dryness,
      risk_level: data.risk_level
    };
    const next = [row, ...this.readLocalHeatPoints()].slice(0, 800);
    try {
      wx.setStorageSync(LOCAL_HEAT_STORAGE_KEY, next);
    } catch (e) {}
  },

  /**
   * 合并服务端 /api/fire-risk/points 全量点与本地 mock 点；
   * 优先用 map 的 heatmap 图层聚合渲染，失败则降级大半径叠色圆。
   * 中心点：仅用户真实定位（onLoad getLocation）或历史点质心/上次缓存，无广州等硬编码。
   */
  async refreshHeatMap() {
    if (this._mapLocationState === "pending") {
      return;
    }
    const aiBaseUrl = getAiBaseUrl();
    const useMock = AI_CONFIG.autoUseMockWhenPlaceholder && isPlaceholderBaseUrl(aiBaseUrl);
    let serverPts = [];
    if (!useMock) {
      serverPts = await this.fetchHeatPointsFromServer();
    }
    const localPts = useMock ? this.readLocalHeatPoints() : [];
    const merged = serverPts.concat(localPts);
    this._lastHeatPoints = merged;

    const include = buildHeatIncludePoints(merged);
    const showUser = this._mapLocationState === "ok";
    if (showUser && Number.isFinite(this._userLat) && Number.isFinite(this._userLng)) {
      include.push({ latitude: this._userLat, longitude: this._userLng });
    }

    let mapLat;
    let mapLng;
    let mapPhase = "blocked";

    if (showUser && Number.isFinite(this._userLat) && Number.isFinite(this._userLng)) {
      mapPhase = "ready";
      mapLat = this._userLat;
      mapLng = this._userLng;
    } else {
      const c = centroidOfHeatPoints(merged);
      if (c) {
        mapPhase = "ready";
        mapLat = c.latitude;
        mapLng = c.longitude;
      } else {
        let last = null;
        try {
          last = wx.getStorageSync(WARNING_LAST_GCJ02);
        } catch (e) {}
        if (
          last &&
          Number.isFinite(Number(last.latitude)) &&
          Number.isFinite(Number(last.longitude))
        ) {
          mapPhase = "ready";
          mapLat = Number(last.latitude);
          mapLng = Number(last.longitude);
        }
      }
    }

    let heatmapLayer = {};
    let circles = [];
    if (merged.length) {
      if (this._heatmapFallback) {
        circles = buildHeatmapFallbackCircles(merged);
      } else {
        heatmapLayer = buildMapHeatmapLayer(merged);
      }
    }

    if (mapPhase !== "ready" || !Number.isFinite(mapLat) || !Number.isFinite(mapLng)) {
      this.setData({
        heat: {
          ...this.data.heat,
          mapPhase: "blocked",
          showUserLocation: false,
          heatmap: {},
          markers: [],
          circles: [],
          includePoints: [],
          pointCount: merged.length,
          updatedText: heatUpdatedLabel(),
          locationHint: ""
        }
      });
      return;
    }

    const permissionHint = "请开启位置权限以查看热力图";
    this.setData(
      {
        latitude: mapLat,
        longitude: mapLng,
        heat: {
          ...this.data.heat,
          mapPhase: "ready",
          showUserLocation: showUser,
          scale: merged.length >= 8 ? 11 : 13,
          heatmap: heatmapLayer,
          markers: [],
          circles,
          includePoints: include,
          pointCount: merged.length,
          updatedText: heatUpdatedLabel(),
          locationHint: showUser ? "" : permissionHint
        }
      },
      () => {
        if (!this._heatMapCtx) {
          try {
            this._heatMapCtx = wx.createMapContext("heatMap", this);
          } catch (e) {}
        }
      }
    );
  },

  onHeatMapError(e) {
    console.warn("[heat-map] map binderror:", e?.detail);
    if (!this._heatmapFallback) {
      this._heatmapFallback = true;
      this.refreshHeatMap();
    }
  },

  syncLang(l) {
    const L = langUtils.getStrings(l);
    this._L = L;
    const levelOptions = [
      "全部",
      L.riskLow,
      L.riskMedium,
      L.riskHigh,
      L.riskCritical
    ];

    // 简化：时间选项只翻译“全部时间”，其它沿用中文（如需也可扩展到lang.js）
    const timeOptions = [
      L.allTime,
      "近24小时",
      "近3天",
      "近7天",
      "近30天"
    ];

    this.setData({
      L,
      levelOptions,
      timeOptions,
    });
  },

  onLevelChange(e) {
    this.setData({ levelIndex: Number(e.detail.value) }, () => this.applyFilters());
  },

  onTimeChange(e) {
    this.setData({ timeIndex: Number(e.detail.value) }, () => this.applyFilters());
  },

  applyFilters() {
    const now = Date.now();
    const { warningList, levelKeys, timeKeys, levelIndex, timeIndex } = this.data;
    const L = this._L || this.data.L;
    const selectedLevelKey = levelKeys[levelIndex];
    const selectedTimeKey = timeKeys[timeIndex];

    const timeMap = {
      all: 0,
      "24h": 24 * 60 * 60 * 1000,
      "3d": 3 * 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000
    };
    const maxAge = timeMap[selectedTimeKey] || 0;

    const riskLabelMap = {
      low: L.riskLow,
      medium: L.riskMedium,
      high: L.riskHigh,
      critical: L.riskCritical
    };
    const statusLabelMap = {
      pending: L.statusPending,
      processing: L.statusProcessing,
      done: L.statusDone
    };

    const filteredWarnings = warningList
      .filter((item) => {
        const levelMatched = selectedLevelKey === "all" || item.riskLevelKey === selectedLevelKey;
        const timeMatched = maxAge === 0 || now - item.warningTimestamp <= maxAge;
        return levelMatched && timeMatched;
      })
      .map((item) => ({
        ...item,
        riskLevel: riskLabelMap[item.riskLevelKey] || item.riskLevelKey,
        status: statusLabelMap[item.statusKey] || item.statusKey
      }));

    this.setData({ filteredWarnings });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.filteredWarnings.find((x) => x.id === id) || {};

    wx.navigateTo({
      url: `/pages/warning-detail/warning-detail?id=${id}&payload=${encodeURIComponent(JSON.stringify(item))}`
    });
  },

  // ====== AI：历史记录 ======
  aiLoadHistory() {
    let list = [];
    try {
      list = wx.getStorageSync(AI_CONFIG.storageKey) || [];
    } catch (e) {
      list = [];
    }
    this.setData({ "ai.history": Array.isArray(list) ? list : [] });
  },

  aiSaveHistoryItem(item) {
    const list = (this.data.ai.history || []).slice();
    const next = [item, ...list].slice(0, AI_CONFIG.historyMax);
    wx.setStorageSync(AI_CONFIG.storageKey, next);
    this.setData({ "ai.history": next });
  },

  aiSetBusy(on) {
    this.setData({ "ai.busy": !!on });
  },

  // ====== AI：选择图片 ======
  /**
   * 相机拍照：先取 gcj02 经纬度，与后续分析请求一并提交后端热力图落点
   */
  onAiChooseCamera() {
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: true,
      success: (res) => {
        this._aiGeoForSubmit = { latitude: res.latitude, longitude: res.longitude };
        this.aiChooseImage(["camera"]);
      },
      fail: () => {
        this._aiGeoForSubmit = null;
        wx.showModal({
          title: "位置权限",
          content:
            "未开启位置时仍可拍照分析，但该次结果不会记入热力图点位。可在系统设置中允许定位后重试拍照。",
          showCancel: true,
          confirmText: "继续拍照",
          cancelText: "取消",
          success: (r) => {
            if (r.confirm) this.aiChooseImage(["camera"]);
          }
        });
      }
    });
  },

  onAiChooseAlbum() {
    this._aiGeoForSubmit = null;
    this.aiChooseImage(["album"]);
  },

  aiChooseImage(sourceType) {
    if (this.data.ai.busy) return;
    const remain = AI_CONFIG.maxCount - (this.data.ai.count || 0);
    if (remain <= 0) {
      wx.showToast({ title: `最多只能上传 ${AI_CONFIG.maxCount} 张照片`, icon: "none" });
      return;
    }

    wx.chooseImage({
      count: remain,
      sizeType: ["compressed", "original"],
      sourceType,
      success: async (res) => {
        const paths = (res?.tempFilePaths || []).filter(Boolean);
        if (!paths.length) {
          wx.showToast({ title: "未获取到照片", icon: "none" });
          return;
        }
        await this.aiPrepareImages(paths);
      },
      fail: (err) => {
        if (err && (err.errMsg || "").indexOf("cancel") >= 0) return;
        wx.showToast({ title: "选择图片失败", icon: "none" });
      }
    });
  },

  async aiPrepareImages(tempPaths) {
    this.aiSetBusy(true);
    this.setData({ "ai.netError": false });
    wx.showLoading({ title: "图片处理中…", mask: true });

    try {
      const current = Array.isArray(this.data.ai.images) ? this.data.ai.images.slice() : [];
      const remain = AI_CONFIG.maxCount - current.length;
      const pick = (tempPaths || []).slice(0, Math.max(0, remain));
      if (!pick.length) {
        wx.showToast({ title: `最多只能上传 ${AI_CONFIG.maxCount} 张照片`, icon: "none" });
        wx.hideLoading();
        this.aiSetBusy(false);
        return;
      }

      for (const tempPath of pick) {
        const compressedPath = await new Promise((resolve) => {
          wx.compressImage({
            src: tempPath,
            quality: AI_CONFIG.compressQuality,
            success: (r) => resolve(r.tempFilePath || tempPath),
            fail: () => resolve(tempPath)
          });
        });

        const base64 = await readFileAsBase64(compressedPath);
        if (!base64) {
          wx.showToast({ title: "图片读取失败", icon: "none" });
          continue;
        }
        if (base64.length > AI_CONFIG.base64MaxLen) {
          wx.showToast({ title: "图片过大，已跳过一张", icon: "none" });
          continue;
        }

        current.push({
          id: makeId(),
          localPath: compressedPath,
          thumbPath: compressedPath,
          base64
        });
      }

      this.setData({
        "ai.images": current,
        "ai.count": current.length
      });

      // 先结束「图片处理」loading，再交给 onAiAnalyze 单独 show/hide（避免连续两次 showLoading）
      wx.hideLoading();
      this.aiSetBusy(false);
      if (current.length) await this.onAiAnalyze();
    } catch (e) {
      wx.showToast({ title: "图片处理失败，请重试", icon: "none" });
      wx.hideLoading();
      this.aiSetBusy(false);
    }
  },

  onAiPreviewImage() {
    if (!this.data.ai.count) return;
    const idx = Number(arguments?.[0]?.currentTarget?.dataset?.idx);
    const images = this.data.ai.images || [];
    const urls = images.map(x => x.localPath).filter(Boolean);
    wx.previewImage({
      current: urls[Math.max(0, Math.min(urls.length - 1, Number.isFinite(idx) ? idx : 0))] || urls[0],
      urls
    });
  },

  onAiRemoveOne(e) {
    if (this.data.ai.busy) return;
    const id = e?.currentTarget?.dataset?.id;
    const next = (this.data.ai.images || []).filter(x => x.id !== id);
    const cleared = next.length === 0;
    this.setData({
      "ai.images": next,
      "ai.count": next.length,
      "ai.result": cleared ? null : this.data.ai.result,
      "ai.view": cleared ? null : this.data.ai.view,
      "ai.netError": false
    });
    if (cleared) {
      this.setData({ "ai.result": null, "ai.view": null });
    }
  },

  onAiClearAll() {
    if (this.data.ai.busy) return;
    this.setData({
      "ai.images": [],
      "ai.count": 0,
      "ai.result": null,
      "ai.view": null,
      "ai.netError": false
    });
  },

  // ====== AI：调用接口 ======
  async onAiAnalyze() {
    if (this.data.ai.busy) return;
    if (!this.data.ai.count) {
      wx.showToast({ title: "请先上传照片", icon: "none" });
      return;
    }

    const okNet = await checkNetwork();
    if (!okNet) {
      this.setData({ "ai.netError": true });
      wx.showToast({ title: "当前无网络，请重试", icon: "none" });
      return;
    }

    this.aiSetBusy(true);
    this.setData({ "ai.netError": false });
    wx.showLoading({ title: "AI 分析中…", mask: true });

    try {
      const aiBaseUrl = getAiBaseUrl();
      const useMock = AI_CONFIG.autoUseMockWhenPlaceholder && isPlaceholderBaseUrl(aiBaseUrl);
      const images = (this.data.ai.images || []).slice();
      const results = [];

      for (const img of images) {
        const payload = { image: img.base64, type: AI_CONFIG.type };
        const geo = this._aiGeoForSubmit;
        if (geo && Number.isFinite(geo.latitude) && Number.isFinite(geo.longitude)) {
          payload.latitude = geo.latitude;
          payload.longitude = geo.longitude;
        }
        const raw = useMock ? await mockAnalyze(img.base64) : await this.aiCall(payload);
        results.push(normalizeAiResult(raw));
      }

      const best = maxByRisk(results) || normalizeAiResult(null);
      // 汇总 message：优先用最高风险那张的 message
      const normalized = best;

      this.setData({
        "ai.result": normalized,
        "ai.view": makeAiView(normalized)
      });

      if (normalized.success) {
        const geo = this._aiGeoForSubmit;
        if (useMock && geo && normalized.data) {
          this.saveLocalHeatPoint(geo.latitude, geo.longitude, normalized.data);
        }
        // 拍照/上传分析成功后自动携带位置+风险上报，并立即刷新热力图
        await this.uploadFireRiskPointToServer(normalized.data);
        await this.loadHeatmapData();
        wx.showToast({ title: "分析成功", icon: "success" });
      } else {
        wx.showToast({ title: normalized.message || "分析失败", icon: "none" });
      }
    } catch (e) {
      this.setData({ "ai.netError": true });
      wx.showToast({ title: "请求失败，请重试", icon: "none" });
    } finally {
      wx.hideLoading();
      this.aiSetBusy(false);
    }
  },

  aiCall(payload) {
    if (USE_BAIDU_EASYDL_CLOUD) {
      return new Promise((resolve, reject) => {
        wx.cloud.callFunction({
          name: "aiForestRisk",
          data: {
            type: payload.type,
            // 云函数支持多图；这里按当前多图入口把 images 传过去
            images: (this.data.ai.images || []).slice(0, AI_CONFIG.maxCount).map((x) => ({ base64: x.base64 }))
          },
          success: (res) => resolve(res?.result),
          fail: reject
        });
      });
    }

    const aiBaseUrl = getAiBaseUrl();
    const url = joinUrl(aiBaseUrl, AI_ENDPOINT);
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method: "POST",
        header: { "Content-Type": "application/json" },
        data: payload,
        timeout: 15000,
        success: (res) => resolve(res?.data),
        fail: reject
      });
    });
  },

  onAiRetry() {
    if (this.data.ai.busy) return;
    if (this.data.ai.count) {
      this.onAiAnalyze();
    } else {
      wx.showToast({ title: "请先上传照片", icon: "none" });
    }
  },

  async onAiSaveRecord() {
    if (this.data.ai.busy) return;
    if (!this.data.ai.result || !this.data.ai.result.success) {
      wx.showToast({ title: "暂无可保存的成功结果", icon: "none" });
      return;
    }

    const r = this.data.ai.result.data;
    const first = (this.data.ai.images || [])[0] || {};
    const item = {
      id: makeId(),
      time: nowText(),
      thumbPath: first.thumbPath || first.localPath || "",
      risk_level: r.risk_level,
      risk_level_key: levelKeyFromCn(r.risk_level),
      risk_score: clamp01(r.risk_score),
      risk_score_text: to2(r.risk_score),
      detail: this.data.ai.result
    };
    this.aiSaveHistoryItem(item);
    // 保存时重新取一次定位，并按 4 位小数归一化（更符合“原地覆盖”预期）
    const geo = await this.resolveGeoForHeatUpload();
    const latitudeRaw = geo ? geo.latitude : this.data.latitude;
    const longitudeRaw = geo ? geo.longitude : this.data.longitude;
    const latitude = Number(Number(latitudeRaw).toFixed(4));
    const longitude = Number(Number(longitudeRaw).toFixed(4));
    const risk_score = clamp01(r.risk_score);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      if (!USE_BAIDU_EASYDL_CLOUD) {
        await new Promise((resolve) => {
          const aiBaseUrl = getAiBaseUrl();
          const url = joinUrl(aiBaseUrl, HEAT_POINT_POST_ENDPOINT);
          wx.request({
            url,
            method: "POST",
            header: { "Content-Type": "application/json" },
            data: { latitude, longitude, risk_score },
            timeout: 12000,
            success: () => resolve(true),
            fail: () => resolve(false)
          });
        });
      }

      // 记录最新保存风险，供 loadHeatmapData 优先覆盖当前网格
      this._latestRiskOverride = { latitude, longitude, risk_score };
      await this.loadHeatmapData();
    }
    wx.showToast({ title: "已保存到最近记录", icon: "success" });
  },

  onAiOpenHistory(e) {
    const id = e?.currentTarget?.dataset?.id;
    if (!id) return;
    const item = (this.data.ai.history || []).find((x) => x.id === id);
    if (!item) return;

    const d = item.detail?.data || {};
    const content =
      `时间：${item.time}\n` +
      `风险等级：${item.risk_level}\n` +
      `风险系数：${to2(d.risk_score)}\n` +
      `植被密度：${to2(d.vegetation_density)}\n` +
      `干燥程度：${to2(d.dryness)}`;

    wx.showModal({
      title: "记录详情",
      content,
      showCancel: true,
      cancelText: "关闭",
      confirmText: "看图",
      success: (res) => {
        if (res.confirm && item.thumbPath) {
          wx.previewImage({ current: item.thumbPath, urls: [item.thumbPath] });
        }
      }
    });
  }
});