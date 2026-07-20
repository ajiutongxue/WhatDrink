const data = require('./utils/data.js');
const tracker = require('./utils/tracker.js');

var SYNC_THROTTLE_MS = 30000; // 热启动同步节流，避免频繁切前后台刷爆云函数

App({
  onLaunch: function () {
    wx.cloud.init({
      env: 'cloud1-d4gq8xov400669e42',
      traceUser: true
    });

    const appData = data.load();
    this.globalData.appData = appData;
    this._lastSyncAt = 0;
    this._doSync();
  },

  // 热启动（从后台切回前台）也触发同步，带节流
  // 冷启动时 onShow 也会触发一次，但 _doSync 内部防重入会跳过
  onShow: function () {
    if (this._lastSyncAt && Date.now() - this._lastSyncAt < SYNC_THROTTLE_MS) return;
    this._doSync();
  },

  _doSync: function () {
    if (this.globalData.syncing) return; // 防重入
    var self = this;
    self.globalData.syncing = true;
    data.sync().then(function (merged) {
      self.globalData.appData = merged;
      self.globalData.syncing = false;
      self._lastSyncAt = Date.now();
      self._notifyCurrentPage();
    }).catch(function (err) {
      console.warn('[app] sync failed:', err);
      tracker.track('sync_fail', { err: String(err && err.errMsg || err && err.message || err) });
      self.globalData.syncing = false;
      self._lastSyncAt = Date.now();
    });
  },

  // sync 完成后通知当前页面重新加载数据
  _notifyCurrentPage: function () {
    try {
      var pages = getCurrentPages();
      var current = pages[pages.length - 1];
      if (current && typeof current.reloadData === 'function') {
        current.reloadData();
      }
    } catch (e) {
      // 页面栈未就绪，忽略
    }
  },

  globalData: {
    appData: null,
    syncing: false,
    version: '1.0.2'
  }
});
