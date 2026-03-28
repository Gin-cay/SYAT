const { load, FORESTS } = require("../../utils/userProfileStorage.js");

Page({
  data: {
    userInfo: {
      avatarUrl: "",
      avatarText: "林",
      name: "王巡查员",
      role: "巡查员",
      forest: "南山林区",
    },
    menuList: [
      { key: "profile", title: "个人资料" },
      { key: "patrol", title: "我的巡查记录（打卡历史）" },
      { key: "report", title: "我上报的火情" },
      { key: "setting", title: "预警消息设置" },
      { key: "feedback", title: "帮助与反馈" },
      { key: "about", title: "关于我们" }
    ],
  },

  onShow() {
    const p = load();
    const fi = Math.min(FORESTS.length - 1, Math.max(0, Number(p.forestIndex) || 0));
    this.setData({
      "userInfo.avatarUrl": p.avatarPath || "",
      "userInfo.name": p.name || "王巡查员",
      "userInfo.role": p.role || "巡查员",
      "userInfo.avatarText": (p.name || "林").trim().slice(0, 1) || "林",
      "userInfo.forest": FORESTS[fi] || FORESTS[0],
    });
  },

  goProfile() {
    wx.navigateTo({ url: "/pages/profile/profile" });
  },

  onTapMenu(e) {
    const { key, title } = e.currentTarget.dataset;
    if (key === "profile") {
      wx.navigateTo({ url: "/pages/profile/profile" });
      return;
    }
    if (key === "patrol") {
      wx.navigateTo({ url: "/pages/patrol-records/index" });
      return;
    }
    wx.showToast({
      title: title,
      icon: "none"
    });
  },

  onLogout() {
    wx.showModal({
      title: "提示",
      content: "确认退出当前账号？",
      success: (res) => {
        if (res.confirm) {
          wx.showToast({
            title: "已退出登录",
            icon: "success"
          });
        }
      }
    });
  }
});
