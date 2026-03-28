import type { WarningSettingsState } from "../../types/warningSettings";
import {
  applyMasterSwitch,
  fetchSettingsFromCloud,
  getLogsLast7Days,
  loadLocalSettings,
  mergeSettings,
  saveLocalSettings,
  syncSettingsToCloud,
} from "../../utils/warningSettingsService";

const initialSettings = loadLocalSettings();

const lang = require("../../utils/lang.js");
const i18nBehavior = require("../../utils/i18nBehavior.js");

const initialL = lang.getStrings(lang.loadLang());

const TEMPLATE_RANGE = [{ id: "default" as const }, { id: "detail" as const }, { id: "brief" as const }];

function templateLabelsFromL(L: Record<string, string>) {
  return [L.templateStd, L.templateDetail, L.templateBrief];
}

Page({
  behaviors: [i18nBehavior],

  onI18nReady(L: Record<string, string>) {
    wx.setNavigationBarTitle({ title: L.navTitleWarningSetting });
    const km = this.data.settings.region.radiusKm;
    this.setData({
      forestNames: L.forestOptions,
      grids: L.gridOptions,
      templateLabels: templateLabelsFromL(L),
      radiusLabel: L.wsRadiusFmt.replace("{km}", String(km)),
    });
  },

  data: {
    settings: initialSettings,
    forestNames: initialL.forestOptions as string[],
    grids: initialL.gridOptions as string[],
    templateLabels: templateLabelsFromL(initialL),
    radiusLabel: initialL.wsRadiusFmt.replace("{km}", String(initialSettings.region.radiusKm)),
    templateIndex: 0,
    logs: [] as ReturnType<typeof getLogsLast7Days>,
    formDisabled: false,
    syncing: false,
  },

  onLoad() {
    this.bootstrap();
  },

  onShow() {
    this.refreshLogs();
  },

  bootstrap() {
    const local = loadLocalSettings();
    this.setData({ settings: local, formDisabled: !local.masterEnabled });
    this.syncTemplateIndex(local);
    this.setData({ syncing: true });
    fetchSettingsFromCloud()
      .then((remote) => {
        const merged = mergeSettings(loadLocalSettings(), remote);
        saveLocalSettings(merged);
        this.setData({
          settings: merged,
          formDisabled: !merged.masterEnabled,
        });
        this.syncTemplateIndex(merged);
      })
      .finally(() => {
        this.setData({ syncing: false });
        this.refreshLogs();
      });
  },

  syncTemplateIndex(s: WarningSettingsState) {
    const idx = TEMPLATE_RANGE.findIndex((t) => t.id === s.content.templateId);
    this.setData({ templateIndex: idx >= 0 ? idx : 0 });
  },

  updateRadiusLabel() {
    const L = lang.getStrings((getApp().globalData || {}).lang || "zh");
    const km = this.data.settings.region.radiusKm;
    this.setData({ radiusLabel: L.wsRadiusFmt.replace("{km}", String(km)) });
  },

  refreshLogs() {
    this.setData({ logs: getLogsLast7Days() });
  },

  persist(next: WarningSettingsState) {
    const saved = saveLocalSettings(next);
    this.setData({ settings: saved }, () => this.updateRadiusLabel());
    syncSettingsToCloud(saved).catch(() => {});
  },

  onMasterChange(e: WechatMiniprogram.SwitchChange) {
    const on = !!e.detail.value;
    const cur = loadLocalSettings();
    const next = applyMasterSwitch(cur, on);
    this.setData({ settings: next, formDisabled: !on });
    syncSettingsToCloud(next).catch(() => {});
  },

  onCategoryChange(e: WechatMiniprogram.SwitchChange) {
    const key = e.currentTarget.dataset.key as keyof WarningSettingsState["categories"];
    if (!key || this.data.formDisabled) return;
    const cur = loadLocalSettings();
    const v = !!e.detail.value;
    const categories = { ...cur.categories, [key]: v };
    const categorySnapshot = { ...cur.categorySnapshot, [key]: v };
    const next = saveLocalSettings({ ...cur, categories, categorySnapshot });
    this.setData({ settings: next });
    syncSettingsToCloud(next).catch(() => {});
  },

  onChannelChange(e: WechatMiniprogram.SwitchChange) {
    const key = e.currentTarget.dataset.key as keyof WarningSettingsState["channels"];
    if (!key || this.data.formDisabled) return;
    const cur = loadLocalSettings();
    const channels = { ...cur.channels, [key]: !!e.detail.value };
    this.persist({ ...cur, channels });
  },

  onDndEnabledChange(e: WechatMiniprogram.SwitchChange) {
    if (this.data.formDisabled) return;
    const cur = loadLocalSettings();
    this.persist({ ...cur, dnd: { ...cur.dnd, enabled: !!e.detail.value } });
  },

  onDndStartChange(e: WechatMiniprogram.PickerChange) {
    if (this.data.formDisabled) return;
    const cur = loadLocalSettings();
    this.persist({ ...cur, dnd: { ...cur.dnd, start: String(e.detail.value) } });
  },

  onDndEndChange(e: WechatMiniprogram.PickerChange) {
    if (this.data.formDisabled) return;
    const cur = loadLocalSettings();
    this.persist({ ...cur, dnd: { ...cur.dnd, end: String(e.detail.value) } });
  },

  onForestChange(e: WechatMiniprogram.PickerChange) {
    if (this.data.formDisabled) return;
    const cur = loadLocalSettings();
    const idx = Number(e.detail.value);
    this.persist({
      ...cur,
      region: { ...cur.region, forestIndex: idx },
    });
  },

  onGridChange(e: WechatMiniprogram.PickerChange) {
    if (this.data.formDisabled) return;
    const cur = loadLocalSettings();
    const idx = Number(e.detail.value);
    this.persist({
      ...cur,
      region: { ...cur.region, gridIndex: idx },
    });
  },

  onRadiusChange(e: WechatMiniprogram.SliderChange) {
    if (this.data.formDisabled) return;
    const cur = loadLocalSettings();
    const km = Math.round(Number(e.detail.value));
    this.persist({
      ...cur,
      region: { ...cur.region, radiusKm: km },
    });
  },

  onTemplateChange(e: WechatMiniprogram.PickerChange) {
    if (this.data.formDisabled) return;
    const idx = Number(e.detail.value);
    const id = TEMPLATE_RANGE[idx]?.id || "default";
    const cur = loadLocalSettings();
    this.setData({ templateIndex: idx });
    this.persist({
      ...cur,
      content: { ...cur.content, templateId: id },
    });
  },

  onVoiceChange(e: WechatMiniprogram.SwitchChange) {
    if (this.data.formDisabled) return;
    const cur = loadLocalSettings();
    this.persist({
      ...cur,
      content: { ...cur.content, voiceBroadcast: !!e.detail.value },
    });
  },

  onPullDownRefresh() {
    this.bootstrap();
    setTimeout(() => wx.stopPullDownRefresh(), 400);
  },
});
