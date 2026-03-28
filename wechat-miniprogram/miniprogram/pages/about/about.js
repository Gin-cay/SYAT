const i18nBehavior = require("../../utils/i18nBehavior.js");

Page({
  behaviors: [i18nBehavior],

  onI18nReady(L) {
    wx.setNavigationBarTitle({ title: L.navTitleAbout });
  },

  goBack() {
    wx.navigateBack();
  },
});
