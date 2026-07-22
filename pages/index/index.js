var data = require('../../utils/data');
var parser = require('../../utils/parser');
var weather = require('../../utils/weather');
var llm = require('../../utils/llm');
var recommend = require('../../utils/recommend');
var teaData = require('../../utils/teaData');
var lunarLib = require('../../utils/lunar');
var tracker = require('../../utils/tracker');

var CAT_ICONS = {
  green: '🍃', black: '🫖', white: '🤍',
  oolong_tieguanyin: '🍂', oolong_wuyi: '🪨', oolong_dancong: '🌸',
  puerh_raw: '🌿', puerh_ripe: '🟤',
  flavored_jasmine: '🌼', flavored_other: '🍊'
};

var NATURE_CLS = { '寒': 'han', '凉': 'liang', '平': 'ping', '温': 'wen', '热': 're' };

// 每日茶语缓存键（独立于 AppData，不参与云同步与重置）
var DAILY_QUOTE_KEY = 'tea_doctor_daily_quote';

// 预设茶语：LLM 未启用或生成失败时按日期轮换，保证每天都有点不一样
var PRESET_QUOTES = [
  '今日无事，吃茶去。',
  '水沸茶醒，日子也跟着舒展开来。',
  '不急，先喝口茶，再慢慢说。',
  '茶烟起处，便是安心处。',
  '今天的茶，替你把节奏放慢一点。',
  '好茶不怕晚，好事不怕慢。',
  '一口回甘，是茶给的小小奖励。',
  '把心事泡进茶里，喝下去就轻了。',
  '茶温正好，你也正好。',
  '浮沉都是风景，舒展自有时候。',
  '茶凉了可以续，心累了可以歇。',
  '一杯茶，是今天最温柔的开始。',
  '山间一杯茶，云外两袖风。',
  '茶不过浮沉两种姿态，人不过拿起放下两种姿态。'
];

