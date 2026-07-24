var data = require('../../utils/data');
var teaData = require('../../utils/teaData');

var NATURE_CLS = { '寒': 'han', '凉': 'liang', '平': 'ping', '温': 'wen', '热': 're' };
var NATURE_LIST = ['寒', '凉', '平', '温', '热'];
var CAFFEINE_LIST = ['高', '中', '低'];

// 茶类选项（picker 用）
var CAT_KEYS = Object.keys(teaData.CAT_NAMES);
var CAT_LABELS = CAT_KEYS.map(function (k) { return teaData.CAT_NAMES[k]; });

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
    flatTeas: [],          // 编辑模式扁平列表
    totalCount: 0,
    disabledCount: 0,
    editMode: false,
    // 表单弹层
    showForm: false,
    formType: 'add',       // 'add' | 'edit'
    formTitle: '添加茶叶',
    form: {
      id: null,
      name: '', brand: '', cat: 'green',
      year: '', nature: '寒', caffeine: '中', note: ''
    },
    catOptionNames: CAT_LABELS,
    catIndex: 0,
    natureIndex: 0,
    caffeineIndex: 1,
    natureOptionNames: NATURE_LIST,
    caffeineOptionNames: CAFFEINE_LIST
  },

  _allTeas: [],
  _appData: null,

  onLoad: function () {
    var list = FILTER_LIST.map(function (f) {
      return { key: f.key, label: f.label, active: f.key === 'all' };
    });
    this.setData({ filterList: list });
  },

  onShow: function () {
    this._loadLibrary();
  },

  // Called by app.js after cloud sync completes
  reloadData: function () {
    this._loadLibrary();
  },

  _loadLibrary: function () {
    var appData = data.load();
    this._appData = appData;
    this._allTeas = appData.teaLibrary || teaData.TEAS;
    this._applyFilter(this.data.activeFilter);
    if (this.data.editMode) this._buildFlatList();
  },

  // ==== Filter ====
  onFilterTap: function (e) {
    var key = e.currentTarget.dataset.key;
    this.setData({ activeFilter: key });
    var list = this.data.filterList.map(function (f) {
      return { key: f.key, label: f.label, active: f.key === key };
    });
    this.setData({ filterList: list });
    this._applyFilter(key);
  },

  _applyFilter: function (filterKey) {
    var cats = FILTER_MAP[filterKey];
    var teas = this._allTeas;

    // 统计停用数量（全量）
    var disabledCount = 0;
    for (var d = 0; d < teas.length; d++) {
      if (teas[d].disabled) disabledCount++;
    }

    var filtered;
    if (cats === null) {
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
          caffeine: t.caffeine, year: t.year, note: t.note || '',
          disabled: !!t.disabled
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
      totalCount: filtered.length,
      disabledCount: disabledCount
    });
  },

  // ==== Edit Mode ====
  onToggleEdit: function () {
    var editMode = !this.data.editMode;
    this.setData({ editMode: editMode });
    if (editMode) this._buildFlatList();
  },

  _buildFlatList: function () {
    var teas = this._allTeas;
    var flat = teas.map(function (t) {
      return {
        id: t.id, name: t.name, brand: t.brand, cat: t.cat,
        catName: teaData.CAT_NAMES[t.cat] || t.cat,
        nature: t.nature, natureCls: NATURE_CLS[t.nature] || 'ping',
        caffeine: t.caffeine, year: t.year, note: t.note || '',
        disabled: !!t.disabled
      };
    });
    this.setData({ flatTeas: flat });
  },

  // ==== Add / Edit Form ====
  onAddTea: function () {
    var cat = 'green';
    var def = teaData.CAT_DEFAULTS[cat];
    var form = {
      id: null, name: '', brand: '', cat: cat,
      year: '', nature: def.baseNature, caffeine: def.caffeine, note: ''
    };
    this.setData({
      showForm: true, formType: 'add', formTitle: '添加茶叶', form: form,
      catIndex: this._catIndex(cat),
      natureIndex: NATURE_LIST.indexOf(form.nature),
      caffeineIndex: CAFFEINE_LIST.indexOf(form.caffeine)
    });
  },

  onEditTea: function (e) {
    var id = e.currentTarget.dataset.id;
    var tea = this._findTea(id);
    if (!tea) return;
    var form = {
      id: tea.id, name: tea.name, brand: tea.brand || '', cat: tea.cat,
      year: tea.year ? String(tea.year) : '',
      nature: tea.nature || tea.baseNature, caffeine: tea.caffeine, note: tea.note || ''
    };
    this.setData({
      showForm: true, formType: 'edit', formTitle: '编辑茶叶', form: form,
      catIndex: this._catIndex(tea.cat),
      natureIndex: NATURE_LIST.indexOf(form.nature),
      caffeineIndex: CAFFEINE_LIST.indexOf(form.caffeine)
    });
  },

  onNameInput: function (e) { this.setData({ 'form.name': e.detail.value }); },
  onBrandInput: function (e) { this.setData({ 'form.brand': e.detail.value }); },
  onYearInput: function (e) { this.setData({ 'form.year': e.detail.value }); },
  onNoteInput: function (e) { this.setData({ 'form.note': e.detail.value }); },

  onCatChange: function (e) {
    var idx = parseInt(e.detail.value);
    var cat = CAT_KEYS[idx];
    var def = teaData.CAT_DEFAULTS[cat];
    var year = this.data.form.year ? parseInt(this.data.form.year) : null;
    var nature = teaData.adjustNature(cat, year, def.baseNature);
    this.setData({
      catIndex: idx,
      'form.cat': cat,
      'form.caffeine': def.caffeine,
      'form.nature': nature,
      natureIndex: NATURE_LIST.indexOf(nature),
      caffeineIndex: CAFFEINE_LIST.indexOf(def.caffeine)
    });
  },

  onNatureChange: function (e) {
    var idx = parseInt(e.detail.value);
    this.setData({ natureIndex: idx, 'form.nature': NATURE_LIST[idx] });
  },

  onCaffeineChange: function (e) {
    var idx = parseInt(e.detail.value);
    this.setData({ caffeineIndex: idx, 'form.caffeine': CAFFEINE_LIST[idx] });
  },

  onYearBlur: function () {
    var cat = this.data.form.cat;
    var year = this.data.form.year ? parseInt(this.data.form.year) : null;
    var base = teaData.CAT_DEFAULTS[cat].baseNature;
    var nature = teaData.adjustNature(cat, year, base);
    this.setData({ 'form.nature': nature, natureIndex: NATURE_LIST.indexOf(nature) });
  },

  onFormCancel: function () {
    this.setData({ showForm: false });
  },

  // 阻止表单弹层内部点击冒泡到遮罩（避免点表单误触关闭）
  onStopPropagation: function () {},

  onFormSave: function () {
    var f = this.data.form;
    var name = (f.name || '').trim();
    if (!name) { wx.showToast({ title: '请输入茶名', icon: 'none' }); return; }

    var cat = f.cat;
    var def = teaData.CAT_DEFAULTS[cat];
    var year = f.year ? parseInt(f.year) : null;
    if (year && (year < 1900 || year > 2100)) {
      wx.showToast({ title: '年份不合法', icon: 'none' });
      return;
    }

    var appData = this._appData || data.load();
    var lib = appData.teaLibrary || [];

    var teaObj = {
      name: name,
      brand: (f.brand || '').trim(),
      cat: cat,
      year: year,
      baseNature: def.baseNature,
      nature: f.nature,
      caffeine: f.caffeine,
      seasons: def.seasons.slice(),
      avoidSeasons: def.avoidSeasons ? def.avoidSeasons.slice() : [],
      note: (f.note || '').trim()
    };

    if (this.data.formType === 'add') {
      teaObj.id = this._nextTeaId(lib);
      teaObj.disabled = false;
      lib.push(teaObj);
    } else {
      teaObj.id = f.id;
      var existing = this._findTeaIn(f.id, lib);
      teaObj.disabled = existing ? !!existing.disabled : false;
      for (var i = 0; i < lib.length; i++) {
        if (lib[i].id === f.id) { lib[i] = teaObj; break; }
      }
    }

    appData.teaLibrary = lib;
    appData.teaLibraryUpdatedAt = Date.now();
    data.save(appData);
    this._appData = appData;
    this._allTeas = lib;

    var isAdd = this.data.formType === 'add';
    this.setData({ showForm: false });
    this._applyFilter(this.data.activeFilter);
    if (this.data.editMode) this._buildFlatList();
    wx.showToast({ title: isAdd ? '已添加' : '已保存', icon: 'success' });
  },

  // ==== Disable / Delete / Sort ====
  onToggleDisable: function (e) {
    var id = e.currentTarget.dataset.id;
    var appData = this._appData || data.load();
    var lib = appData.teaLibrary || [];
    for (var i = 0; i < lib.length; i++) {
      if (lib[i].id === id) { lib[i].disabled = !lib[i].disabled; break; }
    }
    appData.teaLibrary = lib;
    appData.teaLibraryUpdatedAt = Date.now();
    data.save(appData);
    this._appData = appData;
    this._allTeas = lib;
    this._applyFilter(this.data.activeFilter);
    if (this.data.editMode) this._buildFlatList();
  },

  onDeleteTea: function (e) {
    var self = this;
    var id = e.currentTarget.dataset.id;
    var appData = this._appData || data.load();
    var lib = appData.teaLibrary || [];
    var tea = this._findTeaIn(id, lib);
    if (!tea) return;

    var hasHistory = (appData.history || []).some(function (h) { return h.teaId === id; });

    var doDelete = function () {
      var newLib = lib.filter(function (t) { return t.id !== id; });
      appData.teaLibrary = newLib;
      appData.teaLibraryUpdatedAt = Date.now();
      data.save(appData);
      self._appData = appData;
      self._allTeas = newLib;
      self._applyFilter(self.data.activeFilter);
      if (self.data.editMode) self._buildFlatList();
      wx.showToast({ title: '已删除', icon: 'success' });
    };

    if (hasHistory) {
      wx.showModal({
        title: '该茶有饮用记录',
        content: '删除后历史记录将无法关联到该茶，建议改为"停用"。确定仍要删除？',
        confirmText: '仍要删除',
        confirmColor: '#C25B45',
        success: function (res) { if (res.confirm) doDelete(); }
      });
    } else {
      wx.showModal({
        title: '删除茶叶',
        content: '确定删除「' + tea.name + '」吗？',
        confirmColor: '#C25B45',
        success: function (res) { if (res.confirm) doDelete(); }
      });
    }
  },

  onMoveUp: function (e) { this._move(e.currentTarget.dataset.id, -1); },
  onMoveDown: function (e) { this._move(e.currentTarget.dataset.id, 1); },

  _move: function (id, dir) {
    var appData = this._appData || data.load();
    var lib = appData.teaLibrary || [];
    var idx = -1;
    for (var i = 0; i < lib.length; i++) {
      if (lib[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return;
    var target = idx + dir;
    if (target < 0 || target >= lib.length) return;
    var tmp = lib[idx];
    lib[idx] = lib[target];
    lib[target] = tmp;
    appData.teaLibrary = lib;
    appData.teaLibraryUpdatedAt = Date.now();
    data.save(appData);
    this._appData = appData;
    this._allTeas = lib;
    this._buildFlatList();
  },

  // ==== Helpers ====
  _findTea: function (id) {
    return this._findTeaIn(id, this._allTeas);
  },

  _findTeaIn: function (id, lib) {
    for (var i = 0; i < lib.length; i++) {
      if (lib[i].id === id) return lib[i];
    }
    return null;
  },

  _nextTeaId: function (lib) {
    var max = -1;
    for (var i = 0; i < lib.length; i++) {
      if (typeof lib[i].id === 'number' && lib[i].id > max) max = lib[i].id;
    }
    return max + 1;
  },

  _catIndex: function (cat) {
    return CAT_KEYS.indexOf(cat);
  }
});
