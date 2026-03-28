// app.js
const { flushPatrolUpload, bindNetworkFlush } = require("./utils/patrolSync");
const lang = require("./utils/lang.js");
const report = require("./utils/report.js");
const fireReport = require("./utils/fireReportSync");

App({
  onLaunch: function () {
    this.globalData = {
      // 微信云开发环境 ID（已接入）
      env: "cloud1-6gy6lm4nbc776f35",
      // 方案B：Python 后端云托管地址（例如 https://xxx.run.tcloudbase.com）
      pythonBackendBaseUrl: "https://flask-vnaf-239145-8-1416119344.sh.run.tcloudbase.com",
      /** 巡查记录批量上报（POST JSON：{ records: PatrolCheckinRecord[] }），留空则仅本地+云库 */
      patrolUploadUrl: "",
      /** 可选：单条打卡 REST（POST JSON 单条记录），与云库可同时配置 */
      patrolSingleSubmitUrl: "",
      /** 可选：GET 历史列表，响应 JSON 含 records 或 data 数组 */
      patrolListUrl: "",
      /** 可选：火情历史上报 GET，响应 JSON 含 records 或 data */
      fireReportListUrl: "",
      /** 火情上报：multipart 语音字段名 voice，其它字段见 report/index 提交 */
      reportUploadUrl: "",
      /** 巡查隐患语音：multipart 字段 voice，formData 含 patrolId、durationSec */
      patrolVoiceUploadUrl: "",

      // 当前语言：zh | bo
      lang: lang.loadLang(),

      // 紧急上报接口（示例占位符：与后端对接时替换）
      emergencyUploadUrl: "",
    };
    // 全局翻译：t('key')
    this.globalData.t = (key) => {
      const L = lang.getStrings(this.globalData.lang || "zh");
      const v = L && L[key];
      return v != null ? v : String(key);
    };
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }
    bindNetworkFlush();
    flushPatrolUpload();
    report.bindNetworkFlush();
    report.flushOfflineReports();
    fireReport.bindNetworkFlush();
    fireReport.flushOfflineReports();

    // 语言切换监听（让各页面实时刷新文字）
    this._langListeners = [];
  },

  onLangChange(cb) {
    if (typeof cb !== "function") return;
    this._langListeners.push(cb);
  },

  setLang(newLang) {
    const v = newLang === "bo" ? "bo" : "zh";
    this.globalData.lang = v;
    lang.saveLang(v);
    (this._langListeners || []).forEach((fn) => {
      try {
        fn(v);
      } catch (e) {}
    });
  },
});
