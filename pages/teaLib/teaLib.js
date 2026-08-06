var data = require('../../utils/data');
var teaData = require('../../utils/teaData');
var teaKnowledge = require('../../utils/teaKnowledge');


var KNOWLEDGE_SECTION_LABELS = {
  identity: '基本资料', origin: '原料产地', craft: '制作工艺', sensory: '风味画像',
  effects: '个人体感', context: '适饮场景', brew: '冲泡方式'
};
var KNOWLEDGE_FIELD_LABELS = {
  displayName: '规范名称', brand: '品牌', category: '茶类', year: '年份', productCode: '产品码', packagingVariant: '包装版本', form: '成品形态',
  region: '产区', cultivar: '品种', materialGrade: '原料等级', harvestSeason: '采摘季节',
  processTags: '工艺标签', roastLevel: '焙火程度', compression: '紧压程度', agingState: '陈化阶段',
  aromaTags: '香气标签', flavorTags: '滋味标签', aromaIntensity: '香气强度', sweetness: '甜度', bitterness: '苦度', astringency: '涩度', body: '厚度', smoothness: '顺滑度', aftertaste: '回甘余韵', durability: '耐泡度',
  stimulation: '提神强度', emptyStomachFriendliness: '空腹友好度', sleepImpact: '睡眠影响',
  bestSeasons: '适合季节', bestTimes: '适合时段', vessels: '推荐器具', waterTempC: '水温范围', gramsPer100ml: '每100ml投茶量', firstSteepSeconds: '首泡时间', difficulty: '冲泡难度'
};
var KNOWLEDGE_STATUS_LABELS = { confirmed: '已确认', researched: '已查证', inherited: '类别继承', inferred: '模型推测', personal: '个人记录', conflicted: '存在冲突', unknown: '待补充' };
var KNOWLEDGE_SOURCE_LABELS = { user: '用户', package: '实物包装', purchase: '购买记录', official: '官方', retailer: '零售页面', community: '茶友资料', category_default: '茶类默认', llm: '模型推测', unknown: '未知' };

function _knowledgeValueText(value) {
  if (value === null || value === undefined || value === '') return '待补充';
  if (Array.isArray(value)) return value.length ? value.join('、') : '待补充';
  if (typeof value === 'object' && value.min !== undefined && value.max !== undefined) return value.min + ' ～ ' + value.max;
  return String(value);
}

function _knowledgeInputText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'object' && value.min !== undefined && value.max !== undefined) return value.min + '-' + value.max;
  return String(value);
}

function _knowledgeTypeHint(definition) {
  if (!definition) return '';
  if (definition.type === 'string_array') return '多个值请用顿号分隔';
  if (definition.type === 'number_range') return '请输入最小值-最大值';
  if (definition.type === 'scale_0_5') return '请输入 0 到 5';
  if (definition.type === 'enum') return '可选：' + (definition.values || []).join(' / ');
  if (definition.type === 'integer') return '请输入整数';
  if (definition.type === 'number') return '请输入数字';
  return '请输入内容';
}

