var data = require('../../utils/data');

Page({
  data: {
    // Profile
    gender: '',
    age: '',
    city: '',
    // AI Config
    apiKey: '',
    endpoint: '',
    parserEnabled: false,
    parserModel: 'deepseek-v3',
    recEnabled: false,
    recModel: 'deepseek-v4-pro',
    // Recommend settings
    avoidDays: 5,
    // Data management
    syncStatus: '未同步',
    syncing: false
  },

  _appData: null,

  onShow: function () {
    this._loadSettings();
  },

  _loadSettings: function () {
    var appData = data.load();
    this._appData = appData;
    var p = appData.profile || {};
    var l = appData.llm || {};
    var s = appData.settings || {};

    this.setData({
      gender: p.gender || '',
      age: p.age || '',
      city: p.city || '',
      apiKey: l.apiKey || '',
      endpoint: l.endpoint || '',
      parserEnabled: !!l.parserEnabled,
      parserModel: l.parserModel || 'deepseek-v3',
      recEnabled: !!l.enabled,
      recModel: l.recModel || 'deepseek-v4-pro',
      avoidDays: s.avoidDays || 5,
      syncStatus: this._getSyncStatus(appData)
    });
  },

  _getSyncStatus: function (appData) {
    if (appData._lastSyncTime) {
      var d = new Date(appData._lastSyncTime);
      var m = d.getMonth() + 1, day = d.getDate();
      var h = d.getHours(), min = d.getMinutes();
      return '上次同步：' + m + '/' + day + ' ' +
        (h < 10 ? '0' + h : h) + ':' + (min < 10 ? '0' + min : min);
    }
    return '未同步';
  },

  // ==== Profile handlers ====
  onGenderTap: function (e) {
    var val = e.currentTarget.dataset.value;
    this.setData({ gender: val });
    this._saveProfile();
  },

  onAgeInput: function (e) {
    this.setData({ age: e.detail.value });
  },

  onCityInput: function (e) {
    this.setData({ city: e.detail.value });
  },

  onCityBlur: function () {
    this._saveProfile();
  },

  _saveProfile: function () {
    var appData = this._appData || data.load();
    appData.profile.gender = this.data.gender;
    appData.profile.age = this.data.age;
    appData.profile.city = this.data.city;
    data.save(appData);
    this._appData = appData;
  },

  // ==== AI Config handlers ====
  onApiKeyInput: function (e) {
    this.setData({ apiKey: e.detail.value });
  },

  onEndpointInput: function (e) {
    this.setData({ endpoint: e.detail.value });
  },

  onParserToggle: function (e) {
    this.setData({ parserEnabled: e.detail.value });
    this._saveLLM();
  },

  onParserModelInput: function (e) {
    this.setData({ parserModel: e.detail.value });
  },

  onRecToggle: function (e) {
    this.setData({ recEnabled: e.detail.value });
    this._saveLLM();
  },

  onRecModelInput: function (e) {
    this.setData({ recModel: e.detail.value });
  },

  onSettingsSave: function () {
    this._saveLLM();
    this._saveRecommendSettings();
  },

  _saveLLM: function () {
    var appData = this._appData || data.load();
    appData.llm = {
      apiKey: this.data.apiKey,
      endpoint: this.data.endpoint,
      parserEnabled: this.data.parserEnabled,
      parserModel: this.data.parserModel,
      enabled: this.data.recEnabled,
      recModel: this.data.recModel
    };
    data.save(appData);
    this._appData = appData;
  },

  // ==== Recommend settings ====
  onAvoidDaysInput: function (e) {
    this.setData({ avoidDays: parseInt(e.detail.value) || 5 });
  },

  _saveRecommendSettings: function () {
    var appData = this._appData || data.load();
    appData.settings.avoidDays = this.data.avoidDays;
    data.save(appData);
    this._appData = appData;
  },

  // ==== Data management ====
  onSyncNow: function () {
    var self = this;
    self.setData({ syncing: true, syncStatus: '同步中...' });
    data.sync()
      .then(function (mergedData) {
        self._appData = mergedData;
        data.save(mergedData);
        self.setData({
          syncing: false,
          syncStatus: self._getSyncStatus(mergedData)
        });
        wx.showToast({ title: '同步完成', icon: 'success' });
      })
      .catch(function (err) {
        self.setData({ syncing: false, syncStatus: '同步失败' });
        wx.showToast({ title: '同步失败：' + (err.message || '网络错误'), icon: 'none', duration: 3000 });
      });
  },

  onExport: function () {
    var json = data.exportJSON();
    // Use wx.setClipboardData as a simple export mechanism
    // For a real file export, we'd use wx.getFileSystemManager
    wx.setClipboardData({
      data: json,
      success: function () {
        wx.showModal({
          title: '数据已复制到剪贴板',
          content: '你可以粘贴到备忘录或文件中保存。',
          showCancel: false
        });
      }
    });
  },

  onImport: function () {
    var self = this;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: function (res) {
        var filePath = res.tempFiles[0].path;
        var fs = wx.getFileSystemManager();
        try {
          var content = fs.readFileSync(filePath, 'utf-8');
          var success = data.importJSON(content);
          if (success) {
            self._loadSettings();
            wx.showToast({ title: '导入成功', icon: 'success' });
          } else {
            wx.showToast({ title: '导入失败：格式不正确', icon: 'none', duration: 3000 });
          }
        } catch (e) {
          wx.showToast({ title: '读取文件失败', icon: 'none', duration: 3000 });
        }
      }
    });
  },

  onReset: function () {
    var self = this;
    wx.showModal({
      title: '重置所有数据',
      content: '确定要清除所有个人档案、饮茶记录和设置吗？此操作不可恢复。',
      confirmColor: '#C25B45',
      success: function (res) {
        if (res.confirm) {
          data.reset();
          self._loadSettings();
          wx.showToast({ title: '已重置', icon: 'success' });
        }
      }
    });
  }
});
