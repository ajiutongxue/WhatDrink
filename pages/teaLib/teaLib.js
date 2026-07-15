var data = require('../../utils/data');
var teaData = require('../../utils/teaData');

var NATURE_CLS = { '寒': 'han', '凉': 'liang', '平': 'ping', '温': 'wen', '热': 're' };

var FILTER_LIST = [
  { key: 'all', label: '全部' },
  { key: 'green', label: '绿茶' },
  { key: 'black', label: '红茶' },
  { key: 'white', label: '白茶' },
  { key: 'oolong', label: '乌龙' },
  { key: 'puerh_raw', label: '生普' },
  { key: 'puerh_ripe', label: '熟普' },
  { key: 'flavored', label: '调味' }
];

// Map filter key to tea categories
var FILTER_MAP = {
  all: null,
  green: ['green'],
  black: ['black'],
  white: ['white'],
  oolong: ['oolong_tieguanyin', 'oolong_wuyi', 'oolong_dancong'],
  puerh_raw: ['puerh_raw'],
  puerh_ripe: ['puerh_ripe'],
  flavored: ['flavored_jasmine', 'flavored_other']
};

Page({
  data: {
    filterList: [],
    activeFilter: 'all',
    groupedTeas: [],
    totalCount: 0
  },

  _allTeas: [],

  onLoad: function () {
    // Initialize filter list with active state
    var list = FILTER_LIST.map(function (f) {
      return { key: f.key, label: f.label, active: f.key === 'all' };
    });
    this.setData({ filterList: list });
  },

  onShow: function () {
    var appData = data.load();
    this._allTeas = appData.teaLibrary || teaData.TEAS;
    this._applyFilter(this.data.activeFilter);
  },

  // Called by app.js after cloud sync completes
  reloadData: function () {
    var appData = data.load();
    this._allTeas = appData.teaLibrary || teaData.TEAS;
    this._applyFilter(this.data.activeFilter);
  },

  onFilterTap: function (e) {
    var key = e.currentTarget.dataset.key;
    this.setData({ activeFilter: key });
    // Update filter list active states
    var list = this.data.filterList.map(function (f) {
      return { key: f.key, label: f.label, active: f.key === key };
    });
    this.setData({ filterList: list });
    this._applyFilter(key);
  },

  _applyFilter: function (filterKey) {
    var cats = FILTER_MAP[filterKey];
    var teas = this._allTeas;
    var filtered;

    if (cats === null) {
      // "all" — show everything
      filtered = teas;
    } else {
      filtered = teas.filter(function (t) {
        return cats.indexOf(t.cat) >= 0;
      });
    }

    // Group by category
    var groups = {};
    var groupOrder = [];
    for (var i = 0; i < filtered.length; i++) {
      var t = filtered[i];
      if (!groups[t.cat]) {
        groups[t.cat] = [];
        groupOrder.push(t.cat);
      }
      groups[t.cat].push(t);
    }

    var groupedTeas = groupOrder.map(function (cat) {
      var teasWithCls = groups[cat].map(function (t) {
        return {
          id: t.id, name: t.name, brand: t.brand, cat: t.cat,
          nature: t.nature, natureCls: NATURE_CLS[t.nature] || 'ping',
          caffeine: t.caffeine, year: t.year, note: t.note || ''
        };
      });
      return {
        catKey: cat,
        catName: teaData.CAT_NAMES[cat] || cat,
        count: teasWithCls.length,
        teas: teasWithCls
      };
    });

    this.setData({
      groupedTeas: groupedTeas,
      totalCount: filtered.length
    });
  }
});
