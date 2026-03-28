/**
 * 使用 Open-Meteo 公共接口（需在小程序后台配置 request 合法域名：api.open-meteo.com）
 * 坐标为 WGS84，与 GCJ-02 存在偏差，适合做区域级事前预警而非精确定位。
 */

function getJson(url) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: "GET",
      timeout: 14000,
      success: (res) => {
        if (res.statusCode === 200 && res.data) resolve(res.data);
        else reject(new Error("wx"));
      },
      fail: reject,
    });
  });
}

function fetchForecast6h(lat, lng) {
  const u =
    "https://api.open-meteo.com/v1/forecast?latitude=" +
    lat +
    "&longitude=" +
    lng +
    "&hourly=relative_humidity_2m,wind_speed_10m,temperature_2m,precipitation_probability,weather_code" +
    "&forecast_hours=6&timezone=Asia%2FShanghai&wind_speed_unit=ms";
  return getJson(u);
}

function fetchElevation(lat, lng) {
  const u =
    "https://api.open-meteo.com/v1/elevation?latitude=" + lat + "&longitude=" + lng;
  return getJson(u).then((d) => (Array.isArray(d.elevation) ? d.elevation[0] : null));
}

function demoHourly() {
  const times = [];
  const rh = [];
  const wind = [];
  const temp = [];
  const pp = [];
  const code = [];
  const now = Date.now();
  for (let i = 0; i < 6; i++) {
    const t = new Date(now + i * 3600000);
    times.push(t.toISOString().slice(0, 16));
    rh.push(48 - i);
    wind.push(2.8 + i * 0.15);
    temp.push(22 + i * 0.4);
    pp.push(12 + i * 2);
    code.push(i === 4 ? 95 : 2);
  }
  return { hourly: { time: times, relative_humidity_2m: rh, wind_speed_10m: wind, temperature_2m: temp, precipitation_probability: pp, weather_code: code } };
}

module.exports = { fetchForecast6h, fetchElevation, demoHourly };
