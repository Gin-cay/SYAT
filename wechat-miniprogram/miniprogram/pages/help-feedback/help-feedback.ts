import type { FeedbackTicket, FeedbackTypeId } from "../../types/helpFeedback";
import { FEEDBACK_STATUS_LABEL } from "../../types/helpFeedback";
import { FAQ_CATEGORY_TABS, FAQ_LIST } from "../../utils/faqData";
import { fetchFeedbackHistory, markTicketResolved, submitFeedback } from "../../utils/helpFeedbackService";

const TYPE_OPTIONS: { id: FeedbackTypeId; label: string }[] = [
  { id: "patrol", label: "巡查打卡" },
  { id: "report", label: "火情上报" },
  { id: "warning", label: "预警通知" },
  { id: "account", label: "账号问题" },
  { id: "other", label: "其他" },
];

Page({
  data: {
    searchKeyword: "",
    faqTabs: FAQ_CATEGORY_TABS,
    activeCat: "all" as typeof FAQ_CATEGORY_TABS[number]["key"],
    displayFaq: FAQ_LIST,
    expandedMap: {} as Record<string, boolean>,
    typeOptions: TYPE_OPTIONS,
    typeIndex: 0,
    formContent: "",
    formImages: [] as string[],
    formContact: "",
    submitting: false,
    contact: {
      emergencyPhone: "12119",
      dutyPhone: "400-000-0000",
      wechatHint: "请添加运营提供的企业微信（示例文案）",
      workTime: "周一至周五 9:00–18:00；紧急值班 24h（按属地管理）",
      /** 将二维码放在 miniprogram/images 下并在此填写路径，或留空显示占位 */
      qrUrl: "",
    },
    history: [] as Array<
      FeedbackTicket & { statusLabel: string; timeText: string; typeLabel: string }
    >,
  },

  onLoad() {
    this.refreshFaq();
  },

  onShow() {
    this.loadHistory();
  },

  refreshFaq() {
    const kw = (this.data.searchKeyword || "").trim().toLowerCase();
    const cat = this.data.activeCat;
    const list = FAQ_LIST.filter((item) => {
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
    const key = e.currentTarget.dataset.key as typeof FAQ_CATEGORY_TABS[number]["key"];
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
    const remain = 3 - this.data.formImages.length;
    if (remain <= 0) return wx.showToast({ title: "最多3张图片", icon: "none" });
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
    if (this.data.submitting) return;
    const content = (this.data.formContent || "").trim();
    if (content.length < 5) {
      return wx.showToast({ title: "请至少输入5字问题描述", icon: "none" });
    }
    const type = TYPE_OPTIONS[this.data.typeIndex]?.id || "other";
    this.setData({ submitting: true });
    submitFeedback({
      type,
      content,
      images: this.data.formImages,
      contact: this.data.formContact,
    })
      .then(({ feedbackNo }) => {
        wx.showToast({ title: `提交成功 ${feedbackNo}`, icon: "success", duration: 2500 });
        this.setData({
          formContent: "",
          formImages: [],
          formContact: "",
          typeIndex: 0,
        });
        this.loadHistory();
      })
      .catch(() => {
        wx.showToast({ title: "提交失败，请稍后重试", icon: "none" });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },

  loadHistory() {
    fetchFeedbackHistory().then((list) => {
      const mapped = list.map((t) => ({
        ...t,
        images: t.images || [],
        statusLabel: FEEDBACK_STATUS_LABEL[t.status],
        timeText: this.formatTime(t.createdAt),
        typeLabel: TYPE_OPTIONS.find((x) => x.id === t.type)?.label || "其他",
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
    const no = String(e.currentTarget.dataset.no || "");
    if (!no) return;
    wx.showModal({
      title: "确认已解决？",
      content: "标记后可在列表中显示为已解决（仅本地与云端状态同步，实际以客服处理为准）。",
      success: (res) => {
        if (!res.confirm) return;
        markTicketResolved(no).then(() => {
          wx.showToast({ title: "已标记", icon: "success" });
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
