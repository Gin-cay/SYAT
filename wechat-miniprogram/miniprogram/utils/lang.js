const LANG_STORAGE_KEY = "lang_v1";

// lang: zh | bo
const JOB_OPTIONS_KEY = ["patrol", "admin", "leader", "other"];

const STRINGS = {
  zh: {
    langName: "汉语",
    switchLabel: "藏语",

    // 顶部/按钮
    save: "保存",
    cancel: "取消",
    logout: "退出登录",
    editProfile: "编辑资料",
    changeAvatar: "更换头像",
    resetCancel: "重置/取消",
    getCodeModify: "获取验证码并修改",
    resendCode: "重新获取",

    // 字段
    phone: "手机号",
    job: "职务",

    // 职务（picker显示）
    jobOptions: ["巡查员", "管理员", "值班领导", "其他"],

    // 常用菜单
    menuPatrol: "我的巡查记录",
    menuReport: "我上报的火情",
    menuWarningSetting: "预警消息设置",
    menuHelp: "帮助与反馈",
    menuAbout: "关于我们",

    // 预警页
    warningTitle: "森林防火预警",
    filterLevel: "火险等级",
    filterTime: "时间范围",
    allTime: "全部时间",
    emptyWarning: "暂无符合条件的预警信息",
    viewDetail: "查看详情 >",
    quickReport: "一键上报",

    // 风险标签
    riskLow: "低",
    riskMedium: "中",
    riskHigh: "高",
    riskCritical: "极高",

    // 处理状态
    statusPending: "待处理",
    statusProcessing: "处理中",
    statusDone: "已处置",

    // 详情页操作
    accept: "接警",
    arrive: "到场处置",
    finish: "完成处置",
    warningDetail: "预警详情",
    photos: "现场图片",
    records: "处理记录",
    labelTime: "预警时间",
    labelPlace: "预警地点",
    labelStatus: "处理状态",
    operatorPrefix: "执行人：",

    // 巡查（打卡页/示例）
    normal: "正常",
    hazard: "发现隐患",
    highRiskTip: "已进入高火险区域，请加强盯防。"
  },

  bo: {
    langName: "བོད་ཡིག",
    switchLabel: "汉语",

    save: "སྲུང་ཚགས",
    cancel: "ཕྱིར་འཐེན",
    logout: "ལོག་འཛུལ་ཕྱིར་འཐེན",
    editProfile: "དོ་དམ་བྱེད་སྣང་",
    changeAvatar: "མིང་རྟགས་བརྗེ་བ",
    resetCancel: "སྟོང་སེལ/ཕྱིར་འཐེན",
    getCodeModify: "བརྡ་སྐུལ་ལེན་ནས་བསྒྱུར",
    resendCode: "ཡང་བསྐུལ",

    phone: "ཁ་པར་ཨང",
    job: "ལས་གནས",

    // 职务（picker显示）
    jobOptions: ["ལྟ་སྐྱོང་མི", "སྐྱོང་འཛིན་པ", "ཡུལ་སྐྱོང་སྤྱི", "གཞན"],

    menuPatrol: "ངའི་ལྟ་སྐྱོང་དྲན་ཐོ",
    menuReport: "ངས་སྤེལ་བའི་མེ་གནས",
    menuWarningSetting: "ཉེན་བརྡའི་སྒྲིག་ཆ",
    menuHelp: "རོགས་རམ་དང་མតོན་",
    menuAbout: "ང་ཚོའི་སྐོར",

    warningTitle: "བུ་མེའི་ཉེན་བརྡ།",
    filterLevel: "མེའི་ཉེན་གྲངས",
    filterTime: "དུས་ཡུན",
    allTime: "དུས་ཡུན་ཐམས་ཅད",
    emptyWarning: "དེ་དང་མཐུན་པའི་ཉེན་བརྡ་མེད།",
    viewDetail: "ཞིབ་འཇུག >",
    quickReport: "མྱུར་སྤེལ",

    riskLow: "དམའ",
    riskMedium: "བར་མ",
    riskHigh: "མཐོ",
    riskCritical: "ཧ་ཅང་མཐོ",

    statusPending: "ད་ལྟ་འཆར་སྒྲིག",
    statusProcessing: "བསྐྱོད་བཞིན",
    statusDone: "འགྲུབ་ཟིན",

    accept: "ཉེན་བརྡ་ལེན",
    arrive: "ས་གནས་བསྐྱོད་ནས་བཅོས",
    finish: "མཇུག་གྲུབ",
    warningDetail: "ཉེན་བརྡ་ཞིབ་འཇུག",
    photos: "ནང་སྐྱོན་དང་པར",
    records: "བྱ་སྤྱོད་དྲན་ཐོ",
    labelTime: "ཉེན་བརྡའི་དུས",
    labelPlace: "ཉེན་བརྡ་ས་གནས",
    labelStatus: "ལས་འགན",
    operatorPrefix: "འགྲུབ་མཁན་：",

    normal: "སྤྲོད་ལེགས",
    hazard: "གནོད་ཅན་མཇལ",
    highRiskTip: "ཧ་ཅང་མཐོའི་ཉེན་གྲངས་ཡོད་པས་སྣང་བརྟན་བྱེད།"
  }
};

function loadLang() {
  try {
    const v = wx.getStorageSync(LANG_STORAGE_KEY);
    return v === "bo" ? "bo" : "zh";
  } catch (e) {
    return "zh";
  }
}

function saveLang(lang) {
  try {
    wx.setStorageSync(LANG_STORAGE_KEY, lang === "bo" ? "bo" : "zh");
  } catch (e) {}
}

function getStrings(lang) {
  const l = lang === "bo" ? "bo" : "zh";
  return STRINGS[l] || STRINGS.zh;
}

function getJobIndexFromStoredRole(roleCN) {
  const map = {
    "巡查员": 0,
    "管理员": 1,
    "值班领导": 2,
    "其他": 3
  };
  return map[roleCN] != null ? map[roleCN] : 0;
}

function getJobLabelByRoleCN(roleCN, lang) {
  const s = getStrings(lang);
  const i = getJobIndexFromStoredRole(roleCN);
  return s.jobOptions[i] || s.jobOptions[0];
}

module.exports = {
  LANG_STORAGE_KEY,
  loadLang,
  saveLang,
  getStrings,
  getJobIndexFromStoredRole,
  getJobLabelByRoleCN,
  JOB_OPTIONS_KEY,
};