function dayOfYear(d) {
  var start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

function presetQuote() {
  return PRESET_QUOTES[dayOfYear(new Date()) % PRESET_QUOTES.length];
}

// 解析阶段出现这些连接层错误时，跳过深度推荐直接规则兜底
// （同一端点重试无意义，最坏情况可省约 2 分钟空等）
var SKIP_LLM_REC_TYPES = { timeout: 1, offline: 1, network: 1, domain: 1, ssl: 1, abort: 1 };

// 二十四节气寓意文案（固定文案，随节气展示）
var SOLAR_MEANING = {
  '小寒': '寒气渐盛，围炉正暖',
  '大寒': '岁寒将尽，静候春归',
  '立春': '春回大地，万物始生',
  '雨水': '好雨知时，草木萌动',
  '惊蛰': '春雷始鸣，蛰虫惊走',
  '春分': '昼夜平分，春色正中',
  '清明': '气清景明，新茶初上',
  '谷雨': '雨生百谷，春茶正香',
  '立夏': '夏日初长，绿荫渐浓',
  '小满': '小得盈满，麦穗初黄',
  '芒种': '仲夏将至，梅子黄时',
  '夏至': '日长之至，蝉鸣始盛',
  '小暑': '温风初至，暑气渐升',
  '大暑': '炎热至极，心静自凉',
  '立秋': '凉风有信，暑去秋来',
  '处暑': '暑气渐止，秋意初显',
  '白露': '露凝而白，夜凉如水',
  '秋分': '平分秋色，桂子飘香',
  '寒露': '露气寒凉，秋深叶落',
  '霜降': '霜始降下，层林尽染',
  '立冬': '万物收藏，冬之始也',
  '小雪': '寒气渐盛，初雪将至',
  '大雪': '瑞雪将至，天地素白',
  '冬至': '阴极阳生，数九寒天',
  '冬至后': '寒尽将暖，静候春生'
};

// 二十四节气民俗习惯（固定文案，随节气展示）
var SOLAR_CUSTOM = {
  '小寒': '煮腊八粥，踏雪寻梅',
  '大寒': '食糯御寒，除旧迎新',
  '立春': '咬春吃饼，鞭打春牛',
  '雨水': '回门省亲，接寿祈福',
  '惊蛰': '食梨润燥，祭虎驱邪',
  '春分': '竖蛋踏青，簪花祈福',
  '清明': '扫墓踏青，插柳吃青',
  '谷雨': '采饮新茶，赏牡丹花',
  '立夏': '称人吃蛋，尝新迎夏',
  '小满': '祭蚕祈丰，食苦尝鲜',
  '芒种': '饯送花神，煮梅酿酒',
  '夏至': '吃面祭地，消夏避伏',
  '小暑': '食新晒伏，头伏饺子',
  '大暑': '饮伏茶，晒伏姜',
  '立秋': '贴秋膘，啃秋迎凉',
  '处暑': '吃鸭放灯，祈安迎秋',
  '白露': '收露烹茶，食龙眼',
  '秋分': '竖蛋祭月，吃秋菜',
  '寒露': '登高赏菊，饮菊花酒',
  '霜降': '吃柿赏菊，进补御寒',
  '立冬': '吃饺酿酒，补冬进补',
  '小雪': '腌腊味，打糍粑',
  '大雪': '腌肉藏冬，围炉夜话',
  '冬至': '北吃饺子南吃圆',
  '冬至后': '画消寒图，数九盼春'
};

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
    solarMeaning: '',
    solarCustom: '',
    day: '',
    week: '',
    lunarDate: '',
    weather: null,
    // Dynamic scene background (3-layer)
    timePhase: 'day',
    baseSrc: 'base-day.svg',
    overlaySrc: 'overlay-sun.svg',
    overlayAnimClass: 'anim-sun',
    overlayOpacity: 1,
    sceneReady: false,
    dailyQuote: presetQuote(),
    showInput: false,
    inputValue: '',
    btnText: '今天喝点什么茶',
    loading: false,
    loadingText: 'AI 正在分析',
    showCancel: false,
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
    tastingSavedText: '',
    // 页脚版本号（onLoad 从 globalData 读取）
    version: ''
  },

  _appData: null,
  _weatherData: null,
  _weatherCity: '',
  _parsed: null,
  _parseTimer: null,
  _quoteGenerating: false,

  onLoad: function () {
    var sysInfo = wx.getSystemInfoSync();
    var now = new Date();
    var weekNames = ['日','一','二','三','四','五','六'];
    var Lunar = lunarLib.Lunar || lunarLib;
    var ln = Lunar.fromDate(now);
    var app = getApp();
    var term = getSolarTerm();
    this.setData({
      statusBarHeight: sysInfo.statusBarHeight || 20,
      season: getSeason(), solarTerm: term,
      solarMeaning: SOLAR_MEANING[term] || '',
      solarCustom: SOLAR_CUSTOM[term] || '',
      day: now.getDate(),
      week: '周' + weekNames[now.getDay()],
      lunarDate: ln.getMonthInChinese() + '月' + ln.getDayInChinese(),
      version: (app && app.globalData && app.globalData.version) || '1.0.2'
    });
  },

  onShow: function () {
    this._appData = data.load();
    this._weatherCity = this._appData.profile.city || '';
    this._renderDailyQuote();
    // Initialize scene immediately based on time-of-day (weather overlay updates async)
    this._updateScene();
    this._startSceneTimer();
    if (this._weatherCity) {
      this._fetchWeather(this._weatherCity);
    } else {
      this._tryGenerateDailyQuote();
    }
  },

  onHide: function () {
    this._stopSceneTimer();
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

  // ==== Glass Input Panel ====
  onShowInput: function () {
    this.setData({ showInput: true });
  },

  // 点击页面空白区域：若输入框展开且无内容，则收起
  onPageTap: function () {
    if (this.data.showInput && !this.data.inputValue) {
      this.setData({ showInput: false });
    }
  },

  // 空处理：供输入面板 catchtap 阻止冒泡
  noop: function () {},

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
    self._recT0 = Date.now();
    self.setData({ loading: true, loadingText: 'AI 正在分析', showCancel: false, noResult: false, hasResult: false, showInput: false, btnText: '分析中...' });
    self._startLoadingTimer();

    var llmConfig = appData.llm || {};

    // 先探网络状态：无网时跳过 LLM 重试空转，直接规则推荐；网络类型计入埋点
    wx.getNetworkType({
      success: function (netRes) {
        var net = (netRes && netRes.networkType) || 'unknown';
        tracker.track('rec_start', {
          net: net,
          inputLen: (self.data.inputValue || '').length,
          llmRec: !!(llmConfig.enabled && llmConfig.apiKey),
          llmParse: !!(llmConfig.parserEnabled && llmConfig.apiKey)
        });
        if (net === 'none') {
          tracker.track('rec_offline_fallback', {});
          wx.showToast({ title: '当前无网络连接，已切换规则推荐', icon: 'none', duration: 2500 });
          self._doRecommend({}); // 空配置 → 解析与推荐均走本地规则
          return;
        }
        self._doRecommend(llmConfig);
      },
      fail: function () {
        self._doRecommend(llmConfig);
      }
    });
  },

  // ==== Loading 计时与取消 ====
  // loading 期间显示已耗时秒数，10 秒后出现取消按钮（手机上避免 1–2 分钟空白干等）
  _startLoadingTimer: function () {
    var self = this;
    self._stopLoadingTimer();
    self._loadingT0 = Date.now();
    self._loadingTimer = setInterval(function () {
      if (!self.data.loading) { self._stopLoadingTimer(); return; }
      var sec = Math.round((Date.now() - (self._loadingT0 || Date.now())) / 1000);
      var base = self._loadingBase || 'AI 正在分析';
      self.setData({
        loadingText: sec >= 3 ? base + ' · ' + sec + 's' : base,
        showCancel: sec >= 10
      });
    }, 1000);
  },

  _stopLoadingTimer: function () {
    if (this._loadingTimer) {
      clearInterval(this._loadingTimer);
      this._loadingTimer = null;
    }
  },

  onCancelLLM: function () {
    tracker.track('rec_cancel', { ms: Date.now() - (this._recT0 || Date.now()) });
    // abort 后对应 Promise 以 null 结束 → 自动走规则兜底
    llm.abortCurrent();
  },

  _doRecommend: function (llmConfig) {
    var self = this;
    var appData = self._appData || data.load();
    llm.clearLastError(); // 清掉上一轮残留，保证 getLastErrorType 只反映本次推荐
    self._loadingBase = '正在解析输入';
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

      // 硬过滤候选池（去掉今天已喝/disabled/avoidCats）
      var eligibleTeas = recommend.filterEligible(teaLib, parsed, history);
      if (!eligibleTeas || eligibleTeas.length === 0) {
        tracker.track('rec_empty', { stage: 'filter', ms: Date.now() - (self._recT0 || Date.now()) });
        self.setData({ loading: false, noResult: true, btnText: '今天喝点什么茶' });
        return;
      }

      if (llmConfig.enabled && llmConfig.apiKey) {
        // 解析阶段已因连接类错误失败 → 同一端点的深度推荐大概率同样失败，
        // 直接规则兜底，避免用户再等一轮超时
        var parseErrType = llm.getLastErrorType();
        if (SKIP_LLM_REC_TYPES[parseErrType]) {
          var skipMsg = llm.getLastError() || '网络连接失败';
          tracker.track('llm_skip_rec', { errType: parseErrType, reason: skipMsg });
          wx.showToast({ title: skipMsg + '，已切换规则推荐', icon: 'none', duration: 2500 });
          self._fallbackRule(parsed, appData, history, constitution, avoidDays);
          return;
        }
        self._callLLM(eligibleTeas, parsed, appData, history, constitution, avoidDays);
      } else {
        var result = recommend.recommend(teaLib, parsed, self._weatherData, history, avoidDays, constitution);
        if (!result.primary) {
          tracker.track('rec_empty', { stage: 'score', ms: Date.now() - (self._recT0 || Date.now()) });
          self.setData({ loading: false, noResult: true, btnText: '今天喝点什么茶' });
          return;
        }
        self._showRuleResult(result, parsed);
      }
    }); // end .then()
  },

  _callLLM: function (eligibleTeas, parsed, appData, history, constitution, avoidDays) {
    var self = this;
    self._loadingBase = 'AI 深度分析中';
    self.setData({ loadingText: 'AI 深度分析中' });
    var hour = new Date().getHours();
    var slot = recommend.getTimeSlot(hour);
    var teaLib = appData.teaLibrary || teaData.TEAS;

    // Build today's drunk list
    var libMap = {};
    for (var i = 0; i < teaLib.length; i++) libMap[teaLib[i].id] = teaLib[i];
    var today = self._today();
    var todayDrunk = [];
    for (var j = 0; j < (history || []).length; j++) {
      var h = history[j];
      if (h.date === today && h.type !== 'skip' && h.teaId >= 0 && libMap[h.teaId]) {
        var t = libMap[h.teaId];
        todayDrunk.push({ name: t.name, nature: t.nature || t.baseNature || '平', checkinTime: h.checkinTime || '' });
      }
    }

    var context = {
      hour: hour, timeSlot: slot.name,
      season: getSeason(), solarTerm: getSolarTerm(),
      weather: self._weatherData,
      states: (parsed && parsed.states) || [],
      constitution: constitution,
      todayDrunk: todayDrunk,
      avoidCats: (parsed && parsed.avoidCats) || [],
      preferCats: (parsed && parsed.preferCats) || [],
      mood: parsed && parsed.mood,
      profile: appData.profile
    };

    llm.callLLM(eligibleTeas, context, appData.llm)
      .then(function (llmRes) {
        if (llmRes) {
          self._showLLMResult(llmRes, parsed);
        } else {
          var errMsg = llm.getLastError() || 'AI 调用失败';
          tracker.track('llm_fallback', { reason: errMsg });
          wx.showToast({ title: errMsg + '，已切换规则推荐', icon: 'none', duration: 2500 });
          self._fallbackRule(parsed, appData, history, constitution, avoidDays);
        }
      })
      .catch(function (e) {
        tracker.track('llm_fallback', { reason: 'exception', err: String(e && e.message || e) });
        self._fallbackRule(parsed, appData, history, constitution, avoidDays);
      });
  },

  _fallbackRule: function (parsed, appData, history, constitution, avoidDays) {
    var result = recommend.recommend(appData.teaLibrary || teaData.TEAS, parsed, this._weatherData, history, avoidDays, constitution);
    if (result.primary) {
      this._showRuleResult(result, parsed);
    } else {
      tracker.track('rec_empty', { stage: 'fallback', ms: Date.now() - (this._recT0 || Date.now()) });
      this.setData({ loading: false, noResult: true, btnText: '今天喝点什么茶' });
    }
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
      rec: rec, checkedIn: false, showCustom: false, btnText: '今天喝点什么茶'
    });
    tracker.track('rec_done', { mode: 'rule', ms: Date.now() - (this._recT0 || Date.now()), tea: rec.primary.name });
  },

  _showLLMResult: function (llmRes, parsed) {
    var primaryTea = this._matchTeaByName(llmRes.primary && llmRes.primary.name);
    var altTea = this._matchTeaByName(llmRes.alternative && llmRes.alternative.name);
    if (!primaryTea) {
      console.warn('[llm] primary tea not matched, fallback to rule. LLM name:', llmRes.primary && llmRes.primary.name);
      tracker.track('llm_name_miss', { name: (llmRes.primary && llmRes.primary.name) || '' });
      var ad = this._appData || {};
      this._fallbackRule(parsed, ad, ad.history || [], (ad.profile && ad.profile.constitution) || null, (ad.settings && ad.settings.avoidDays) || 5);
      return;
    }

    var catName = teaData.CAT_NAMES[primaryTea.cat] || primaryTea.cat;
    var brew = teaData.BREW_GUIDE[primaryTea.cat] || teaData.BREW_GUIDE.oolong_other;
    var rec = {
      isAI: true,
      aiModel: (this._appData.llm && this._appData.llm.recModel) || 'AI',
      primary: {
        name: primaryTea.name, brand: primaryTea.brand, nature: primaryTea.nature,
        natureCls: NATURE_CLS[primaryTea.nature] || 'ping',
        catName: catName, caffeine: primaryTea.caffeine, year: primaryTea.year,
        tagline: (llmRes.primary && llmRes.primary.tagline) || '',
        narrative: (llmRes.primary && llmRes.primary.narrative) || '',
        reasons: (llmRes.primary && Array.isArray(llmRes.primary.reasons)) ? llmRes.primary.reasons : [],
        reason: (llmRes.primary && Array.isArray(llmRes.primary.reasons)) ? llmRes.primary.reasons.join('；') : '',
        taste_note: (llmRes.primary && llmRes.primary.taste_note) || '',
        brew_tip: (llmRes.primary && llmRes.primary.brew_tip) || '',
        best_before: (llmRes.primary && llmRes.primary.best_before) || '',
        pairing: (llmRes.primary && llmRes.primary.pairing) || '',
        brew: { temp: brew.temp, ratio: brew.ratio, time: brew.time },
        _teaId: primaryTea.id
      },
      avoidInfo: llmRes.today_avoid_note || '',
      alt: null
    };

    if (altTea) {
      var altCat = teaData.CAT_NAMES[altTea.cat] || altTea.cat;
      var altBrew = teaData.BREW_GUIDE[altTea.cat] || teaData.BREW_GUIDE.oolong_other;
      rec.alt = {
        name: altTea.name, brand: altTea.brand, nature: altTea.nature,
        natureCls: NATURE_CLS[altTea.nature] || 'ping',
        catName: altCat, icon: CAT_ICONS[altTea.cat] || '🍵',
        why_different: (llmRes.alternative && llmRes.alternative.why_different) || '',
        reasons: (llmRes.alternative && Array.isArray(llmRes.alternative.reasons)) ? llmRes.alternative.reasons : [],
        reason: (llmRes.alternative && Array.isArray(llmRes.alternative.reasons)) ? llmRes.alternative.reasons.join('；') : '',
        brew_tip: (llmRes.alternative && llmRes.alternative.brew_tip) || '',
        brew: { temp: altBrew.temp, ratio: altBrew.ratio },
        _teaId: altTea.id
      };
    }

    this.setData({
      loading: false, hasResult: true, noResult: false,
      rec: rec, checkedIn: false, showCustom: false, btnText: '今天喝点什么茶'
    });
    tracker.track('rec_done', { mode: 'ai', ms: Date.now() - (this._recT0 || Date.now()), tea: rec.primary.name });
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
    // 喂给 LLM 的候选列表是「name（brand）」格式，LLM 常原样返回。
    // 括号/空格对匹配是噪声，先剔除再比较。
    var inputNoParen = inputLower.replace(/[（）()\s]/g, '');
    var bestTea = null, bestScore = 0;

    for (var i = 0; i < lib.length; i++) {
      var t = lib[i];
      var combined = (t.name + (t.brand || '')).toLowerCase();

      // Exact match on name = highest priority
      if (t.name === input || t.name.toLowerCase() === inputLower) return t;

      // 剔除括号后精确相等 = LLM 返回了候选展示形式「name（brand）」
      if (inputNoParen === combined) return t;

      // Substring containment（用剔括号后的输入比较）
      if (combined.indexOf(inputNoParen) >= 0 || inputNoParen.indexOf(combined) >= 0) {
        var containScore = Math.min(inputNoParen.length, combined.length) / Math.max(inputNoParen.length, combined.length) * 90;
        if (containScore > bestScore) { bestScore = containScore; bestTea = t; }
        continue;
      }

      // Fuzzy: extract common substrings and score by coverage（用剔括号后的输入）
      var score = this._commonSubstringScore(inputNoParen, combined);
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
      if (w) {
        self._weatherData = w;
        self.setData({ weather: w });
      }
      self._updateScene();
      self._tryGenerateDailyQuote();
    });
  },

  // ==== Dynamic Scene Engine ====

  // Determine time-of-day phase from current hour
  _getTimePhase: function (hour) {
    if (hour >= 6 && hour < 8) return 'dawn';
    if (hour >= 8 && hour < 17) return 'day';
    if (hour >= 17 && hour < 19.5) return 'dusk';
    return 'night';
  },

  // Map weather description to overlay element
  _weatherToOverlay: function (desc, timePhase) {
    var d = (desc || '').toLowerCase();

    // Thunder storm
    if (/雷|thunder|storm/.test(d)) {
      return { src: 'overlay-thunder.svg', anim: 'anim-lightning', opacity: 1 };
    }
    // Rain (intensity via opacity)
    if (/雨|rain|drizzle|shower|sleet/.test(d)) {
      var opacity = 1;
      if (/小雨|drizzle|细雨/.test(d)) opacity = 0.5;
      else if (/中雨/.test(d)) opacity = 0.75;
      return { src: 'overlay-rain.svg', anim: 'anim-rain', opacity: opacity };
    }
    // Snow
    if (/雪|snow/.test(d)) {
      var snowOpacity = 0.8;
      if (/小雪/.test(d)) snowOpacity = 0.6;
      else if (/大雪|暴雪/.test(d)) snowOpacity = 1;
      return { src: 'overlay-snow.svg', anim: 'anim-snow', opacity: snowOpacity };
    }
    // Fog / haze
    if (/雾|霾|fog|mist|haze|沙尘|扬沙|浮尘/.test(d)) {
      return { src: 'overlay-fog.svg', anim: 'anim-fog', opacity: 0.8 };
    }
    // Overcast
    if (/阴|overcast/.test(d)) {
      return { src: 'overlay-overcast.svg', anim: 'anim-overcast', opacity: 1 };
    }
    // Cloudy (random variant)
    if (/云|cloud|多云/.test(d)) {
      var variant = Math.random() > 0.5 ? 'a' : 'b';
      return { src: 'overlay-clouds-' + variant + '.svg', anim: 'anim-clouds', opacity: 1 };
    }
    // Clear / sunny — depends on time of day
    if (timePhase === 'night') {
      return { src: 'overlay-moon.svg', anim: 'anim-twinkle', opacity: 1 };
    }
    return { src: 'overlay-sun.svg', anim: 'anim-sun', opacity: 1 };
  },

  // Map timePhase to base landscape
  _phaseToBase: function (timePhase) {
    var map = {
      dawn: 'base-dawn.svg',
      day: 'base-day.svg',
      dusk: 'base-dusk.svg',
      night: 'base-night.svg'
    };
    return map[timePhase] || 'base-day.svg';
  },

  // Central scene update: recompute all three layers
  _updateScene: function () {
    var now = new Date();
    var hour = now.getHours() + now.getMinutes() / 60;
    var timePhase = this._getTimePhase(hour);
    var desc = (this._weatherData && this._weatherData.desc) || '';

    var overlay = this._weatherToOverlay(desc, timePhase);
    var baseSrc = this._phaseToBase(timePhase);

    this.setData({
      timePhase: timePhase,
      baseSrc: baseSrc,
      overlaySrc: overlay.src,
      overlayAnimClass: overlay.anim,
      overlayOpacity: overlay.opacity,
      sceneReady: true
    });
  },

  // Periodic check: update scene if time phase boundary crossed
  _startSceneTimer: function () {
    var self = this;
    if (self._sceneTimer) clearInterval(self._sceneTimer);
    self._sceneTimer = setInterval(function () {
      var now = new Date();
      var hour = now.getHours() + now.getMinutes() / 60;
      var newPhase = self._getTimePhase(hour);
      if (newPhase !== self.data.timePhase) {
        self._updateScene();
      }
    }, 5 * 60 * 1000); // check every 5 minutes
  },

  _stopSceneTimer: function () {
    if (this._sceneTimer) {
      clearInterval(this._sceneTimer);
      this._sceneTimer = null;
    }
  },

  // ==== Daily Quote（每日茶语）====

  // 读取按天缓存的茶语 { date, text }，无缓存返回 null
  _getCachedQuote: function () {
    try {
      var cached = wx.getStorageSync(DAILY_QUOTE_KEY);
      if (cached && typeof cached === 'object' && cached.date && cached.text) {
        return cached;
      }
    } catch (e) { /* ignore */ }
    return null;
  },

  _cacheQuote: function (text) {
    try {
      wx.setStorageSync(DAILY_QUOTE_KEY, { date: this._today(), text: text });
    } catch (e) { /* ignore */ }
  },

  // 同步渲染：今天已有缓存用缓存，否则用预设轮换（LLM 结果稍后异步补充）
  _renderDailyQuote: function () {
    var cached = this._getCachedQuote();
    var quote = (cached && cached.date === this._today()) ? cached.text : presetQuote();
    this.setData({ dailyQuote: quote });
  },

  // 异步生成今日茶语：仅在 LLM 可用且今天尚未缓存时触发，成功后缓存并刷新
  _tryGenerateDailyQuote: function () {
    var self = this;
    if (self._quoteGenerating) return;

    var appData = self._appData || data.load();
    var llmConfig = appData.llm || {};
    // 每日茶语是独立的轻量功能：只要配置了 API（Key + 端点）就生成，
    // 不依赖「深度推荐」开关；模型是否可用由 generateDailyQuote 内部兜底判断
    if (!(llmConfig.apiKey && llmConfig.endpoint)) return;

    var cached = self._getCachedQuote();
    if (cached && cached.date === self._today()) return; // 今天已有，不重复生成

    self._quoteGenerating = true;

    var weekNames = ['日','一','二','三','四','五','六'];
    var now = new Date();
    var context = {
      date: self._today(),
      weekday: '周' + weekNames[now.getDay()],
      solarTerm: getSolarTerm(),
      season: getSeason(),
      weather: self._weatherData || null
    };

    llm.generateDailyQuote(context, llmConfig).then(function (quote) {
      self._quoteGenerating = false;
      if (quote) {
        self._cacheQuote(quote);
        self.setData({ dailyQuote: quote });
      }
      // 失败时保持预设茶语，静默降级
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
    var now = new Date();
    appData.history.push({
      date: this._today(),
      teaId: tea ? tea.id : teaId,
      teaName: tea ? tea.name : teaName,
      teaCat: tea ? tea.cat : 'unknown',
      teaBrand: tea ? tea.brand : '',
      type: type,
      checkinTime: ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2)
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
  },

  _daysAgo: function (n) {
    var d = new Date(Date.now() - n * 86400000);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }
});
