/**
 * 页面 behaviors：注入 i18n 文案对象，并在语言切换时自动 setData
 * WXML 使用 {{i18n.xxx}} 绑定
 */
const lang = require("./lang.js");

module.exports = Behavior({
  lifetimes: {
    attached() {
      this._applyI18n = () => {
        const app = getApp();
        const L = lang.getStrings((app.globalData || {}).lang || "zh");
        this.setData({ i18n: L });
        if (typeof this.onI18nReady === "function") {
          try {
            this.onI18nReady(L);
          } catch (e) {}
        }
      };
      const app = getApp();
      if (app && typeof app.onLangChange === "function") {
        app.onLangChange(() => this._applyI18n());
      }
    },
  },

  pageLifetimes: {
    show() {
      if (this._applyI18n) this._applyI18n();
    },
  },
});
