const KEY = "user_profile_v1";

const FORESTS = ["南山林区", "北坡林区", "东部防护带"];

function defaults() {
  return {
    avatarPath: "",
    name: "王巡查员",
    gender: "male",
    phone: "13800138000",
    forestIndex: 0,
    role: "巡查员",
  };
}

function load() {
  const base = defaults();
  try {
    const s = wx.getStorageSync(KEY);
    if (s && typeof s === "object") return { ...base, ...s, forestIndex: Number(s.forestIndex) || 0 };
  } catch (e) {}
  return base;
}

function save(data) {
  wx.setStorageSync(KEY, data);
}

module.exports = { KEY, FORESTS, defaults, load, save };
