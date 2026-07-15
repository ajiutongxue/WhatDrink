var data = require('../../utils/data');
var teaData = require('../../utils/teaData');

Page({
  data: {
    historyList: [],
    editingIdx: -1,   // currently editing history index (-1 = none)
    editingText: ''
  },

  _appData: null,

  onShow: function () {
    this._loadHistory();
  },

  // Called by app.js after cloud sync completes
  reloadData: function () {
    this._loadHistory();
  },

  _loadHistory: function () {
    var appData = data.load();
    this._appData = appData;
    var history = appData.history || [];
    var list = [];

    var typeMap = { primary: '主推', alt: '备选', custom: '自选', skip: '' };
    var badgeMap = {
      primary: 'history-badge-primary',
      alt: 'history-badge-alt',
      custom: 'history-badge-custom',
      skip: ''
    };

    // Reverse order (newest first), track original index for editing
    for (var i = history.length - 1; i >= 0; i--) {
      var h = history[i];
      var catName = teaData.CAT_NAMES[h.teaCat] || '';
      if (h.teaCat === 'unknown') catName = '自定义';
      if (h.teaCat === 'none') catName = '';

      list.push({
        idx: i,  // original index in history array
        dateShort: h.date.slice(5),
        teaName: h.teaName,
        teaBrand: h.teaBrand || '',
        teaCat: h.teaCat || 'green',
        teaCatName: catName,
        isSkip: h.type === 'skip',
        typeName: typeMap[h.type] || '',
        typeBadgeClass: badgeMap[h.type] || '',
        hasNotes: !!(h.tastingNotes && h.tastingNotes.length > 0),
        tastingNotes: h.tastingNotes || ''
      });
    }

    this.setData({ historyList: list, editingIdx: -1, editingText: '' });
  },

  // ==== Tasting Notes ====
  onToggleNotes: function (e) {
    var idx = parseInt(e.currentTarget.dataset.idx);
    if (this.data.editingIdx === idx) {
      // Close editing
      this.setData({ editingIdx: -1, editingText: '' });
    } else {
      // Open editing for this entry
      var history = (this._appData && this._appData.history) || [];
      var existing = (history[idx] && history[idx].tastingNotes) || '';
      this.setData({ editingIdx: idx, editingText: existing });
    }
  },

  onNotesInput: function (e) {
    this.setData({ editingText: e.detail.value });
  },

  onSaveNotes: function () {
    var text = (this.data.editingText || '').trim();
    var idx = this.data.editingIdx;
    if (idx < 0) return;

    var appData = this._appData || data.load();
    if (idx < appData.history.length) {
      appData.history[idx].tastingNotes = text;
      data.save(appData);
      this._appData = appData;
    }

    this._loadHistory();
    wx.showToast({ title: text ? '已保存' : '已清空', icon: 'success', duration: 1200 });
  }
});
