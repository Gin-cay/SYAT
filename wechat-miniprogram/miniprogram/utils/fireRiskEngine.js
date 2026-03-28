function lightningFromCode(code) {
  const c = Number(code) || 0;
  if (c === 95 || c === 96 || c === 99) return 92;
  if (c === 85 || c === 86) return 55;
  if (c >= 80 && c <= 82) return 38;
  if (c >= 61 && c <= 67) return 22;
  return 6;
}

function droughtIndex(rh, tempC, precipProb, windMs) {
  const w = Math.min(14, Math.max(0, windMs));
  const v =
    (100 - rh) * 0.38 +
    Math.max(0, tempC - 10) * 1.05 +
    (100 - precipProb) * 0.22 +
    w * 2.6;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function fireRiskHourly(lightning, drought, windMs) {
  const w = (Math.min(14, Math.max(0, windMs)) / 14) * 100;
  return Math.round(Math.min(100, drought * 0.52 + lightning * 0.28 + w * 0.2));
}

function palette(risk) {
  const r = Math.max(0, Math.min(100, risk));
  if (r < 28) return { fill: "#1fa75e44", stroke: "#15824fcc" };
  if (r < 50) return { fill: "#e6c02955", stroke: "#b8940dee" };
  if (r < 72) return { fill: "#e67e2244", stroke: "#c95600cc" };
  return { fill: "#c0392b66", stroke: "#7b1d15dd" };
}

function sliceHourly(body) {
  const h = body.hourly || {};
  const n = 6;
  const rh = (h.relative_humidity_2m || []).slice(0, n);
  const wind = (h.wind_speed_10m || []).slice(0, n);
  const temp = (h.temperature_2m || []).slice(0, n);
  const pp = (h.precipitation_probability || []).slice(0, n);
  const code = (h.weather_code || []).slice(0, n);
  const time = (h.time || []).slice(0, n);
  return { rh, wind, temp, pp, code, time };
}

function buildSeries(body) {
  const { rh, wind, temp, pp, code, time } = sliceHourly(body);
  const len = Math.min(rh.length, wind.length, temp.length, pp.length, code.length, 6) || 0;
  const lightning = [];
  const drought = [];
  const fire = [];
  for (let i = 0; i < len; i++) {
    const l = lightningFromCode(code[i]);
    const d = droughtIndex(rh[i] || 0, temp[i] || 0, pp[i] || 0, wind[i] || 0);
    const f = fireRiskHourly(l, d, wind[i] || 0);
    lightning.push(l);
    drought.push(d);
    fire.push(f);
  }
  const peak = fire.length ? Math.max.apply(null, fire) : 0;
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
  return {
    time,
    rh,
    windMs: wind,
    temp,
    precipProb: pp,
    weatherCode: code,
    lightning,
    drought,
    fire,
    peak,
    avgLightning: avg(lightning),
    avgDrought: avg(drought),
    avgHumidity: avg(rh),
    avgWindMs: avg(wind),
  };
}

function heatCircles(centerLat, centerLng, peakFire, gridHalf = 2, step = 0.011) {
  const peak = Math.max(0, Math.min(100, peakFire || 0));
  const circles = [];
  for (let i = -gridHalf; i <= gridHalf; i++) {
    for (let j = -gridHalf; j <= gridHalf; j++) {
      const bias = 0.9 + 0.1 * (1 + Math.sin((i + j * 2) * 1.9)) / 2;
      const r = Math.min(100, peak * bias);
      const la = centerLat + i * step;
      const lo = centerLng + j * step * 1.05;
      const c = palette(r);
      circles.push({
        latitude: la,
        longitude: lo,
        color: c.stroke,
        fillColor: c.fill,
        radius: 480 + r * 7,
        strokeWidth: 1,
      });
    }
  }
  return circles;
}

function windLevelCN(ms) {
  const v = Math.max(0, ms);
  return Math.min(12, Math.round(v / 2.2));
}

module.exports = {
  buildSeries,
  heatCircles,
  windLevelCN,
  lightningFromCode,
  droughtIndex,
};
