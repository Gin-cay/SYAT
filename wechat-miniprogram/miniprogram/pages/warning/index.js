const { fetchForecast6h, fetchElevation, demoHourly } = require("../../utils/weatherOpenMeteo.js");
const { buildSeries, heatCircles, windLevelCN } = require("../../utils/fireRiskEngine.js");
const { geoAlerts, wildernessMarkers } = require("../../utils/geoRiskZones.js");

function pad(n) {
  return `${n}`.padStart(2, "0");
}

function fmtNow() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtTimeLabel(iso) {
  if (!iso) return "";
  const s = String(iso).replace("T", " ");
  return s.length > 16 ? s.slice(11, 16) : s.slice(-5);
}

Page({
  data: {
    loading: true,
    err: "",
    lat: 30.1,
    lng: 102.5,
    scale: 10,
    heatCircles: [],
    markers: [],
    alerts: [],
    timeline: [],
    metrics: {
      humidity: 0,
      windMs: 0,
      windLevel: 0,
      lightning: 0,
      drought: 0,
    },
    headline: "",
    updatedText: "",
    fromDemo: false,
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh();
  },

  refresh() {
    this.setData({ loading: true, err: "" });
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: false,
      success: (res) => this.loadAll(res.latitude, res.longitude),
      fail: () => this.loadAll(30.12, 102.88),
    });
  },

  loadAll(lat, lng) {
    Promise.all([
      fetchElevation(lat, lng).catch(() => null),
      fetchForecast6h(lat, lng).catch(() => null),
    ])
      .then(([elv, wxBody]) => {
        let demo = false;
        let body = wxBody;
        if (!body || !body.hourly) {
          body = demoHourly();
          demo = true;
        }
        const s = buildSeries(body);
        const circles = heatCircles(lat, lng, s.peak);
        const alerts = geoAlerts(lat, lng, elv);
        const wild = wildernessMarkers(500);
        const markers = wild.concat([
          {
            id: 1,
            latitude: lat,
            longitude: lng,
            width: 28,
            height: 28,
            callout: { content: "当前位置", display: "BYCLICK" },
          },
        ]);
        const timeline = s.time.map((t, i) => ({
          tlab: fmtTimeLabel(t),
          fire: s.fire[i],
          drought: s.drought[i],
          lightning: s.lightning[i],
          rh: s.rh[i],
          wind: Math.round((s.windMs[i] || 0) * 10) / 10,
        }));
        const wms = s.avgWindMs || 0;
        const windLv = windLevelCN(wms);
        const headline = demo
          ? "（演示）未连接到气象接口：请配置 request 合法域名 api.open-meteo.com"
          : `未来6小时火险峰值 ${s.peak}，干旱与雷击叠加以防新火点`;

        this.setData({
          loading: false,
          lat,
          lng,
          heatCircles: circles,
          markers,
          alerts,
          timeline,
          metrics: {
            humidity: s.avgHumidity,
            windMs: Math.round(wms * 10) / 10,
            windLevel: windLv,
            lightning: s.avgLightning,
            drought: s.avgDrought,
          },
          headline,
          fromDemo: demo,
          updatedText: fmtNow(),
        });

        const t0 = s.temp && s.temp.length ? s.temp[0] : 0;
        getApp().globalData.fireBrief = {
          ts: Date.now(),
          maxFire: s.peak,
          todayData: {
            riskLevel: s.peak >= 72 ? "III级（较高）" : s.peak >= 45 ? "II级（中等）" : "I级（低）",
            temperature: Math.round(t0 || 0),
            humidity: s.avgHumidity,
            wind: windLv,
          },
          headline,
        };
      })
      .catch(() => {
        this.setData({ loading: false, err: "加载失败，请稍后下拉重试" });
      })
      .then(() => {
        wx.stopPullDownRefresh();
      });
  },
});
