Page({
  onLogin() {
    // 示例：模拟登录状态
    wx.setStorageSync("login_state_v1", true);
    wx.setStorageSync("isLogin", true);
    wx.setStorageSync("auth_token", "mock_token");

    wx.switchTab({ url: "/pages/index/index" });
  }
});
