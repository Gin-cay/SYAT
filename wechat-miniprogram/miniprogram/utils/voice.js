// 语音播报工具：把文本转换为音频并播放
// 说明：需要你在后台提供 TTS 接口（返回音频URL），或在 globalData 配置 voice 模式。
//
// 期望接口（示例）：
// POST ttsApiUrl，body: { text: string, lang: 'zh'|'bo' }
// 返回：{ audioUrl: 'https://...' }

function getAppGlobal() {
  const app = getApp();
  return (app && app.globalData) || {};
}

function safeLang(lang) {
  return lang === "bo" ? "bo" : "zh";
}

let _audioCtx = null;

function getAudioCtx() {
  if (_audioCtx) return _audioCtx;
  _audioCtx = wx.createInnerAudioContext();
  _audioCtx.autoplay = false;
  _audioCtx.obeyMuteSwitch = true;
  return _audioCtx;
}

function speak(text, langOverride) {
  const globalData = getAppGlobal();
  const lang = safeLang(langOverride || globalData.lang || "zh");
  const t = String(text || "").trim();
  if (!t) return Promise.resolve(false);

  const ttsApiUrl = globalData.ttsApiUrl || "";
  if (!ttsApiUrl) {
    // 不破坏主流程：没配置就用提示代替
    wx.showToast({
      title: lang === "bo" ? "སྐྱོན：སྒྲ་བརྗོད་མ་སྒྲུབ།" : "语音未配置（ttsApiUrl为空）",
      icon: "none",
    });
    return Promise.resolve(false);
  }

  const audioCtx = getAudioCtx();

  // 停止上一段
  try {
    audioCtx.stop();
  } catch (e) {}

  return new Promise((resolve) => {
    wx.request({
      url: ttsApiUrl,
      method: "POST",
      data: { text: t, lang },
      header: { "content-type": "application/json" },
      timeout: 12000,
      success: (res) => {
        const audioUrl = (res && res.data && res.data.audioUrl) || "";
        if (!audioUrl) return resolve(false);

        let ended = false;
        const done = (ok) => {
          if (ended) return;
          ended = true;
          try {
            // 避免重复绑定
            audioCtx.onEnded(() => {});
          } catch (e) {}
          resolve(!!ok);
        };

        audioCtx.onEnded(() => done(true));
        audioCtx.onError(() => done(false));
        audioCtx.src = audioUrl;
        audioCtx.play().catch(() => done(false));
      },
      fail: () => resolve(false),
    });
  });
}

module.exports = { speak };

