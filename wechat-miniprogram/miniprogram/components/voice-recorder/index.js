function formatDur(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${`${r}`.padStart(2, "0")}`;
}

Component({
  data: {
    recording: false,
    recordTick: 0,
    filePath: "",
    durationSec: 0,
    durationLabel: "",
    playing: false,
  },

  lifetimes: {
    attached() {
      this._startMs = 0;
      this._tickTimer = null;
      const rm = wx.getRecorderManager();
      this._rec = rm;
      rm.onStart(() => {
        this._startMs = Date.now();
        this.setData({ recording: true, recordTick: 0 });
        if (this._tickTimer) clearInterval(this._tickTimer);
        this._tickTimer = setInterval(() => {
          const t = Math.floor((Date.now() - this._startMs) / 1000);
          this.setData({ recordTick: t });
        }, 400);
      });
      rm.onStop((res) => {
        if (this._tickTimer) {
          clearInterval(this._tickTimer);
          this._tickTimer = null;
        }
        const path = (res && res.tempFilePath) || "";
        let dSec = 0;
        if (res && typeof res.duration === "number" && res.duration > 0) {
          dSec = Math.max(1, Math.round(res.duration / 1000));
        } else {
          dSec = Math.max(1, Math.round((Date.now() - this._startMs) / 1000));
        }
        this.setData({
          recording: false,
          recordTick: 0,
          filePath: path,
          durationSec: dSec,
          durationLabel: formatDur(dSec),
          playing: false,
        });
        this.triggerEvent("change", { filePath: path, durationSec: dSec });
      });
      rm.onError(() => {
        if (this._tickTimer) {
          clearInterval(this._tickTimer);
          this._tickTimer = null;
        }
        this.setData({ recording: false, recordTick: 0 });
        wx.showToast({ title: "录音失败，请检查麦克风授权", icon: "none" });
      });

      const audio = wx.createInnerAudioContext();
      this._audio = audio;
      audio.onEnded(() => this.setData({ playing: false }));
      audio.onStop(() => this.setData({ playing: false }));
      audio.onError(() => this.setData({ playing: false }));
    },

    detached() {
      if (this._tickTimer) clearInterval(this._tickTimer);
      try {
        this._rec && this._rec.stop();
      } catch (e) {}
      if (this._audio) {
        try {
          this._audio.stop();
        } catch (e) {}
        this._audio.destroy();
        this._audio = null;
      }
    },
  },

  methods: {
    toggleRecord() {
      if (this.data.recording) {
        this._rec.stop();
        return;
      }
      if (this.data.playing && this._audio) {
        this._audio.stop();
        this.setData({ playing: false });
      }
      this.setData({ filePath: "", durationSec: 0, durationLabel: "" });
      this.triggerEvent("change", { filePath: "", durationSec: 0 });
      this._rec.start({
        duration: 120000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 64000,
        format: "aac",
      });
    },

    togglePlay() {
      const p = this.data.filePath;
      if (!p || !this._audio) return;
      if (this.data.playing) {
        this._audio.stop();
        this.setData({ playing: false });
        return;
      }
      this._audio.src = p;
      this._audio.play();
      this.setData({ playing: true });
    },

    reRecord() {
      if (this._audio) {
        try {
          this._audio.stop();
        } catch (e) {}
      }
      this.setData({
        filePath: "",
        durationSec: 0,
        durationLabel: "",
        playing: false,
      });
      this.triggerEvent("change", { filePath: "", durationSec: 0 });
    },
  },
});