function _parseKnowledgeValue(raw, definition) {
  var text = String(raw == null ? '' : raw).trim();
  if (!text) return { ok: true, value: null };
  if (definition.type === 'string') return { ok: true, value: text };
  if (definition.type === 'string_array') {
    var values = text.split(/[、,，]/).map(function(item) { return item.trim(); }).filter(Boolean);
    return { ok: true, value: values.length ? values : null };
  }
  if (definition.type === 'enum') return definition.values.indexOf(text) >= 0 ? { ok: true, value: text } : { ok: false, error: '请输入允许的枚举值' };
  if (definition.type === 'number_range') {
    var parts = text.split(/[-~～至,，]/).map(function(item) { return item.trim(); }).filter(Boolean);
    if (parts.length !== 2 || !isFinite(Number(parts[0])) || !isFinite(Number(parts[1]))) return { ok: false, error: '范围格式应为最小值-最大值' };
    return { ok: true, value: { min: Number(parts[0]), max: Number(parts[1]) } };
  }
  var number = Number(text);
  if (!isFinite(number)) return { ok: false, error: '请输入有效数字' };
  if (definition.type === 'integer' && !Number.isInteger(number)) return { ok: false, error: '请输入整数' };
  return { ok: true, value: number };
}
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
    showKnowledge: false, knowledgeTeaId: null, knowledgeTeaName: '', knowledgeHasBase: false, knowledgeSections: [], knowledgeFieldEditing: false, knowledgeEditPath: '', knowledgeEditLabel: '', knowledgeEditValue: '', knowledgeEditHint: '', knowledgeEditDescription: '', knowledgeEditLocked: false, knowledgeEditOverridden: false, knowledgeEditCanClear: true, inventoryItems: [], inventoryLabel: '', inventoryWeight: '', inventoryQuantity: '1', inventoryStatus: 'sealed', inventoryStatusOptions: ['未开封', '已开封'], inventoryStatusIndex: 0,
    formType: 'add',       // 'add' | 'edit'
    formTitle: '添加茶叶',
    form: {
      id: null,
      name: '', brand: '', cat: 'green',
      year: '', nature: '寒', caffeine: '中', note: '', temporarilyAvoided: false
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
  _formAvoidInitiallyActive: false,

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

    var self = this;
    var groupedTeas = groupOrder.map(function (cat) {
      var teasWithCls = groups[cat].map(function (t) {
        var knowledge = self._getKnowledgePresentation(t.id);
        return {
          id: t.id, name: t.name, brand: t.brand, cat: t.cat,
          nature: t.nature, natureCls: NATURE_CLS[t.nature] || 'ping',
          caffeine: t.caffeine, year: t.year, note: t.note || '',
          disabled: !!t.disabled,
          knowledgeLabel: knowledge.label,
          knowledgeMissing: knowledge.missing,
          inventorySummary: knowledge.inventorySummary
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
    var self = this;
    var flat = teas.map(function (t) {
      var knowledge = self._getKnowledgePresentation(t.id);
      return {
        id: t.id, name: t.name, brand: t.brand, cat: t.cat,
        catName: teaData.CAT_NAMES[t.cat] || t.cat,
        nature: t.nature, natureCls: NATURE_CLS[t.nature] || 'ping',
        caffeine: t.caffeine, year: t.year, note: t.note || '',
        disabled: !!t.disabled,
        knowledgeLabel: knowledge.label,
        knowledgeMissing: knowledge.missing,
        inventorySummary: knowledge.inventorySummary
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
      year: '', nature: def.baseNature, caffeine: def.caffeine, note: '', temporarilyAvoided: false
    };
    this._formAvoidInitiallyActive = false;
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
    var appData = this._appData || data.load();
    var avoidState = (appData.temporaryAvoids || {})[String(tea.id)] || {};
    var temporarilyAvoided = avoidState.active === true && Number(avoidState.expiresAt) > Date.now();
    var form = {
      id: tea.id, name: tea.name, brand: tea.brand || '', cat: tea.cat,
      year: tea.year ? String(tea.year) : '',
      nature: tea.nature || tea.baseNature, caffeine: tea.caffeine, note: tea.note || '',
      temporarilyAvoided: temporarilyAvoided
    };
    this._formAvoidInitiallyActive = temporarilyAvoided;
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
  onAvoidChange: function (e) { this.setData({ 'form.temporarilyAvoided': !!e.detail.value }); },

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

  onOpenKnowledge: function () {
    var teaId = this.data.form.id;
    this.setData({ showForm: false, showKnowledge: true, knowledgeTeaId: teaId, knowledgeFieldEditing: false });
    this._refreshKnowledgePanel(teaId);
  },

  _refreshKnowledgePanel: function (teaId) {
    var appData = data.load();
    this._appData = appData;
    var profile = appData.knowledgeBase && appData.knowledgeBase.profilesByTeaId && appData.knowledgeBase.profilesByTeaId[teaId];
    var override = (appData.knowledgeOverrides || {})[teaId] || {};
    var patch = override.patch || {};
    var lockedPaths = override.lockedPaths || [];
    var tea = (appData.teaLibrary || []).filter(function(item) { return item && item.id === teaId; })[0];
    var fieldState = {};
    var sections = [];
    Object.keys(teaKnowledge.contract.sections).forEach(function(sectionName) {
      var fields = [];
      var definitions = teaKnowledge.contract.sections[sectionName];
      Object.keys(definitions).forEach(function(fieldName) {
        var path = sectionName + '.' + fieldName;
        var baseField = profile && profile[sectionName] && profile[sectionName][fieldName];
        var hasOverride = Object.prototype.hasOwnProperty.call(patch, path);
        var field = hasOverride ? patch[path] : (baseField || { value: null, status: 'unknown', sourceType: 'unknown', confidence: 0 });
        var definition = definitions[fieldName];
        fieldState[path] = { field: field, definition: definition, hasOverride: hasOverride };
        fields.push({
          path: path,
          label: KNOWLEDGE_FIELD_LABELS[fieldName] || fieldName,
          valueText: _knowledgeValueText(field.value),
          statusLabel: KNOWLEDGE_STATUS_LABELS[field.status] || field.status,
          sourceLabel: KNOWLEDGE_SOURCE_LABELS[field.sourceType] || field.sourceType,
          confidenceText: Math.round((Number(field.confidence) || 0) * 100) + '%',
          evidence: field.evidence || '',
          sourceRefs: Array.isArray(field.sourceRefs) ? field.sourceRefs : [],
          description: definition.description || '',
          overridden: hasOverride,
          locked: lockedPaths.indexOf(path) >= 0
        });
      });
      sections.push({ name: sectionName, label: KNOWLEDGE_SECTION_LABELS[sectionName] || sectionName, fields: fields });
    });
    this._knowledgeFieldState = fieldState;
    this.setData({
      knowledgeTeaName: tea ? tea.name : '未知茶款',
      knowledgeHasBase: !!profile,
      knowledgeSections: sections,
      inventoryItems: data.listInventory(teaId)
    });
  },

  onKnowledgeFieldTap: function (e) {
    var path = e.currentTarget.dataset.path;
    var state = this._knowledgeFieldState && this._knowledgeFieldState[path];
    if (!state) return;
    var parts = path.split('.');
    var override = ((this._appData.knowledgeOverrides || {})[this.data.knowledgeTeaId] || {});
    this.setData({
      knowledgeFieldEditing: true,
      knowledgeEditPath: path,
      knowledgeEditLabel: KNOWLEDGE_FIELD_LABELS[parts[1]] || parts[1],
      knowledgeEditValue: _knowledgeInputText(state.field.value),
      knowledgeEditHint: _knowledgeTypeHint(state.definition),
      knowledgeEditDescription: state.definition.description || '',
      knowledgeEditLocked: !!(override.lockedPaths && override.lockedPaths.indexOf(path) >= 0),
      knowledgeEditOverridden: state.hasOverride,
      knowledgeEditCanClear: !state.definition.requiredValue
    });
  },
  onKnowledgeFieldInput: function (e) { this.setData({ knowledgeEditValue: e.detail.value }); },
  onKnowledgeEditLockChange: function (e) { this.setData({ knowledgeEditLocked: !!e.detail.value }); },
  onKnowledgeBackToList: function () { this.setData({ knowledgeFieldEditing: false }); },
  onKnowledgeFieldSave: function () {
    var path = this.data.knowledgeEditPath;
    var state = this._knowledgeFieldState && this._knowledgeFieldState[path];
    if (!state) return;
    var parsedValue = _parseKnowledgeValue(this.data.knowledgeEditValue, state.definition);
    if (!parsedValue.ok) { wx.showToast({ title: parsedValue.error, icon: 'none' }); return; }
    if (parsedValue.value === null && state.definition.requiredValue) { wx.showToast({ title: '必填字段不能清空', icon: 'none' }); return; }
    var hasValue = parsedValue.value !== null;
    var field = { value: parsedValue.value, status: hasValue ? 'personal' : 'unknown', sourceType: hasValue ? 'user' : 'unknown', confidence: hasValue ? 1 : 0, updatedAt: Date.now() };
    if (hasValue) field.evidence = '用户手动记录';
    var result = data.setKnowledgeOverride(this.data.knowledgeTeaId, path, field, { locked: this.data.knowledgeEditLocked });
    if (!result.ok) { wx.showToast({ title: '保存失败：' + (result.error || '格式不正确'), icon: 'none', duration: 3000 }); return; }
    this._refreshKnowledgePanel(this.data.knowledgeTeaId);
    this.setData({ knowledgeFieldEditing: false });
    this._loadLibrary();
    wx.showToast({ title: '字段已保存', icon: 'success' });
  },
  onKnowledgeFieldClear: function () {
    if (!this.data.knowledgeEditCanClear) { wx.showToast({ title: '必填字段不能清空', icon: 'none' }); return; }
    var result = data.setKnowledgeOverride(this.data.knowledgeTeaId, this.data.knowledgeEditPath, {
      value: null, status: 'unknown', sourceType: 'unknown', confidence: 0, updatedAt: Date.now()
    }, { locked: this.data.knowledgeEditLocked });
    if (!result.ok) { wx.showToast({ title: '清空失败', icon: 'none' }); return; }
    this._refreshKnowledgePanel(this.data.knowledgeTeaId);
    this.setData({ knowledgeFieldEditing: false });
    this._loadLibrary();
  },
  onKnowledgeFieldRestore: function () {
    data.removeKnowledgeOverride(this.data.knowledgeTeaId, this.data.knowledgeEditPath);
    this._refreshKnowledgePanel(this.data.knowledgeTeaId);
    this.setData({ knowledgeFieldEditing: false });
    this._loadLibrary();
    wx.showToast({ title: this.data.knowledgeHasBase ? '已恢复基础值' : '已移除个人值', icon: 'success' });
  },

  onInventoryLabelInput: function (e) { this.setData({ inventoryLabel: e.detail.value }); },
  onInventoryWeightInput: function (e) { this.setData({ inventoryWeight: e.detail.value }); },
  onInventoryQuantityInput: function (e) { this.setData({ inventoryQuantity: e.detail.value }); },
  onInventoryStatusChange: function (e) {
    var index = Number(e.detail.value) || 0;
    this.setData({ inventoryStatusIndex: index, inventoryStatus: index === 0 ? 'sealed' : 'opened' });
  },
  onAddInventory: function () {
    var status = this.data.inventoryStatus;
    var quantity = Math.max(1, Number(this.data.inventoryQuantity) || 1);
    if (status === 'opened') quantity = 1;
    var weight = Number(this.data.inventoryWeight);
    var result = data.upsertInventoryItem({ teaId: this.data.knowledgeTeaId, packageType: 'custom',
      packageLabel: (this.data.inventoryLabel || '').trim() || '未命名包装', status: status, quantity: quantity,
      netWeightPerUnit: isFinite(weight) && weight > 0 ? weight : undefined,
      remainingWeight: status === 'opened' && isFinite(weight) && weight > 0 ? weight : undefined,
      openedAt: status === 'opened' ? Date.now() : undefined });
    if (!result.ok) { wx.showToast({ title: '包装信息不正确', icon: 'none' }); return; }
    this.setData({ inventoryLabel: '', inventoryWeight: '', inventoryQuantity: '1' });
    this._refreshKnowledgePanel(this.data.knowledgeTeaId);
    this._loadLibrary(); wx.showToast({ title: '包装已添加', icon: 'success' });
  },
  onKnowledgeClose: function () { this.setData({ showKnowledge: false, knowledgeFieldEditing: false }); },
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

    if (this.data.formType === 'edit' && !!f.temporarilyAvoided !== this._formAvoidInitiallyActive) {
      if (!appData.temporaryAvoids || typeof appData.temporaryAvoids !== 'object') {
        appData.temporaryAvoids = {};
      }
      var key = String(f.id);
      var previous = appData.temporaryAvoids[key] || {};
      var avoidNow = Date.now();
      appData.temporaryAvoids[key] = f.temporarilyAvoided
        ? { active: true, markedAt: avoidNow, expiresAt: avoidNow + 30 * 86400000, updatedAt: avoidNow }
        : {
            active: false,
            markedAt: previous.markedAt || 0,
            expiresAt: previous.expiresAt || 0,
            updatedAt: avoidNow
          };
      this._formAvoidInitiallyActive = !!f.temporarilyAvoided;
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
  _getKnowledgePresentation: function (teaId) {
    var appData = this._appData || data.load();
    var base = appData.knowledgeBase || {};
    var profile = base.profilesByTeaId && base.profilesByTeaId[teaId];
    var inventory = (appData.inventory || []).filter(function(item) {
      return item && item.teaId === teaId && !item.deletedAt;
    });
    var sealed = 0;
    var opened = 0;
    inventory.forEach(function(item) {
      if (item.status === 'sealed') sealed += Number(item.quantity) || 0;
      else if (item.status === 'opened') opened += 1;
    });
    var parts = [];
    if (opened) parts.push('已开 ' + opened);
    if (sealed) parts.push('未开 ' + sealed);
    var completeness = profile && profile.research && Number(profile.research.completeness);
    var override = (appData.knowledgeOverrides || {})[teaId] || {};
    var personalCount = Object.keys(override.patch || {}).length;
    var label = profile ? '画像 ' + Math.round((isFinite(completeness) ? completeness : 0) * 100) + '%' : (personalCount ? '个人补录 ' + personalCount + ' 项' : '待补充');
    return {
      missing: !profile && !personalCount,
      label: label,
      inventorySummary: parts.join(' · ')
    };
  },

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
