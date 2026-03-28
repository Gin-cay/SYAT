const { load, save } = require("../../utils/userProfileStorage.js");
const langUtils = require("../../utils/lang.js");
const i18nBehavior = require("../../utils/i18nBehavior.js");

const PHONE_RE = /^1[3-9]\\d{9}$/;
const SMS_COUNTDOWN_SECONDS = 60;

function zhJobOptions() {
  return langUtils.getStrings("zh").jobOptions;
}

function padRole(role) {
  return role || "巡查员";
}

Page({
  behaviors: [i18nBehavior],

  onI18nReady(L) {
    wx.setNavigationBarTitle({ title: L.navTitleProfile });
    this.setData({ jobOptions: L.jobOptions });
  },

  data: {
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
    smsBtnText: "",
    smsBusy: false,
    smsVerifyToken: "",

    jobOptions: langUtils.getStrings("zh").jobOptions,
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
    const smsDefault = L.getCodeModify;

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
      smsBtnText: smsDefault,
      smsBusy: false,
      smsVerifyToken: "",
      jobIndex,
      jobOptions: L.jobOptions,
    });
  },

  onChooseAvatar() {
    const applyTemp = (tempPath) => {
      if (!tempPath) {
        const L = langUtils.getStrings((getApp().globalData || {}).lang || "zh");
        wx.showToast({ title: L.profileNoAvatar, icon: "none" });
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
    const L = langUtils.getStrings((getApp().globalData || {}).lang || "zh");
    const cd = Number(this.data.smsCooldown || 0);
    if (cd > 0) {
      this.setData({ smsBtnText: L.profileSmsRetry.replace("{s}", String(cd)) });
      return;
    }
    this.setData({ smsBtnText: L.getCodeModify });
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
    const L = langUtils.getStrings((getApp().globalData || {}).lang || "zh");
    if (this.data.smsCooldown > 0 || this.data.smsBusy) return;
    const phone = (this.data.phone || "").trim();
    if (!PHONE_RE.test(phone)) {
      this.setData({ phoneError: L.profilePhoneInvalid });
      wx.showToast({ title: L.profileToastPhoneFirst, icon: "none" });
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
          title: L.profileDebugTitle,
          content: L.profileDebugContent.replace("{code}", String(resp.debugCode)),
          showCancel: false
        });
      }
      wx.showToast({ title: L.profileSmsSent, icon: "none" });
    } catch (e) {
      this.setData({ showSmsCodeInput: false });
      wx.showToast({ title: e?.message || L.profileSmsSendFail, icon: "none" });
    } finally {
      this.setData({ smsBusy: false });
    }
  },

  async onCodeInput(e) {
    const L = langUtils.getStrings((getApp().globalData || {}).lang || "zh");
    const code = e.detail.value.replace(/\\D/g, "").slice(0, 6);
    this.setData({ smsCode: code });
    if (code.length < 6 || this.data.smsBusy) return;

    const phone = (this.data.phone || "").trim();
    if (!PHONE_RE.test(phone)) {
      this.setData({ phoneError: L.profilePhoneInvalid });
      return;
    }
    this.setData({ smsBusy: true });
    try {
      const resp = await this.verifySmsCode(phone, code, this.data.smsVerifyToken);
      const ok = !!resp.success || Number(resp.code) === 200;
      if (!ok) {
        throw new Error(resp.message || L.profileSmsWrong);
      }
      this.setData({
        phoneVerified: true,
        showSmsCodeInput: false,
        smsCode: "",
        phoneError: ""
      });
      wx.showToast({ title: L.profileSmsVerifyOk, icon: "success" });
    } catch (err) {
      this.setData({
        phoneVerified: false,
        phoneError: err?.message || L.profileSmsWrong
      });
      wx.showToast({ title: L.profileSmsVerifyFail, icon: "none" });
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
    const L = langUtils.getStrings((getApp().globalData || {}).lang || "zh");
    const name = (this.data.name || "").trim();
    const phone = (this.data.phone || "").trim();
    if (!phone || !PHONE_RE.test(phone)) {
      this.setData({ phoneError: L.profilePhoneInvalid });
      wx.showToast({ title: L.profileToastSaveInvalid, icon: "none" });
      return;
    }
    const originalPhone = ((this._original && this._original.phone) || "").trim();
    const phoneChanged = phone !== originalPhone;
    if (phoneChanged && !this.data.phoneVerified) {
      this.setData({ phoneError: L.profileVerifyFirst });
      wx.showToast({ title: L.profileVerifyToast, icon: "none" });
      return;
    }

    const z = zhJobOptions();
    const roleCN = z[this.data.jobIndex] || z[0];

    this.persistAvatarIfNeeded()
      .then((avatarPath) => {
        save({
          avatarPath: avatarPath || "",
          name,
          phone,
          role: roleCN,
          forestIndex: (this._original && this._original.forestIndex) || 0,
          gender: (this._original && this._original.gender) || "male",
        });

        wx.showToast({ title: L.profileSaveOk, icon: "success" });

        setTimeout(() => {
          wx.switchTab({ url: "/pages/mine/mine" });
        }, 300);
      })
      .catch(() => {
        wx.showToast({ title: L.checkinFail, icon: "none" });
      });
  },

  onCancel() {
    const L = langUtils.getStrings((getApp().globalData || {}).lang || "zh");
    const z = zhJobOptions();
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
        smsBtnText: L.getCodeModify,
        smsBusy: false,
        smsVerifyToken: "",
        jobIndex: Math.max(0, z.indexOf(this._original.role || "巡查员")),
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