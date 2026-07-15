var data = require('../../utils/data');
var parser = require('../../utils/parser');
var weather = require('../../utils/weather');
var llm = require('../../utils/llm');
var recommend = require('../../utils/recommend');
var teaData = require('../../utils/teaData');

var CAT_ICONS = {
  green: '🍃', black: '🫖', white: '🤍',
  oolong_tieguanyin: '🍂', oolong_wuyi: '🪨', oolong_dancong: '🌸',
  puerh_raw: '🌿', puerh_ripe: '🟤',
  flavored_jasmine: '🌼', flavored_other: '🍊'
};

var NATURE_CLS = { '寒': 'han', '凉': 'liang', '平': 'ping', '温': 'wen', '热': 're' };

function getSeason() {
  var m = new Date().getMonth() + 1;
  if (m >= 3 && m <= 5) return '春';
  if (m >= 6 && m <= 8) return '夏';
  if (m >= 9 && m <= 11) return '秋';
  return '冬';
}

function getSolarTerm() {
  var now = new Date();
  var md = (now.getMonth() + 1) * 100 + now.getDate();
  var terms = [
    [105,'小寒'],[120,'大寒'],[204,'立春'],[219,'雨水'],[306,'惊蛰'],[321,'春分'],
    [405,'清明'],[420,'谷雨'],[506,'立夏'],[521,'小满'],[606,'芒种'],[621,'夏至'],
    [707,'小暑'],[723,'大暑'],[807,'立秋'],[823,'处暑'],[908,'白露'],[923,'秋分'],
    [1008,'寒露'],[1023,'霜降'],[1107,'立冬'],[1122,'小雪'],[1207,'大雪'],[1222,'冬至']
  ];
  var result = '冬至后';
  for (var i = 0; i < terms.length; i++) {
    if (md < terms[i][0]) break;
    result = terms[i][1];
  }
  return result;
}

