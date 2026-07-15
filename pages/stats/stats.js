var data = require('../../utils/data');
var teaData = require('../../utils/teaData');

// 茶性配色
var NATURE_COLORS = {
  '寒': '#4A7FB5', '凉': '#6AAFCF', '平': '#A8A8A8',
  '温': '#D4883A', '热': '#C25B45', '未知': '#B5A89A'
};
var NATURE_ORDER = ['寒', '凉', '平', '温', '热', '未知'];

// 茶类配色（与茶库页一致）
var CAT_COLORS = {
  green: '#6A9B5C', black: '#8D6E63', white: '#B0BEC5',
  oolong_tieguanyin: '#D4943A', oolong_wuyi: '#C8884A', oolong_dancong: '#B87432',
  puerh_raw: '#6A9B5C', puerh_ripe: '#5D4037',
  flavored_jasmine: '#C27070', flavored_other: '#D49080',
  unknown: '#B5A89A'
};

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function formatDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

Page({
  data: {
    monthLabel: '',
    monthTotal: 0,
    catDist: [],
    natureDist: [],
    top5: [],
    freq: [],
    freqDays: 0,
    freqTotal: 0
  },

  onShow: function () {
    this._compute();
  },

  // 首次渲染后 canvas 节点就绪，补绘一次（onShow 在 onReady 之前首调）
  onReady: function () {
    this._drawDonut(this.data.catDist, this.data.monthTotal);
  },

  _compute: function () {
    var appData = data.load();
    var history = appData.history || [];
    var lib = appData.teaLibrary || teaData.TEAS;
    var libMap = {};
    for (var i = 0; i < lib.length; i++) libMap[lib[i].id] = lib[i];

    var now = new Date();
    var monthKey = now.getFullYear() + '-' + pad(now.getMonth() + 1);
    var monthLabel = now.getFullYear() + '年' + (now.getMonth() + 1) + '月';

    // 本月非 skip 记录
    var monthRecords = [];
    for (var r = 0; r < history.length; r++) {
      var h = history[r];
      if (h.date && h.date.slice(0, 7) === monthKey && h.type !== 'skip') {
        monthRecords.push(h);
      }
    }
    var monthTotal = monthRecords.length;

    // 茶类分布
    var catCount = {};
    monthRecords.forEach(function (h) {
      var cat = h.teaCat || 'unknown';
      catCount[cat] = (catCount[cat] || 0) + 1;
    });
    var catDist = [];
    Object.keys(catCount).forEach(function (cat) {
      var v = catCount[cat];
      catDist.push({
        key: cat,
        name: teaData.CAT_NAMES[cat] || (cat === 'unknown' ? '自选' : cat),
        value: v,
        color: CAT_COLORS[cat] || '#B5A89A',
        pct: monthTotal > 0 ? Math.round(v / monthTotal * 100) : 0
      });
    });
    catDist.sort(function (a, b) { return b.value - a.value; });

    // 茶性分布
    var natureCount = { '寒': 0, '凉': 0, '平': 0, '温': 0, '热': 0, '未知': 0 };
    monthRecords.forEach(function (h) {
      var nature = null;
      if (h.teaId != null && h.teaId >= 0 && libMap[h.teaId]) {
        var tea = libMap[h.teaId];
        nature = tea.nature || tea.baseNature;
      }
      if (nature && natureCount[nature] !== undefined) natureCount[nature]++;
      else natureCount['未知']++;
    });
    var natureDist = NATURE_ORDER.map(function (n) {
      var v = natureCount[n];
      return {
        name: n,
        value: v,
        color: NATURE_COLORS[n],
        pct: monthTotal > 0 ? Math.round(v / monthTotal * 100) : 0
      };
    });

    // Top5：全部历史非 skip，按茶名计数
    var nameCount = {};
    for (var k = 0; k < history.length; k++) {
      if (history[k].type !== 'skip') {
        var key = history[k].teaName || '未知';
        nameCount[key] = (nameCount[key] || 0) + 1;
      }
    }
    var topArr = Object.keys(nameCount).map(function (name) {
      return { name: name, value: nameCount[name] };
    });
    topArr.sort(function (a, b) { return b.value - a.value; });
    var top5 = topArr.slice(0, 5);
    var maxVal = top5.length > 0 ? top5[0].value : 0;
    top5 = top5.map(function (t) {
      return {
        name: t.name,
        value: t.value,
        pct: maxVal > 0 ? Math.round(t.value / maxVal * 100) : 0
      };
    });

    // 频率：最近 30 天
    var freq = [];
    var freqDays = 0;
    var freqTotal = 0;
    for (var d = 29; d >= 0; d--) {
      var date = new Date(now.getTime() - d * 86400000);
      var ds = formatDate(date);
      var count = 0;
      for (var c = 0; c < history.length; c++) {
        if (history[c].date === ds && history[c].type !== 'skip') count++;
      }
      if (count > 0) { freqDays++; freqTotal += count; }
      freq.push({
        date: ds,
        label: (date.getMonth() + 1) + '/' + date.getDate(),
        count: count,
        height: count > 0 ? Math.min(120, 20 + count * 35) : 8
      });
    }

    var self = this;
    this.setData({
      monthLabel: monthLabel,
      monthTotal: monthTotal,
      catDist: catDist,
      natureDist: natureDist,
      top5: top5,
      freq: freq,
      freqDays: freqDays,
      freqTotal: freqTotal
    }, function () {
      self._drawDonut(catDist, monthTotal);
    });
  },

  _drawDonut: function (dist, total) {
    var query = wx.createSelectorQuery();
    query.select('#donutCanvas').fields({ node: true, size: true }).exec(function (res) {
      if (!res || !res[0] || !res[0].node) return;
      var canvas = res[0].node;
      var ctx = canvas.getContext('2d');
      var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      var dpr = info.pixelRatio;
      var w = res[0].width;
      var h = res[0].height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      var cx = w / 2;
      var cy = h / 2;
      var R = Math.min(w, h) / 2 - 6;
      var r = R * 0.62;

      // 空数据：画灰环
      if (total === 0 || !dist || dist.length === 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, 2 * Math.PI);
        ctx.arc(cx, cy, r, 0, 2 * Math.PI, true);
        ctx.fillStyle = '#F0E8DA';
        ctx.fill();
        ctx.fillStyle = '#B5A89A';
        ctx.font = '18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('暂无数据', cx, cy);
        return;
      }

      // 画扇形
      var start = -Math.PI / 2;
      dist.forEach(function (d) {
        var angle = d.value / total * 2 * Math.PI;
        if (angle <= 0) return;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, start, start + angle);
        ctx.closePath();
        ctx.fillStyle = d.color;
        ctx.fill();
        start += angle;
      });

      // 挖空内圆
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fillStyle = '#FFFDF9';
      ctx.fill();

      // 中心文字
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#3A2A1E';
      ctx.font = 'bold 38px sans-serif';
      ctx.fillText(String(total), cx, cy - 10);
      ctx.fillStyle = '#B5A89A';
      ctx.font = '20px sans-serif';
      ctx.fillText('次', cx, cy + 22);
    });
  }
});
