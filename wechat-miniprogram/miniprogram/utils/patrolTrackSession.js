const KEY = "patrol_track_s0";

function read() {
  try {
    return wx.getStorageSync(KEY) || null;
  } catch (e) {
    return null;
  }
}

function write(startAt) {
  if (startAt == null) {
    try {
      wx.removeStorageSync(KEY);
    } catch (e) {}
    return;
  }
  wx.setStorageSync(KEY, { startAt });
}

module.exports = { read, write };