Page({
  data: {
    season: '',
    solarTerm: '',
    inputValue: '',
    btnText: '开始推荐',
    loading: false,
    noResult: false,
    hasResult: false,
    rec: null,
    parsedTags: [],
    checkedIn: false,
    checkinMsg: '',
    isSkip: false,
    showCustom: false,
    customTeaName: '',
    // Tasting notes
    showTasting: false,
    tastingDraft: '',
    tastingImages: [],
    tastingSaved: false,
    tastingSavedText: ''
  },

  _appData: null,
  _weatherData: null,
  _weatherCity: '',
  _parsed: null,
  _parseTimer: null,

  onLoad: function () {
    this.setData({ season: getSeason(), solarTerm: getSolarTerm() });
  },

  onShow: function () {
    this._appData = data.load();
    this._weatherCity = this._appData.profile.city || '';
    if (this._weatherCity) {
      this._fetchWeather(this._weatherCity);
    }
  },

  // Called by app.js after cloud sync completes — refresh local cache + weather
  reloadData: function () {
    this._appData = data.load();
    var newCity = this._appData.profile.city || '';
    if (newCity && newCity !== this._weatherCity) {
      this._weatherCity = newCity;
      this._fetchWeather(newCity);
    }
  },

  // ==== Input ====
  onInput: function (e) {
    var val = e.detail.value || '';
    this.setData({ inputValue: val });
    this._debounceParse(val);
  },

  _debounceParse: function (text) {
    var self = this;
    if (self._parseTimer) clearTimeout(self._parseTimer);
    self._parseTimer = setTimeout(function () {
      parser.parseInput(text, (self._appData && self._appData.llm) || {}).then(function (parsed) {
        self._renderParsedTags(parsed);
      });
    }, 300);
  },

  _renderParsedTags: function (parsed) {
    if (!parsed) { this.setData({ parsedTags: [] }); return; }
    var tags = [];
    var states = parsed.states || [];
    var avoidCats = parsed.avoidCats || [];
    var preferCats = parsed.preferCats || [];
    var stateNames = {
      '热证':'上火','脾胃寒':'脾胃寒','感冒':'感冒','失眠':'失眠',
      '疲劳':'疲劳','燥':'干燥','湿重':'湿重','积食':'积食',
      '压力':'压力','经期':'经期','阳虚':'怕冷','酒后':'酒后'
    };
    if (parsed.city) tags.push({ type: 'city', icon: '📍', label: parsed.city });
    var i;
    for (i = 0; i < states.length; i++) {
      tags.push({ type: 'state', icon: '🏥', label: stateNames[states[i]] || states[i] });
    }
    for (i = 0; i < avoidCats.length; i++) {
      tags.push({ type: 'avoid', icon: '🚫', label: '不喝' + (teaData.CAT_NAMES[avoidCats[i]] || avoidCats[i]) });
    }
    for (i = 0; i < preferCats.length; i++) {
      tags.push({ type: 'prefer', icon: '💚', label: '想喝' + (teaData.CAT_NAMES[preferCats[i]] || preferCats[i]) });
    }
    if (parsed.mood) {
      var moodNames = { light: '清淡', strong: '浓郁', sweet: '甘甜' };
      tags.push({ type: 'mood', icon: '🎯', label: moodNames[parsed.mood] || parsed.mood });
    }
    this.setData({ parsedTags: tags });
  },

  // ==== Recommend ====
  onRecommend: function () {
    var self = this;
    var appData = self._appData || data.load();
    self._appData = appData;
    self.setData({ loading: true, noResult: false, hasResult: false, btnText: '分析中...' });

    var llmConfig = appData.llm || {};
    parser.parseInput(self.data.inputValue, llmConfig).then(function (parsed) {
      self._parsed = parsed;
      self._renderParsedTags(parsed);

      // City change → fetch weather
      if (parsed.city && parsed.city !== self._weatherCity) {
        self._weatherCity = parsed.city;
        appData.profile.city = parsed.city;
        data.save(appData);
        self._appData = appData;
        self._fetchWeather(parsed.city);
      }

      var teaLib = appData.teaLibrary || teaData.TEAS;
      var history = appData.history || [];
      var avoidDays = (appData.settings && appData.settings.avoidDays) || 5;
      var constitution = (appData.profile && appData.profile.constitution) || null;
      var result = recommend.recommend(teaLib, parsed, self._weatherData, history, avoidDays, constitution);

    if (!result.primary) {
      self.setData({ loading: false, noResult: true, btnText: '开始推荐' });
      return;
    }

    if (llmConfig.enabled && llmConfig.apiKey) {
      self._callLLM(result, parsed, appData);
    } else {
      self._showRuleResult(result, parsed);
    }
    }); // end .then()
  },

  _callLLM: function (ruleResult, parsed, appData) {
    var self = this;
    llm.callLLM(ruleResult.candidates, parsed, self._weatherData, appData.llm, appData.profile)
      .then(function (llmRes) {
        if (llmRes) {
          self._showLLMResult(llmRes, ruleResult, parsed);
        } else {
          wx.showToast({ title: 'AI 调用失败，使用规则推荐', icon: 'none', duration: 2000 });
          self._showRuleResult(ruleResult, parsed);
        }
      })
      .catch(function () {
        self._showRuleResult(ruleResult, parsed);
      });
  },

  _showRuleResult: function (result, parsed) {
    var p = result.primary;
    var catName = teaData.CAT_NAMES[p.tea.cat] || p.tea.cat;
    var brew = teaData.BREW_GUIDE[p.tea.cat] || teaData.BREW_GUIDE.oolong_other;
    var avoidInfo = '';
    if (p.avoids && p.avoids.length > 0) avoidInfo = '不建议：' + p.avoids.join('；');

    var rec = {
      isAI: false,
      primary: {
        name: p.tea.name, brand: p.tea.brand, nature: p.tea.nature,
        natureCls: NATURE_CLS[p.tea.nature] || 'ping',
        catName: catName, caffeine: p.tea.caffeine, year: p.tea.year,
        reason: this._buildRuleReason(p, parsed),
        brew: { temp: brew.temp, ratio: brew.ratio, time: brew.time },
        _teaId: p.tea.id
      },
      avoidInfo: avoidInfo,
      alt: null
    };

    if (result.alt && result.alt.score > 0) {
      var a = result.alt;
      var altCat = teaData.CAT_NAMES[a.tea.cat] || a.tea.cat;
      var altBrew = teaData.BREW_GUIDE[a.tea.cat] || teaData.BREW_GUIDE.oolong_other;
      rec.alt = {
        name: a.tea.name, brand: a.tea.brand, nature: a.tea.nature,
        natureCls: NATURE_CLS[a.tea.nature] || 'ping',
        catName: altCat, icon: CAT_ICONS[a.tea.cat] || '🍵',
        reason: a.reasons.join('，'),
        brew: { temp: altBrew.temp, ratio: altBrew.ratio },
        _teaId: a.tea.id
      };
    }

    this.setData({
      loading: false, hasResult: true, noResult: false,
      rec: rec, checkedIn: false, showCustom: false, btnText: '开始推荐'
    });
  },

  _showLLMResult: function (llmRes, ruleResult, parsed) {
    var primaryTea = this._matchTeaByName(llmRes.primary && llmRes.primary.name);
    if (!primaryTea && ruleResult.primary) primaryTea = ruleResult.primary.tea;
    var altTea = this._matchTeaByName(llmRes.alternative && llmRes.alternative.name);
    if (!altTea && ruleResult.alt) altTea = ruleResult.alt.tea;
    if (!primaryTea) { this._showRuleResult(ruleResult, parsed); return; }

    var catName = teaData.CAT_NAMES[primaryTea.cat] || primaryTea.cat;
    var brew = teaData.BREW_GUIDE[primaryTea.cat] || teaData.BREW_GUIDE.oolong_other;
    var rec = {
      isAI: true,
      aiModel: (this._appData.llm && this._appData.llm.recModel) || 'AI',
      primary: {
        name: primaryTea.name, brand: primaryTea.brand, nature: primaryTea.nature,
        natureCls: NATURE_CLS[primaryTea.nature] || 'ping',
        catName: catName, caffeine: primaryTea.caffeine, year: primaryTea.year,
        reason: (llmRes.primary && llmRes.primary.reason) || '',
        brew: { temp: brew.temp, ratio: brew.ratio, time: brew.time },
        _teaId: primaryTea.id
      },
      avoidInfo: llmRes.excluded || '',
      alt: null
    };

    if (altTea) {
      var altCat = teaData.CAT_NAMES[altTea.cat] || altTea.cat;
      var altBrew = teaData.BREW_GUIDE[altTea.cat] || teaData.BREW_GUIDE.oolong_other;
      rec.alt = {
        name: altTea.name, brand: altTea.brand, nature: altTea.nature,
        natureCls: NATURE_CLS[altTea.nature] || 'ping',
        catName: altCat, icon: CAT_ICONS[altTea.cat] || '🍵',
        reason: (llmRes.alternative && llmRes.alternative.reason) || '',
        brew: { temp: altBrew.temp, ratio: altBrew.ratio },
        _teaId: altTea.id
      };
    }

    this.setData({
      loading: false, hasResult: true, noResult: false,
      rec: rec, checkedIn: false, showCustom: false, btnText: '开始推荐'
    });
  },

  _buildRuleReason: function (scored, parsed) {
    var parts = [];
    if (this._weatherData) {
      var w = this._weatherData;
      if (w.temp >= 33) parts.push('今日' + w.city + w.temp + '°C高温');
      else if (w.temp <= 5) parts.push('今日' + w.city + '仅' + w.temp + '°C');
      else if (w.humidity >= 75) parts.push('今日' + w.city + '潮湿闷热');
      else parts.push('今日' + w.city + w.temp + '°C');
    }
    parts.push(getSeason() + '季');
    var stateDesc = {
      '热证':'身体有上火症状','脾胃寒':'脾胃偏寒','感冒':'感冒中',
      '失眠':'睡眠不佳','疲劳':'身体疲劳','积食':'饮食积滞',
      '湿重':'体内湿气重','燥':'气候干燥','阳虚':'体质偏阳虚',
      '压力':'精神压力大','经期':'经期中','酒后':'饮酒后'
    };
    var descs = [];
    for (var i = 0; i < parsed.states.length; i++) {
      if (stateDesc[parsed.states[i]]) descs.push(stateDesc[parsed.states[i]]);
    }
    if (descs.length > 0) parts.push(descs.join('、'));
    var r = parts.join('，') + '，推荐这款' + scored.tea.nature + '性的' + scored.tea.name;
    if (scored.reasons && scored.reasons.length > 0) r += '——' + scored.reasons.join('，');
    r += '。';
    if (scored.tea.cat === 'white' && scored.tea.year) {
      var age = new Date().getFullYear() - scored.tea.year;
      if (age >= 3) r += ' 此款白茶已陈化' + age + '年，茶性更趋醇和。';
    }
    if (scored.tea.cat === 'puerh_raw' && scored.tea.year) {
      var ageP = new Date().getFullYear() - scored.tea.year;
      if (ageP >= 5) r += ' 此款生普已陈放' + ageP + '年，茶性渐趋平和。';
    }
    return r;
  },

  _matchTeaByName: function (name) {
    return this._fuzzyMatchTea(name);
  },

  // Fuzzy match: score each tea by how well the input matches name+brand
  _fuzzyMatchTea: function (input) {
    if (!input) return null;
    var lib = (this._appData && this._appData.teaLibrary) || teaData.TEAS;
    var inputLower = input.toLowerCase();
    var bestTea = null, bestScore = 0;

    for (var i = 0; i < lib.length; i++) {
      var t = lib[i];
      var combined = (t.name + t.brand).toLowerCase();

      // Exact match on name = highest priority
      if (t.name === input || t.name.toLowerCase() === inputLower) return t;

      // Substring containment
      if (combined.indexOf(inputLower) >= 0 || inputLower.indexOf(combined) >= 0) {
        var containScore = Math.min(inputLower.length, combined.length) / Math.max(inputLower.length, combined.length) * 90;
        if (containScore > bestScore) { bestScore = containScore; bestTea = t; }
        continue;
      }

      // Fuzzy: extract common substrings and score by coverage
      var score = this._commonSubstringScore(inputLower, combined);
      if (score > bestScore) { bestScore = score; bestTea = t; }
    }

    return bestScore >= 35 ? bestTea : null;
  },

  // Greedily extract non-overlapping common substrings, score = coverage %
  // Longer substrings are found first (weighted by length squared for better discrimination)
  _commonSubstringScore: function (query, target) {
    var matched = 0;
    var qLen = query.length;
    var tLen = target.length;
    var usedQ = []; // matched ranges in query [start, end)
    var maxLen = Math.min(qLen, tLen);

    for (var len = maxLen; len >= 2; len--) {
      for (var qi = 0; qi <= qLen - len; qi++) {
        // Skip if this range overlaps with already matched ranges
        var overlaps = false;
        for (var u = 0; u < usedQ.length; u++) {
          if (qi < usedQ[u][1] && qi + len > usedQ[u][0]) { overlaps = true; break; }
        }
        if (overlaps) continue;

        var sub = query.substring(qi, qi + len);
        var ti = target.indexOf(sub);
        if (ti >= 0) {
          usedQ.push([qi, qi + len]);
          matched += len * len; // square weighting: longer matches count much more
        }
      }
    }

    // Normalize: max possible = qLen^2 (if entire query matches as one block)
    return (matched / (qLen * qLen)) * 100;
  },

  _fetchWeather: function (city) {
    var self = this;
    weather.fetchWeather(city).then(function (w) {
      if (w) self._weatherData = w;
    });
  },

  // ==== Checkin ====
  onCheckinPrimary: function () {
    var rec = this.data.rec;
    if (rec) this._doCheckin(rec.primary._teaId, rec.primary.name, 'primary');
  },
  onCheckinAlt: function () {
    var rec = this.data.rec;
    if (rec && rec.alt) this._doCheckin(rec.alt._teaId, rec.alt.name, 'alt');
  },
  onShowCustom: function () { this.setData({ showCustom: true }); },
  onCustomInput: function (e) { this.setData({ customTeaName: e.detail.value }); },
  onCheckinCustom: function () {
    var name = (this.data.customTeaName || '').trim();
    if (!name) { wx.showToast({ title: '请输入茶名', icon: 'none' }); return; }
    var matched = this._fuzzyMatchTea(name);
    this._doCheckin(matched ? matched.id : -1, matched ? matched.name : name, 'custom');
  },
  onSkipToday: function () {
    var appData = this._appData || data.load();
    appData.history.push({
      date: this._today(), teaId: -1, teaName: '今天没喝茶',
      teaCat: 'none', teaBrand: '', type: 'skip'
    });
    data.save(appData);
    this._appData = appData;
    this.setData({
      checkedIn: true, checkinMsg: '今天没有喝茶', isSkip: true,
      showTasting: false, tastingDraft: '', tastingSaved: false, tastingSavedText: ''
    });
  },

  _doCheckin: function (teaId, teaName, type) {
    var appData = this._appData || data.load();
    var lib = appData.teaLibrary || teaData.TEAS;
    var tea = null;
    for (var i = 0; i < lib.length; i++) {
      if (lib[i].id === teaId) { tea = lib[i]; break; }
    }
    appData.history.push({
      date: this._today(),
      teaId: tea ? tea.id : teaId,
      teaName: tea ? tea.name : teaName,
      teaCat: tea ? tea.cat : 'unknown',
      teaBrand: tea ? tea.brand : '',
      type: type
    });
    data.save(appData);
    this._appData = appData;
    this._lastCheckinIdx = appData.history.length - 1;
    var typeNames = { primary: '主推', alt: '备选', custom: '自选' };
    this.setData({
      checkedIn: true, isSkip: false,
      checkinMsg: '今天喝了「' + (tea ? tea.name : teaName) + '」(' + (typeNames[type] || type) + ')',
      showTasting: false, tastingDraft: '', tastingImages: [], tastingSaved: false, tastingSavedText: ''
    });
    wx.showToast({ title: '已记录', icon: 'success', duration: 1500 });
  },

  // ==== Tasting Notes ====
  onShowTasting: function () {
    var idx = this._lastCheckinIdx;
    var existingImages = [];
    if (idx !== undefined && idx >= 0 && this._appData && this._appData.history[idx]) {
      existingImages = (this._appData.history[idx].imageFileIDs || []).slice();
    }
    this.setData({ showTasting: true, tastingSaved: false, tastingImages: existingImages });
  },

  onTastingInput: function (e) {
    this.setData({ tastingDraft: e.detail.value });
  },

  onChooseImage: function () {
    var self = this;
    var current = this.data.tastingImages || [];
    var remain = 6 - current.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多 6 张', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: function (res) {
        var files = res.tempFiles || [];
        if (files.length === 0) return;
        var appData = self._appData || data.load();
        var history = appData.history || [];
        var idx = self._lastCheckinIdx;
        var entry = (idx !== undefined && history[idx]) ? history[idx] : {};
        var dateStr = entry.date || self._today();
        var teaId = entry.teaId || 0;
        var ts = Date.now();
        var uploaded = current.slice();
        var pending = files.length;
        wx.showLoading({ title: '上传中' });
        files.forEach(function (f, i) {
          var cloudPath = 'tasting-images/' + dateStr + '_' + teaId + '_' + ts + '_' + i + '.jpg';
          wx.cloud.uploadFile({
            cloudPath: cloudPath,
            filePath: f.tempFilePath,
            success: function (upRes) {
              uploaded.push({ fileID: upRes.fileID, caption: '' });
            },
            fail: function (err) {
              console.warn('upload failed', cloudPath, err);
            },
            complete: function () {
              pending--;
              if (pending === 0) {
                wx.hideLoading();
                self.setData({ tastingImages: uploaded });
              }
            }
          });
        });
      }
    });
  },

  onPreviewImage: function (e) {
    var src = e.currentTarget.dataset.src;
    var images = this.data.tastingImages || [];
    if (images.length === 0) return;
    var fileIDs = images.map(function (img) { return img.fileID; });
    var srcIdx = fileIDs.indexOf(src);
    wx.showLoading({ title: '加载中' });
    wx.cloud.getTempFileURL({
      fileList: fileIDs,
      success: function (res) {
        wx.hideLoading();
        var httpsUrls = (res.fileList || []).map(function (f) { return f.tempFileURL; }).filter(Boolean);
        if (httpsUrls.length === 0) return;
        var current = (srcIdx >= 0 && srcIdx < httpsUrls.length) ? httpsUrls[srcIdx] : httpsUrls[0];
        wx.previewImage({ current: current, urls: httpsUrls });
      },
      fail: function () {
        wx.hideLoading();
        wx.showToast({ title: '预览失败', icon: 'none' });
      }
    });
  },

  onRemoveImage: function (e) {
    var idx = e.currentTarget.dataset.idx;
    var self = this;
    var images = (this.data.tastingImages || []).slice();
    var fileId = images[idx] ? images[idx].fileID : '';
    if (!fileId) return;
    wx.showModal({
      title: '删除图片',
      content: '确定删除这张图片吗？',
      success: function (res) {
        if (!res.confirm) return;
        images.splice(idx, 1);
        self.setData({ tastingImages: images });
        wx.cloud.deleteFile({
          fileList: [fileId],
          fail: function (err) { console.warn('deleteFile failed', fileId, err); }
        });
      }
    });
  },

  onCaptionInput: function (e) {
    var idx = e.currentTarget.dataset.idx;
    var images = (this.data.tastingImages || []).slice();
    if (images[idx]) {
      images[idx] = { fileID: images[idx].fileID, caption: e.detail.value };
      this.setData({ tastingImages: images });
    }
  },

  onSaveTasting: function () {
    var text = (this.data.tastingDraft || '').trim();
    var imgs = this.data.tastingImages || [];
    if (!text && imgs.length === 0) {
      wx.showToast({ title: '请输入感受或添加图片', icon: 'none' });
      return;
    }
    var appData = this._appData || data.load();
    var idx = this._lastCheckinIdx;
    if (idx !== undefined && idx >= 0 && idx < appData.history.length) {
      appData.history[idx].tastingNotes = text;
      appData.history[idx].imageFileIDs = imgs.slice();
      data.save(appData);
      this._appData = appData;
    }
    this.setData({
      showTasting: false,
      tastingSaved: true,
      tastingSavedText: text
    });
    wx.showToast({ title: '感受已保存', icon: 'success', duration: 1500 });
  },

  _today: function () {
    var d = new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }
});
