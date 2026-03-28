const LANG_STORAGE_KEY = "lang_v1";
const zhCN = require("../i18n/zh-CN.js");
const boCN = require("../i18n/bo-CN.js");

const JOB_OPTIONS_KEY = ["patrol", "admin", "leader", "other"];

function loadLang() {
  try {
    const v = wx.getStorageSync(LANG_STORAGE_KEY);
    return v === "bo" ? "bo" : "zh";
  } catch (e) {
    return "zh";
  }
}

function saveLang(lang) {
  try {
    wx.setStorageSync(LANG_STORAGE_KEY, lang === "bo" ? "bo" : "zh");
  } catch (e) {}
}

function getStrings(lang) {
  return lang === "bo" ? boCN : zhCN;
}

function getJobIndexFromStoredRole(roleCN) {
  const map = {
    巡查员: 0,
    管理员: 1,
    值班领导: 2,
    其他: 3,
  };
  return map[roleCN] != null ? map[roleCN] : 0;
}

function getJobLabelByRoleCN(roleCN, lang) {
  const s = getStrings(lang);
  const i = getJobIndexFromStoredRole(roleCN);
  return s.jobOptions[i] || s.jobOptions[0];
}

module.exports = {
  LANG_STORAGE_KEY,
  loadLang,
  saveLang,
  getStrings,
  getJobIndexFromStoredRole,
  getJobLabelByRoleCN,
  JOB_OPTIONS_KEY,
};
