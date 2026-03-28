/**
 * 云函数：aiForestRisk
 * 作用：安全对接百度 EasyDL 自定义图像分类模型（方案A）
 *
 * 小程序端调用：wx.cloud.callFunction({ name:'aiForestRisk', data:{ images:[{base64}], type:'forest_fire_risk' } })
 * 返回结构：严格符合前端协议
 *
 * 你需要在云开发控制台 -> 云函数 -> 环境变量 配置：
 * - BAIDU_API_KEY：百度 AI 应用 API Key
 * - BAIDU_SECRET_KEY：百度 AI 应用 Secret Key
 * - EDL_VEG_URL：植被密度模型发布后的【接口地址】（不带 access_token 参数）
 * - EDL_DRY_URL：干燥程度模型发布后的【接口地址】
 * - EDL_RISK_URL：风险等级模型发布后的【接口地址】（可选，不配则用公式）
 *
 * 可选环境变量（JSON 字符串）：
 * - VEG_MAP_JSON：如 {"sparse":0.25,"medium":0.55,"dense":0.85}
 * - DRY_MAP_JSON：如 {"wet":0.2,"normal":0.55,"dry":0.85}
 */

const cloud = require("wx-server-sdk");
const https = require("https");
const { URL } = require("url");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

let cachedToken = "";
let cachedTokenExpMs = 0;

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function riskLevelFromScore(score) {
  const s = clamp01(score);
  if (s < 0.25) return "低";
  if (s < 0.5) return "中";
  if (s < 0.75) return "高";
  return "危";
}

