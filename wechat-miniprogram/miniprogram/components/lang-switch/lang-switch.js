const lang = require("../../utils/lang.js");

Component({
  properties: {},

  data: {
    currentLang: "zh",
    switchLabel: lang.getStrings("zh").switchLabel,
  },

  lifetimes: {
    attached() {
      const app = getApp();
      const update = (l) => {
        this.setData({
          currentLang: l,
          switchLabel: lang.getStrings(l).switchLabel,
        });
      };
      update((app.globalData || {}).lang || "zh");

      if (app && typeof app.onLangChange === "function") {
        app.onLangChange(update);
      }
    },
  },

  methods: {
    toggleLang() {
      const app = getApp();
      const next = this.data.currentLang === "bo" ? "zh" : "bo";
      if (app && typeof app.setLang === "function") {
        app.setLang(next);
      }
    },
  },
});

