import type { FeedbackTicket, FeedbackTypeId, FeedbackStatus } from "../../types/helpFeedback";
import { FAQ_LIST, FAQ_LIST_BO } from "../../utils/faqData";
import { fetchFeedbackHistory, markTicketResolved, submitFeedback } from "../../utils/helpFeedbackService";

const lang = require("../../utils/lang.js");
const i18nBehavior = require("../../utils/i18nBehavior.js");

function buildFaqTabs(L: Record<string, string>) {
  return [
    { key: "all" as const, label: L.hfTabAll },
    { key: "patrol" as const, label: L.hfTabPatrol },
    { key: "report" as const, label: L.hfTabReport },
    { key: "warning" as const, label: L.hfTabWarning },
    { key: "account" as const, label: L.hfTabAccount },
  ];
}

function buildTypeOptions(L: Record<string, string>) {
  return [
    { id: "patrol" as FeedbackTypeId, label: L.hfTypePatrol },
    { id: "report" as FeedbackTypeId, label: L.hfTypeReport },
    { id: "warning" as FeedbackTypeId, label: L.hfTypeWarning },
    { id: "account" as FeedbackTypeId, label: L.hfTypeAccount },
    { id: "other" as FeedbackTypeId, label: L.hfTypeOther },
  ];
}

function feedbackStatusLabel(L: Record<string, string>, s: FeedbackStatus) {
  if (s === "pending") return L.hfStatusPending;
  if (s === "processing") return L.hfStatusProcessing;
  return L.hfStatusResolved;
}

Page({
  behaviors: [i18nBehavior],

  onI18nReady(L: Record<string, string>) {
    wx.setNavigationBarTitle({ title: L.navTitleHelp });
    this.setData({
      faqTabs: buildFaqTabs(L),
      typeOptions: buildTypeOptions(L),
      "contact.wechatHint": L.hfWechatSample,
      "contact.workTime": L.hfWorkTimeSample,
    });
    this.refreshFaq();
    this.loadHistory();
  },

  data: {
    searchKeyword: "",
    faqTabs: buildFaqTabs(lang.getStrings("zh")),
    activeCat: "all" as "all" | "patrol" | "report" | "warning" | "account",
    displayFaq: FAQ_LIST,
    expandedMap: {} as Record<string, boolean>,
    typeOptions: buildTypeOptions(lang.getStrings("zh")),
    typeIndex: 0,
    formContent: "",
    formImages: [] as string[],
    formContact: "",
    submitting: false,
    contact: {
      emergencyPhone: "12119",
      dutyPhone: "400-000-0000",
      wechatHint: "",
      workTime: "",
      qrUrl: "",
    },
    history: [] as Array<
      FeedbackTicket & { statusLabel: string; timeText: string; typeLabel: string }
    >,
  },

  onLoad() {
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    this.setData({
      "contact.wechatHint": L.hfWechatSample,
      "contact.workTime": L.hfWorkTimeSample,
    });
    this.refreshFaq();
  },

  onShow() {
    this.loadHistory();
  },

  refreshFaq() {
    const isBo = (getApp().globalData || {}).lang === "bo";
    const source = isBo ? FAQ_LIST_BO : FAQ_LIST;
    const kw = (this.data.searchKeyword || "").trim().toLowerCase();
    const cat = this.data.activeCat;
    const list = source.filter((item) => {
      if (cat !== "all" && item.category !== cat) return false;
      if (!kw) return true;
      const q = item.question.toLowerCase();
      const a = item.answer.toLowerCase();
      return q.includes(kw) || a.includes(kw);
    });
    this.setData({ displayFaq: list });
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    this.setData({ searchKeyword: e.detail.value }, () => this.refreshFaq());
  },

  onSearchConfirm() {
    this.refreshFaq();
  },

  onFaqTabTap(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as typeof this.data.activeCat;
    if (!key) return;
    this.setData({ activeCat: key }, () => this.refreshFaq());
  },

  onToggleFaq(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || "");
    if (!id) return;
    const expandedMap = { ...this.data.expandedMap, [id]: !this.data.expandedMap[id] };
    this.setData({ expandedMap });
  },

  onTypeChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ typeIndex: Number(e.detail.value) });
  },

  onContentInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ formContent: e.detail.value });
  },

  onContactInput(e: WechatMiniprogram.Input) {
    this.setData({ formContact: e.detail.value });
  },

  onChooseImage() {
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    const remain = 3 - this.data.formImages.length;
    if (remain <= 0) return wx.showToast({ title: L.reportMaxImg, icon: "none" });
    wx.chooseImage({
      count: remain,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (res) => {
        this.setData({
          formImages: this.data.formImages.concat(res.tempFilePaths).slice(0, 3),
        });
      },
    });
  },

  onRemoveImage(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const images = [...this.data.formImages];
    images.splice(index, 1);
    this.setData({ formImages: images });
  },

  onPreviewFormImage(e: WechatMiniprogram.TouchEvent) {
    const src = e.currentTarget.dataset.src as string;
    wx.previewImage({ current: src, urls: this.data.formImages });
  },

  onSubmitFeedback() {
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    if (this.data.submitting) return;
    const content = (this.data.formContent || "").trim();
    if (content.length < 5) {
      return wx.showToast({ title: L.reportDescMin, icon: "none" });
    }
    const type = this.data.typeOptions[this.data.typeIndex]?.id || "other";
    this.setData({ submitting: true });
    submitFeedback({
      type,
      content,
      images: this.data.formImages,
      contact: this.data.formContact,
    })
      .then(({ feedbackNo }) => {
        wx.showToast({
          title: L.hfSubmitSuccessFmt.replace("{no}", feedbackNo),
          icon: "success",
          duration: 2500,
        });
        this.setData({
          formContent: "",
          formImages: [],
          formContact: "",
          typeIndex: 0,
        });
        this.loadHistory();
      })
      .catch(() => {
        wx.showToast({ title: L.reportFail, icon: "none" });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },

  loadHistory() {
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    const opts = buildTypeOptions(L);
    fetchFeedbackHistory().then((list) => {
      const mapped = list.map((t) => ({
        ...t,
        images: t.images || [],
        statusLabel: feedbackStatusLabel(L, t.status),
        timeText: this.formatTime(t.createdAt),
        typeLabel: opts.find((x) => x.id === t.type)?.label || L.hfTypeOther,
      }));
      this.setData({ history: mapped });
    });
  },

  formatTime(ts: number) {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
      d.getMinutes()
    )}`;
  },

  onMarkResolved(e: WechatMiniprogram.TouchEvent) {
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    const no = String(e.currentTarget.dataset.no || "");
    if (!no) return;
    wx.showModal({
      title: L.hfMarkConfirmTitle,
      content: L.hfMarkConfirmContent,
      success: (res) => {
        if (!res.confirm) return;
        markTicketResolved(no).then(() => {
          wx.showToast({ title: L.hfMarked, icon: "success" });
          this.loadHistory();
        });
      },
    });
  },

  onCallPhone(e: WechatMiniprogram.TouchEvent) {
    const phone = String(e.currentTarget.dataset.phone || "");
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: phone.replace(/-/g, "") });
  },

  onPullDownRefresh() {
    this.loadHistory();
    setTimeout(() => wx.stopPullDownRefresh(), 400);
  },
});
