var data = require('../../utils/data');
var tracker = require('../../utils/tracker');

var QUIZ_QUESTIONS = [
  {
    text: '1. 平时怕冷还是怕热？',
    options: [
      { label: '怕冷', value: -1 },
      { label: '差不多', value: 0 },
      { label: '怕热', value: 1 }
    ]
  },
  {
    text: '2. 喜欢喝热水还是冷饮？',
    options: [
      { label: '热水', value: -1 },
      { label: '都行', value: 0 },
      { label: '冷饮', value: 1 }
    ]
  },
  {
    text: '3. 容易出汗吗？',
    options: [
      { label: '很少出汗', value: -1 },
      { label: '正常', value: 0 },
      { label: '容易出汗', value: 1 }
    ]
  },
  {
    text: '4. 大便情况？',
    options: [
      { label: '偏稀 / 易腹泻', value: -1 },
      { label: '正常', value: 0 },
      { label: '偏干 / 便秘', value: 1 }
    ]
  },
  {
    text: '5. 嘴唇颜色？',
    options: [
      { label: '偏淡 / 偏白', value: -1 },
      { label: '淡红正常', value: 0 },
      { label: '偏红 / 偏深', value: 1 }
    ]
  }
];

var CONSTITUTION_INFO = {
  '偏寒': '适合温性茶（红茶、熟普、足火岩茶），少喝绿茶和新生普',
  '平和': '各类茶都可以，随季节和心情选择',
  '偏热': '适合凉性茶（绿茶、白茶、新生普），少喝红茶和熟普'
};

