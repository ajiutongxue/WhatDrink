const data = require('./utils/data.js');

App({
  onLaunch: function () {
    wx.cloud.init({
      env: 'your-env-id',
      traceUser: true
    });

    const appData = data.load();
    this.globalData.appData = appData;

    data.sync().then(function (merged) {
      getApp().globalData.appData = merged;
      getApp().globalData.syncing = false;
    }).catch(function () {
      getApp().globalData.syncing = false;
    });

    this.globalData.syncing = true;
  },

  globalData: {
    appData: null,
    syncing: false
  }
});
