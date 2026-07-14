var data = require('../../utils/data');
var teaData = require('../../utils/teaData');

Page({
  data: {
    historyList: []
  },

  onShow: function () {
    this._loadHistory();
  },

  _loadHistory: function () {
    var appData = data.load();
    var history = appData.history || [];
    var list = [];

    var typeMap = { primary: '主推', alt: '备选', custom: '自选', skip: '' };
    var badgeMap = {
      primary: 'history-badge-primary',
      alt: 'history-badge-alt',
      custom: 'history-badge-custom',
      skip: ''
    };

    // Reverse order (newest first)
    for (var i = history.length - 1; i >= 0; i--) {
      var h = history[i];
      var catName = teaData.CAT_NAMES[h.teaCat] || '';
      if (h.teaCat === 'unknown') catName = '自定义';
      if (h.teaCat === 'none') catName = '';

      list.push({
        dateShort: h.date.slice(5), // MM-DD
        teaName: h.teaName,
        teaBrand: h.teaBrand || '',
        teaCat: h.teaCat || 'green',
        teaCatName: catName,
        isSkip: h.type === 'skip',
        typeName: typeMap[h.type] || '',
        typeBadgeClass: badgeMap[h.type] || ''
      });
    }

    this.setData({ historyList: list });
  }
});
