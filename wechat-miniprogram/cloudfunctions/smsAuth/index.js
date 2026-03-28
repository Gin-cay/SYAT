const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PHONE_RE = /^1[3-9]\d{9}$/;
const CODE_EXPIRE_MS = 5 * 60 * 1000;

function maskPhone(phone) {
  return `${String(phone).slice(0, 3)}****${String(phone).slice(-4)}`;
}

function ok(data = {}, message = "ok") {
  return { success: true, code: 200, message, ...data };
}

function fail(message = "请求失败", code = 400) {
  return { success: false, code, message };
}

function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

exports.main = async (event) => {
  try {
    const action = String(event?.action || "").trim();
    const scene = String(event?.scene || "profile_update").trim();
    const phone = String(event?.phone || "").trim();
    if (!PHONE_RE.test(phone)) return fail("手机号格式不正确", 400);

    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID || "";
    if (!openid) return fail("未获取到用户身份", 401);

    const col = db.collection("sms_codes");
    const now = Date.now();

    if (action === "send") {
      const code = makeCode();
      const verifyToken = `${now}_${Math.random().toString(36).slice(2, 10)}`;
      const expireAt = now + CODE_EXPIRE_MS;
      await col.add({
        data: {
          openid,
          phone,
          scene,
          code,
          verifyToken,
          used: false,
          createdAt: now,
          expireAt
        }
      });

      // 真实短信服务未接入前，返回 debugCode 便于调试流程。
      return ok(
        {
          verifyToken,
          expiresIn: CODE_EXPIRE_MS / 1000,
          maskedPhone: maskPhone(phone),
          debugCode: code
        },
        "验证码已生成（调试模式）"
      );
    }

    if (action === "verify") {
      const code = String(event?.code || "").trim();
      const verifyToken = String(event?.verifyToken || "").trim();
      if (!/^\d{6}$/.test(code)) return fail("验证码格式错误", 400);
      if (!verifyToken) return fail("verifyToken 缺失", 400);

      const queryRes = await col
        .where({
          openid,
          phone,
          scene,
          verifyToken,
          used: false,
          expireAt: _.gt(now)
        })
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();
      const row = Array.isArray(queryRes?.data) ? queryRes.data[0] : null;
      if (!row) return fail("验证码不存在或已过期", 400);
      if (String(row.code) !== code) return fail("验证码错误", 400);

      await col.doc(row._id).update({
        data: { used: true, verifiedAt: now }
      });
      return ok({}, "验证码校验成功");
    }

    return fail("action 仅支持 send / verify", 400);
  } catch (e) {
    return fail(e?.message || "服务异常", 500);
  }
};