function httpGetJson(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      {
        method: "GET",
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { Accept: "application/json" },
      },
      (res) => {
        let buf = "";
        res.on("data", (d) => (buf += d));
        res.on("end", () => {
          try {
            const json = JSON.parse(buf || "{}");
            resolve({ statusCode: res.statusCode || 0, data: json });
          } catch (e) {
            reject(new Error("Invalid JSON"));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function httpPostJson(urlStr, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = JSON.stringify(bodyObj || {});
    const req = https.request(
      {
        method: "POST",
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Accept: "application/json",
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (d) => (buf += d));
        res.on("end", () => {
          try {
            const json = JSON.parse(buf || "{}");
            resolve({ statusCode: res.statusCode || 0, data: json });
          } catch (e) {
            reject(new Error("Invalid JSON"));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedTokenExpMs - now > 60_000) return cachedToken;

  const apiKey = process.env.BAIDU_API_KEY || "";
  const secretKey = process.env.BAIDU_SECRET_KEY || "";
  if (!apiKey || !secretKey) throw new Error("Missing BAIDU_API_KEY/BAIDU_SECRET_KEY");

  const tokenUrl =
    "https://aip.baidubce.com/oauth/2.0/token" +
    `?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}` +
    `&client_secret=${encodeURIComponent(secretKey)}`;

  const r = await httpGetJson(tokenUrl);
  const token = r?.data?.access_token;
  const expiresIn = Number(r?.data?.expires_in || 0); // seconds
  if (!token) throw new Error("Failed to get access_token");

  cachedToken = token;
  cachedTokenExpMs = now + Math.max(300, expiresIn) * 1000;
  return token;
}

function parseEasydlTop1(respData) {
  // EasyDL 返回格式可能随模型类型变化，这里尽量兼容常见字段
  const results = respData?.results || respData?.result || respData?.data?.results || [];
  const arr = Array.isArray(results) ? results : [];
  if (!arr.length) return { label: "", score: 0 };
  const top = arr[0] || {};
  const label = String(top.name || top.label || top.class_name || "").trim();
  const score = Number(top.score || top.probability || top.confidence || 0);
  return { label, score: clamp01(score) };
}

function parseJsonEnv(name, fallback) {
  try {
    const v = process.env[name];
    if (!v) return fallback;
    const j = JSON.parse(v);
    return j && typeof j === "object" ? j : fallback;
  } catch (e) {
    return fallback;
  }
}

async function callEasydl(modelUrl, base64, topNum = 1) {
  if (!modelUrl) throw new Error("Missing model url");
  const token = await getAccessToken();
  const url = `${modelUrl}${modelUrl.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  const r = await httpPostJson(url, { image: base64, top_num: topNum });
  // 百度可能返回 error_code / error_msg
  if (r?.data?.error_code) {
    throw new Error(`Baidu error ${r.data.error_code}: ${r.data.error_msg || "unknown"}`);
  }
  return r.data;
}

function mapLabelToValue(label, score, mapObj, defaultValue) {
  const key = String(label || "").trim();
  const base = mapObj && Object.prototype.hasOwnProperty.call(mapObj, key) ? Number(mapObj[key]) : defaultValue;
  // 用置信度轻微拉近（避免输出完全离散）
  const v = clamp01(base);
  const s = clamp01(score);
  return clamp01(v * (0.75 + 0.25 * s));
}

exports.main = async (event) => {
  try {
    const requiredEnv = ["BAIDU_API_KEY", "BAIDU_SECRET_KEY", "EDL_VEG_URL", "EDL_DRY_URL"];
    const missingEnv = requiredEnv.filter((k) => !String(process.env[k] || "").trim());
    if (event?.action === "healthCheck") {
      return {
        success: missingEnv.length === 0,
        code: missingEnv.length ? 500 : 200,
        message: missingEnv.length
          ? `缺少环境变量：${missingEnv.join(", ")}`
          : "aiForestRisk 环境变量配置正常",
        data: {
          ready: missingEnv.length === 0,
          missingEnv,
          optionalEnv: {
            EDL_RISK_URL: !!String(process.env.EDL_RISK_URL || "").trim(),
            VEG_MAP_JSON: !!String(process.env.VEG_MAP_JSON || "").trim(),
            DRY_MAP_JSON: !!String(process.env.DRY_MAP_JSON || "").trim()
          }
        }
      };
    }

    const type = event?.type;
    const images = Array.isArray(event?.images) ? event.images : [];
    if (type !== "forest_fire_risk") {
      return {
        success: false,
        code: 400,
        message: "type 必须为 forest_fire_risk",
        data: { vegetation_density: 0, dryness: 0, risk_score: 0, risk_level: "低" },
      };
    }
    if (!images.length || !images[0]?.base64) {
      return {
        success: false,
        code: 400,
        message: "image 不能为空",
        data: { vegetation_density: 0, dryness: 0, risk_score: 0, risk_level: "低" },
      };
    }

    const vegUrl = String(process.env.EDL_VEG_URL || "").trim();
    const dryUrl = String(process.env.EDL_DRY_URL || "").trim();
    const riskUrl = process.env.EDL_RISK_URL || "";

    if (missingEnv.length > 0 || !vegUrl || !dryUrl) {
      return {
        success: false,
        code: 500,
        message: `请先配置云函数环境变量：${missingEnv.join(", ")}（可选：EDL_RISK_URL）`,
        data: { vegetation_density: 0, dryness: 0, risk_score: 0, risk_level: "低" },
      };
    }

    const VEG_MAP = parseJsonEnv("VEG_MAP_JSON", { sparse: 0.25, medium: 0.55, dense: 0.85 });
    const DRY_MAP = parseJsonEnv("DRY_MAP_JSON", { wet: 0.2, normal: 0.55, dry: 0.85 });

    // 多图：分别计算，取最高风险作为汇总（与小程序端一致）
    let best = null;

    for (const img of images.slice(0, 3)) {
      const base64 = String(img.base64 || "");

      const vegRaw = await callEasydl(vegUrl, base64, 1);
      const dryRaw = await callEasydl(dryUrl, base64, 1);
      const vegTop = parseEasydlTop1(vegRaw);
      const dryTop = parseEasydlTop1(dryRaw);

      const vegetation_density = mapLabelToValue(vegTop.label, vegTop.score, VEG_MAP, 0.55);
      const dryness = mapLabelToValue(dryTop.label, dryTop.score, DRY_MAP, 0.55);

      // 风险：优先用风险模型；没有则用公式计算
      let risk_score = clamp01(0.6 * dryness + 0.4 * vegetation_density);
      let risk_level = riskLevelFromScore(risk_score);

      if (riskUrl) {
        const riskRaw = await callEasydl(riskUrl, base64, 1);
        const riskTop = parseEasydlTop1(riskRaw);
        // 如果你风险模型 label 就是 低/中/高/危，直接用；否则按 score/规则转
        const lbl = String(riskTop.label || "");
        if (lbl === "低" || lbl === "中" || lbl === "高" || lbl === "危") {
          risk_level = lbl;
          // risk_score：用模型置信度做一个保守校准
          risk_score = clamp01(risk_score * 0.6 + riskTop.score * 0.4);
        } else {
          // 若 label 不是中文等级，则按 risk_score 走区间
          risk_score = clamp01(risk_score * 0.7 + riskTop.score * 0.3);
          risk_level = riskLevelFromScore(risk_score);
        }
      }

      const item = {
        vegetation_density,
        dryness,
        risk_score,
        risk_level,
        _debug: { vegTop, dryTop }
      };

      if (!best || item.risk_score > best.risk_score) best = item;
    }

    const out = best || { vegetation_density: 0, dryness: 0, risk_score: 0, risk_level: "低" };
    return {
      success: true,
      code: 200,
      message: "已完成 AI 风险评估（百度 EasyDL）。",
      data: {
        vegetation_density: clamp01(out.vegetation_density),
        dryness: clamp01(out.dryness),
        risk_score: clamp01(out.risk_score),
        risk_level: out.risk_level
      }
    };
  } catch (e) {
    return {
      success: false,
      code: 500,
      message: e?.message || "服务异常",
      data: { vegetation_density: 0, dryness: 0, risk_score: 0, risk_level: "低" }
    };
  }
};

