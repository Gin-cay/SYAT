const { getPatrolRecords } = require("../../utils/patrolStorage");
const { flushPatrolUpload } = require("../../utils/patrolSync");
const { fetchAllPatrolRecords } = require("../../utils/patrolService");

Page({
  data: {
    list: [],
  },

  loadList() {
    const raw = getPatrolRecords();
    const list = raw.map((r) => {
      let patrolLine = "";
      if (r.patrolStartText && r.patrolEndText) {
        patrolLine = `巡护 ${r.patrolStartText} — ${r.patrolEndText}`;
        if (r.patrolDurationMin != null) patrolLine += `（约${r.patrolDurationMin}分钟）`;
      }
      return {
        ...r,
        statusText: r.status === "hazard" ? "发现隐患" : "正常",
        statusClass: r.status === "hazard" ? "tag-warn" : "tag-ok",
        patrolLine,
        syncBadge: r.synced ? "已同步" : "待同步",
        syncMuted: !!r.synced,
      };
    });
    this.setData({ list });
  },

  onShow() {
    fetchAllPatrolRecords()
      .then(() => {
        this.loadList();
        flushPatrolUpload();
      })
      .catch(() => {
        this.loadList();
        flushPatrolUpload();
      });
  },

  onUnload() {
    if (this._audio) {
      try {
        this._audio.destroy();
      } catch (e) {}
      this._audio = null;
    }
  },

  playVoice(e) {
    const path = e.currentTarget.dataset.path;
    if (!path) return;
    if (!this._audio) {
      this._audio = wx.createInnerAudioContext();
      this._audio.onError(() => wx.showToast({ title: "无法播放", icon: "none" }));
    }
    try {
      this._audio.stop();
    } catch (e) {}
    this._audio.src = path;
    this._audio.play();
  },

  onTapRecord(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find((x) => x.id === id);
    if (!item) return;
    let content = `地点：${item.place}\n人员：${item.inspector}\n打卡：${item.time}`;
    if (item.patrolLine) content += `\n${item.patrolLine}`;
    if (item.highFireRiskAltitude) content += `\n高海拔高火险提示：已标注`;
    if (item.status === "hazard") {
      if (item.hazardDesc) content += `\n隐患文字：${item.hazardDesc}`;
      if (item.voicePath) content += `\n隐患语音：约 ${item.voiceDurationSec || 0} 秒`;
      if (!item.hazardDesc && !item.voicePath) content += `\n隐患：未填写`;
    } else {
      content += `\n情况：正常`;
    }
    content += `\n同步：${item.synced ? "已上传" : "离线缓存，联网后自动批量上传"}`;
    wx.showModal({
      title: "巡查记录",
      content,
      showCancel: false,
    });
  },

  goPatrol() {
    wx.navigateTo({ url: "/pages/checkin/checkin" });
  },
});
