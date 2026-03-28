/** 管护无人区/核心区示意（可按行政区替换中心点与半径，单位 km） */
const WILDERNESS = [
  { name: "东缘无人巡护网格", lat: 30.12, lng: 102.88, radiusKm: 22 },
  { name: "西坡封育无人区", lat: 29.85, lng: 101.95, radiusKm: 18 },
];

const HIGH_ELEV_M = 3500;

function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function geoAlerts(lat, lng, elevationM) {
  const list = [];
  if (typeof elevationM === "number" && !Number.isNaN(elevationM) && elevationM >= HIGH_ELEV_M) {
    list.push({
      level: "red",
      kind: "peak",
      title: "高山高火险区",
      text: `当前位置海拔约 ${Math.round(elevationM)}m，植被垂直带易燃，需按红色预警加强巡护与禁火管控。`,
    });
  }
  WILDERNESS.forEach((z) => {
    if (distKm(lat, lng, z.lat, z.lng) <= z.radiusKm) {
      list.push({
        level: "red",
        kind: "wild",
        title: "无人/少人区",
        text: `您位于「${z.name}」范围内，通讯与扑救难度大，请务必提前报备并携带卫星手段。`,
      });
    }
  });
  return list;
}

function wildernessMarkers(startId) {
  let id = startId;
  return WILDERNESS.map((z) => ({
    id: id++,
    latitude: z.lat,
    longitude: z.lng,
    width: 32,
    height: 32,
    callout: {
      content: `${z.name}（无人区预警圈）`,
      color: "#333333",
      fontSize: 12,
      borderRadius: 4,
      bgColor: "#ffffff",
      padding: 6,
      display: "BYCLICK",
    },
  }));
}

module.exports = {
  WILDERNESS,
  HIGH_ELEV_M,
  distKm,
  geoAlerts,
  wildernessMarkers,
};
