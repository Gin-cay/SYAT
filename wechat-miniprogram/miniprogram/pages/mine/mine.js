const { load } = require("../../utils/userProfileStorage.js");
const langUtils = require("../../utils/lang.js");
const i18nBehavior = require("../../utils/i18nBehavior.js");

Page({
  behaviors: [i18nBehavior],

  data: {
    userInfo: {
      avatar: "",
      name: "张林",
      role: "巡查员"
    },
    menuList: [
      { key: "patrol", title: "我的巡查记录", icon: "📍" },
      { key: "report", title: "我上报的火情", icon: "🔥" },
      { key: "warningSetting", title: "预警消息设置", icon: "🔔" },
      { key: "help", title: "帮助与反馈", icon: "💬" },
      { key: "about", title: "关于我们", icon: "ℹ️" }
    ]
  },

  onLoad() {
    const app = getApp();
    if (app && typeof app.onLangChange === "function") {
      app.onLangChange((l) => {
        this.syncLang(l);
        // 只更新角色标签，头像/姓名不变
        const rawRoleCN = this._roleCN || "巡查员";
        this.setData({ "userInfo.role": langUtils.getJobLabelByRoleCN(rawRoleCN, l) });
      });
    }
  },

  onShow() {
    const p = load();
    this._roleCN = p.role || "巡查员";
    const app = getApp();
    const l = (app.globalData || {}).lang || "zh";
    this.syncLang(l);
    this.setData({
      "userInfo.avatar": p.avatarPath || "",
      "userInfo.name": p.name || "张林",
      // 角色标签跟随语言
      "userInfo.role": langUtils.getJobLabelByRoleCN(p.role || "巡查员", l),
    });
  },

  syncLang(l) {
    const app = getApp();
    const cur = l || ((app.globalData || {}).lang || "zh");
    const L = langUtils.getStrings(cur);

    this.setData({
      menuList: [
        { key: "patrol", title: L.menuPatrol, icon: "📍" },
        { key: "report", title: L.menuReport, icon: "🔥" },
        { key: "warningSetting", title: L.menuWarningSetting, icon: "🔔" },
        { key: "help", title: L.menuHelp, icon: "💬" },
        { key: "about", title: L.menuAbout, icon: "ℹ️" },
      ],
    });
  },

  goEditProfile() {
    wx.navigateTo({ url: "/pages/profile/profile" });
  },

  onMenuTap(e) {
    const { key } = e.currentTarget.dataset;
    const app = getApp();
    const routeMap = {
      patrol: "/pages/patrol-records/patrol-records",
      report: "/pages/report/report",
      warningSetting: "/pages/warning-setting/warning-setting",
      help: "/pages/help-feedback/help-feedback",
      about: "/pages/about/about"
    };

    if (routeMap[key]) {
      wx.navigateTo({ url: routeMap[key] });
      return;
    }
  },

  onLogout() {
    const app = getApp();
    const L = langUtils.getStrings(app.globalData.lang || "zh");
    wx.showModal({
      title: L.logout,
      content: L.logoutConfirm,
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        // 清除登录状态（如存在不同项目使用的 key，则尽量一并清理）
        const clearKeys = [
          "login_state_v1",
          "isLogin",
          "auth_token",
          "user_token",
          "token",
          "login_token"
        ];
        clearKeys.forEach((k) => {
          try {
            wx.removeStorageSync(k);
          } catch (e) {}
        });

        wx.showToast({ title: L.logoutDone, icon: "success" });

        // 回到登录页（若你有真实登录逻辑，可在登录页接入）
        setTimeout(() => {
          wx.reLaunch({ url: "/pages/login/login" });
        }, 300);
      }
    });
  }
});