Page({
  data: {
    // Profile
    gender: '',
    age: '',
    city: '',
    // Quiz
    quizQuestions: QUIZ_QUESTIONS,
    quizAnswers: {},
    constitution: null,
    constitutionText: '',
    constitutionHint: '',
    // AI Config
    apiKey: '',
    endpoint: '',
    parserEnabled: false,
    parserModel: 'deepseek-v4-pro',
    recEnabled: false,
    recModel: 'deepseek-v4-pro',
    // Recommend settings
    avoidDays: 5,
    // Data management
    syncStatus: '未同步',
    syncing: false,
    // Diagnostics
    showDiag: false,
    diagLogs: []
  },

  _appData: null,

  onShow: function () {
    this._loadSettings();
  },

  // Called by app.js after cloud sync completes
  reloadData: function () {
    this._loadSettings();
  },

  _loadSettings: function () {
    var appData = data.load();
    this._appData = appData;
    var p = appData.profile || {};
    var l = appData.llm || {};
    var s = appData.settings || {};

    // Restore quiz state
    var quizAnswers = p.quizAnswers || {};
    var constitution = p.constitution || null;
    var constitutionText = constitution || '';
    var constitutionHint = constitution ? (CONSTITUTION_INFO[constitution] || '') : '';

    this.setData({
      gender: p.gender || '',
      age: p.age || '',
      city: p.city || '',
      quizAnswers: quizAnswers,
      constitution: constitution,
      constitutionText: constitutionText,
      constitutionHint: constitutionHint,
      apiKey: l.apiKey || '',
      endpoint: l.endpoint || '',
      parserEnabled: !!l.parserEnabled,
      parserModel: l.parserModel || 'deepseek-v3',
      recEnabled: !!l.enabled,
      recModel: l.recModel || 'deepseek-v4-pro',
      avoidDays: s.avoidDays || 5,
      syncStatus: this._getSyncStatus()
    });
    this._loadDiagLogs();
  },

  // ==== Quiz handlers ====
  onQuizTap: function (e) {
    var qi = e.currentTarget.dataset.qi;
    var value = parseInt(e.currentTarget.dataset.value);
    var quizAnswers = this.data.quizAnswers;
    quizAnswers[qi] = value;
    this.setData({ quizAnswers: quizAnswers });
    this._calculateConstitution(quizAnswers);
  },

  _calculateConstitution: function (quizAnswers) {
    // Check if all 5 questions are answered
    var keys = Object.keys(quizAnswers);
    if (keys.length < 5) return;

    var sum = 0;
    for (var i = 0; i < 5; i++) {
      if (quizAnswers[i] === undefined || quizAnswers[i] === null) return;
      sum += quizAnswers[i];
    }

    var constitution;
    if (sum <= -2) constitution = '偏寒';
    else if (sum >= 2) constitution = '偏热';
    else constitution = '平和';

    // 仅即时反馈，不写入存储；点击「保存」按钮时由 _saveQuiz 持久化
    this.setData({
      constitution: constitution,
      constitutionText: constitution,
      constitutionHint: CONSTITUTION_INFO[constitution] || ''
    });
  },

  onQuizReset: function () {
    // 仅清空页面状态，点击「保存」后才会持久化
    this.setData({
      quizAnswers: {},
      constitution: null,
      constitutionText: '',
      constitutionHint: ''
    });
  },

  _saveQuiz: function () {
    var appData = this._appData || data.load();
    appData.profile.quizAnswers = this.data.quizAnswers;
    appData.profile.constitution = this.data.constitution;
    data.save(appData);
    this._appData = appData;
  },

  _getSyncStatus: function () {
    var t = data.getLastSyncTime();
    if (t) {
      var d = new Date(t);
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
  },

  onAgeInput: function (e) {
    this.setData({ age: e.detail.value });
  },

  onCityInput: function (e) {
    this.setData({ city: e.detail.value });
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
  },

  onParserModelInput: function (e) {
    this.setData({ parserModel: e.detail.value });
  },

  onRecToggle: function (e) {
    this.setData({ recEnabled: e.detail.value });
  },

  onRecModelInput: function (e) {
    this.setData({ recModel: e.detail.value });
  },

  // ==== Explicit save handlers（点击各区块「保存」按钮才写入）====
  onSaveProfile: function () {
    this._saveProfile();
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  onSaveQuiz: function () {
    this._saveQuiz();
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  onSaveLLM: function () {
    this._saveLLM();
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  onSaveRecommend: function () {
    this._saveRecommendSettings();
    wx.showToast({ title: '已保存', icon: 'success' });
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
        // sync() already calls save() internally; no need to save again
        self._loadSettings();
        self.setData({
          syncing: false,
          syncStatus: self._getSyncStatus()
        });
        wx.showToast({ title: '同步完成', icon: 'success' });
      })
      .catch(function (err) {
        console.warn('[settings] sync failed:', err);
        self.setData({
          syncing: false,
          syncStatus: self._getSyncStatus()
        });
        wx.showToast({
          title: '同步失败：' + (err && err.message || '网络错误'),
          icon: 'none',
          duration: 3000
        });
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
  },

  // ==== 运行诊断 ====
  onToggleDiag: function () {
    this.setData({ showDiag: !this.data.showDiag });
    if (this.data.showDiag) this._loadDiagLogs();
  },

  onRefreshDiag: function () {
    this._loadDiagLogs();
    wx.showToast({ title: '已刷新', icon: 'success', duration: 1200 });
  },

  onClearDiag: function () {
    tracker.clear();
    this._loadDiagLogs();
    wx.showToast({ title: '日志已清空', icon: 'success', duration: 1200 });
  },

  _loadDiagLogs: function () {
    var raw = tracker.getLogs().slice(0, 30);
    var rows = raw.map(function (l, i) {
      var d = l.d || {};
      var dt = new Date(l.t);
      var parts = [];
      var keys = Object.keys(d);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (key === 'ms' || key === 'ok') continue;
        var v = d[key];
        if (v === '' || v === null || v === undefined) continue;
        v = String(v);
        if (v.length > 48) v = v.substring(0, 48) + '…';
        parts.push(key + ': ' + v);
      }
      return {
        id: l.t + '_' + i,
        time: (dt.getMonth() + 1) + '/' + dt.getDate() + ' ' +
          ('0' + dt.getHours()).slice(-2) + ':' +
          ('0' + dt.getMinutes()).slice(-2) + ':' +
          ('0' + dt.getSeconds()).slice(-2),
        event: l.e,
        ok: d.ok,
        ms: (typeof d.ms === 'number') ? d.ms : '',
        detail: parts.join(' · ')
      };
    });
    this.setData({ diagLogs: rows });
  }
});
