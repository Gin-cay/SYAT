function uploadVoiceFile(url, filePath, formData) {
  if (!url || !filePath) return Promise.resolve({ skipped: true });
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url,
      filePath,
      name: "voice",
      formData: formData || {},
      timeout: 120000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res);
        else reject(new Error("http"));
      },
      fail: reject,
    });
  });
}

module.exports = { uploadVoiceFile };
