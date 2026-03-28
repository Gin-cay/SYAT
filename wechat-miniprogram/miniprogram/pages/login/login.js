const i18nBehavior = require("../../utils/i18nBehavior.js");

Page({
  behaviors: [i18nBehavior],

  onI18nReady(L) {
    wx.setNavigationBarTitle({ title: L.navTitleLogin });
  },

  onLogin() {
    wx.setStorageSync("login_state_v1", true);
    wx.setStorageSync("isLogin", true);
    wx.setStorageSync("auth_token", "mock_token");

    wx.switchTab({ url: "/pages/index/index" });
  },
});
