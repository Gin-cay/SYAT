const { FORESTS, load, save } = require("../../utils/userProfileStorage.js");
const langUtils = require("../../utils/lang.js");

const PHONE_RE = /^1[3-9]\\d{9}$/;
const JOB_OPTIONS_CN = langUtils.getStrings("zh").jobOptions;
const SMS_COUNTDOWN_SECONDS = 60;

function padRole(role) {
  return role || "巡查员";
}

Page({
  data: {
    L: langUtils.getStrings("zh"),
    avatarPreview: "",
    avatarLetter: "林",

    name: "",
    phone: "",
    phoneEditable: true,
    smsCode: "",
    phoneError: "",
    phoneVerified: true,
    showSmsCodeInput: false,
    smsCooldown: 0,
    smsBtnText: "获取验证码并修改",
    smsBusy: false,
    smsVerifyToken: "",

    jobOptions: JOB_OPTIONS_CN,
    jobIndex: 0,

    // 保存前的原始快照，用于“重置/取消”恢复
    _original: null,
  },

  onLoad() {
    const p = load();
    const app = getApp();
    const curLang = (app.globalData || {}).lang || "zh";
    const L = langUtils.getStrings(curLang);
    const jobIndex = langUtils.getJobIndexFromStoredRole(p.role || "巡查员");

    // 原始快照（不随语言变化）
    this._original = {
      avatarPath: p.avatarPath || "",
      phone: p.phone || "",
      role: p.role || "巡查员",
      name: p.name || "",
      forestIndex: p.forestIndex || 0,
      gender: p.gender || "male",
    };

    const name = (p.name || "").trim();
    const letter = (name && name[0]) || "林";

    this.setData({
      L,
      avatarPreview: this._original.avatarPath,
      avatarLetter: letter,
      name,
      phone: this._original.phone,
      phoneEditable: true,
      smsCode: "",
      phoneError: "",
      phoneVerified: true,
      showSmsCodeInput: false,
      smsCooldown: 0,
      smsBtnText: "获取验证码并修改",
      smsBusy: false,
      smsVerifyToken: "",
      jobIndex,
      jobOptions: L.jobOptions,
    });

    if (app && typeof app.onLangChange === "function") {
      app.onLangChange((l) => {
        const nextL = langUtils.getStrings(l);
        this.setData({
          L: nextL,
          jobOptions: nextL.jobOptions,
        });
      });
    }
  },

  onChooseAvatar() {
    const applyTemp = (tempPath) => {
      if (!tempPath) {
        wx.showToast({ title: "未获取到头像图片", icon: "none" });
        return;
      }
      this.setData({ avatarPreview: tempPath });
    };

    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: (res) => applyTemp(res.tempFiles[0].tempFilePath),
      });
    } else {
      wx.chooseImage({
        count: 1,
        sourceType: ["album", "camera"],
        success: (res) => applyTemp(res.tempFilePaths[0]),
      });
    }
  },

  onNameInput(e) {
    const next = String(e?.detail?.value || "").trim().slice(0, 20);
    this.setData({
      name: next,
      avatarLetter: (next && next[0]) || this.data.avatarLetter || "林",
    });
  },

  onPhoneInput(e) {
    const next = e.detail.value.replace(/\\D/g, "").slice(0, 11);
    const originalPhone = ((this._original && this._original.phone) || "").trim();
    const isSame = next === originalPhone;
    this.setData({
      phone: next,
      phoneError: "",
      // 与原手机号一致时视为已验证；变更后需重新验码
      phoneVerified: isSame
    });
  },

  updateSmsButtonText() {
    const cd = Number(this.data.smsCooldown || 0);
    if (cd > 0) {
      this.setData({ smsBtnText: `${cd}s后重试` });
      return;
    }
    this.setData({ smsBtnText: "获取验证码并修改" });
  },

  startSmsCountdown(seconds = SMS_COUNTDOWN_SECONDS) {
    if (this._smsTimer) clearInterval(this._smsTimer);
    this.setData({ smsCooldown: Number(seconds) || SMS_COUNTDOWN_SECONDS }, () => {
      this.updateSmsButtonText();
    });
    this._smsTimer = setInterval(() => {
      const next = Number(this.data.smsCooldown || 0) - 1;
      if (next <= 0) {
        clearInterval(this._smsTimer);
        this._smsTimer = null;
        this.setData({ smsCooldown: 0 }, () => this.updateSmsButtonText());
        return;
      }
      this.setData({ smsCooldown: next }, () => this.updateSmsButtonText());
    }, 1000);
  },

  sendSmsCode(phone) {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: "smsAuth",
        data: { action: "send", phone, scene: "profile_update" },
        success: (res) => resolve(res?.result || {}),
        fail: reject
      });
    });
  },

  verifySmsCode(phone, code, verifyToken) {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: "smsAuth",
        data: { action: "verify", phone, code, verifyToken, scene: "profile_update" },
        success: (res) => resolve(res?.result || {}),
        fail: reject
      });
    });
  },

  async onEnablePhoneEdit() {
    if (this.data.smsCooldown > 0 || this.data.smsBusy) return;
    const phone = (this.data.phone || "").trim();
    if (!PHONE_RE.test(phone)) {
      this.setData({ phoneError: "请输入11位有效手机号" });
      wx.showToast({ title: "请先输入有效手机号", icon: "none" });
      return;
    }

    this.setData({
      smsBusy: true,
      showSmsCodeInput: true,
      smsCode: "",
      phoneError: "",
      phoneVerified: false
    });

    try {
      const resp = await this.sendSmsCode(phone);
      const ok = !!resp.success || Number(resp.code) === 200;
      if (!ok) {
        throw new Error(resp.message || "验证码发送失败");
      }
      this.setData({
        smsVerifyToken: String(resp.verifyToken || "")
      });
      this.startSmsCountdown(SMS_COUNTDOWN_SECONDS);
      if (resp.debugCode) {
        wx.showModal({
          title: "调试验证码",
          content: `当前验证码：${resp.debugCode}`,
          showCancel: false
        });
      }
      wx.showToast({ title: "验证码已发送", icon: "none" });
    } catch (e) {
      this.setData({ showSmsCodeInput: false });
      wx.showToast({ title: e?.message || "发送失败，请稍后重试", icon: "none" });
    } finally {
      this.setData({ smsBusy: false });
    }
  },

  async onCodeInput(e) {
    const code = e.detail.value.replace(/\\D/g, "").slice(0, 6);
    this.setData({ smsCode: code });
    if (code.length < 6 || this.data.smsBusy) return;

    const phone = (this.data.phone || "").trim();
    if (!PHONE_RE.test(phone)) {
      this.setData({ phoneError: "请输入11位有效手机号" });
      return;
    }
    this.setData({ smsBusy: true });
    try {
      const resp = await this.verifySmsCode(phone, code, this.data.smsVerifyToken);
      const ok = !!resp.success || Number(resp.code) === 200;
      if (!ok) {
        throw new Error(resp.message || "验证码错误");
      }
      this.setData({
        phoneVerified: true,
        showSmsCodeInput: false,
        smsCode: "",
        phoneError: ""
      });
      wx.showToast({ title: "手机号验证成功", icon: "success" });
    } catch (err) {
      this.setData({
        phoneVerified: false,
        phoneError: err?.message || "验证码错误，请重试"
      });
      wx.showToast({ title: "验证码校验失败", icon: "none" });
    } finally {
      this.setData({ smsBusy: false });
    }
  },

  onResendCode() {
    this.onEnablePhoneEdit();
  },

  onJobChange(e) {
    const idx = Number(e.detail.value) || 0;
    this.setData({ jobIndex: idx });
  },

  persistAvatarIfNeeded() {
    const originalPath = (this._original && this._original.avatarPath) || "";
    const cur = this.data.avatarPreview || "";
    if (!cur || cur === originalPath) return Promise.resolve(originalPath);

    return new Promise((resolve) => {
      wx.saveFile({
        tempFilePath: cur,
        success: (r) => resolve(r.savedFilePath),
        fail: () => resolve(cur),
      });
    });
  },

  onSave() {
    const name = (this.data.name || "").trim();
    const phone = (this.data.phone || "").trim();
    if (!phone || !PHONE_RE.test(phone)) {
      this.setData({ phoneError: "请输入11位有效手机号" });
      wx.showToast({ title: "保存失败：手机号格式不正确", icon: "none" });
      return;
    }
    const originalPhone = ((this._original && this._original.phone) || "").trim();
    const phoneChanged = phone !== originalPhone;
    if (phoneChanged && !this.data.phoneVerified) {
      this.setData({ phoneError: "请先完成验证码校验再保存" });
      wx.showToast({ title: "请先完成手机号验证码校验", icon: "none" });
      return;
    }

    // 存储时用中文职务，保证 mine 等页面兼容
    const roleCN = JOB_OPTIONS_CN[this.data.jobIndex] || "巡查员";

    this.persistAvatarIfNeeded()
      .then((avatarPath) => {
        save({
          avatarPath: avatarPath || "",
          name,
          phone,
          // 这里用 role 存职务（中文），便于 mine 页展示
          role: roleCN,
          forestIndex: (this._original && this._original.forestIndex) || 0,
          gender: (this._original && this._original.gender) || "male",
        });

        wx.showToast({ title: "保存成功", icon: "success" });

        setTimeout(() => {
          // 返回“我的”tab页
          wx.switchTab({ url: "/pages/mine/mine" });
        }, 300);
      })
      .catch(() => {
        wx.showToast({ title: "保存失败", icon: "none" });
      });
  },

  onCancel() {
    // 恢复到原始快照（不保存）
    if (this._original) {
      this.setData({
        avatarPreview: this._original.avatarPath || "",
        name: this._original.name || "",
        phone: this._original.phone || "",
        phoneEditable: true,
        smsCode: "",
        phoneError: "",
        phoneVerified: true,
        showSmsCodeInput: false,
        smsCooldown: 0,
        smsBtnText: "获取验证码并修改",
        smsBusy: false,
        smsVerifyToken: "",
        jobIndex: Math.max(0, JOB_OPTIONS_CN.indexOf(this._original.role || "巡查员")),
      });
    }

    wx.navigateBack({
      fail: () => wx.switchTab({ url: "/pages/mine/mine" }),
    });
  },

  onUnload() {
    if (this._smsTimer) {
      clearInterval(this._smsTimer);
      this._smsTimer = null;
    }
  },
});