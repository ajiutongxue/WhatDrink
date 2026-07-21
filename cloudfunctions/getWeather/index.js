/**
 * getWeather cloud function
 * 服务端代理「高德地图」天气 API（国内权威数据源，直接返回中文天气）。
 *
 * 为什么用它：
 *   1) 小程序端 wx.request 受「合法域名白名单」限制，天气接口需服务端代理；
 *      云函数运行在腾讯云、有完整外网出口，客户端走 wx.cloud.callFunction 即可。
 *   2) 此前用的 wttr.in（境外聚合源）对中国城市天气描述不可靠（实测会把晴天
 *      误报成 "Smoky haze"，且 lang_zh 常返回英文）。高德返回权威中文天气，
 *      从根本上解决误报与英文问题。
 *
 * 流程：城市名 →(地理编码)→ adcode →(天气查询)→ 实况天气。
 *
 * 密钥：存放在同目录 config.json（已加入 .gitignore，不会提交到 git）。
 *
 * Input:  event.city - 城市名（支持中文，如「郑州」「郑州市」）
 * Output: { success: true, data: WeatherData } 或 { success: false, error }
 *
 * WeatherData: { temp, feelsLike, humidity, desc, wind, winddirection, windpower, city, reporttime }
 */

var https = require('https');
var config = require('./config.json');

var AMAP_KEY = config.amapKey;
var REQUEST_TIMEOUT = 8000;

// 城市名 → adcode 内存缓存：云函数热实例复用期间有效，减少地理编码配额消耗。
var adcodeCache = {};

exports.main = async function(event, context) {
  var city = event && event.city;
  if (!city || typeof city !== 'string') {
    return { success: false, error: 'No city provided' };
  }

  try {
    var adcode = await getAdcode(city);
    if (!adcode) {
      return { success: false, error: 'Geocode failed for city: ' + city };
    }

    var live = await getLiveWeather(adcode);
    if (!live) {
      return { success: false, error: 'Empty weather response' };
    }

    return {
      success: true,
      data: {
        temp: toNum(live.temperature),
        // 高德无体感温度字段，用实际温度兜底
        feelsLike: toNum(live.temperature),
        humidity: toNum(live.humidity),
        // 高德 weather 字段已是规范中文（晴/多云/阴/小雨/雾/霾…），无需再翻译
        desc: live.weather || '',
        // 高德提供风向 + 风力等级（如「南」「≤3」），非 km/h；wind 保留数值位以兼容旧结构
        wind: 0,
        winddirection: live.winddirection || '',
        windpower: live.windpower || '',
        city: city,
        reporttime: live.reporttime || ''
      }
    };
  } catch (err) {
    console.error('[getWeather] Error:', err);
    return { success: false, error: err.message || 'Unknown error' };
  }
};

/**
 * 地理编码：城市名 → adcode（行政区划编码，天气查询所需）。
 * 带内存缓存，命中则不再请求。
 */
function getAdcode(city) {
  if (adcodeCache[city]) {
    return Promise.resolve(adcodeCache[city]);
  }
  var url = 'https://restapi.amap.com/v3/geocode/geo?key=' + AMAP_KEY +
            '&address=' + encodeURIComponent(city);
  return httpGet(url, REQUEST_TIMEOUT).then(function(raw) {
    var data = JSON.parse(raw);
    if (data.status === '1' && data.geocodes && data.geocodes.length) {
      var adcode = data.geocodes[0].adcode;
      if (adcode) adcodeCache[city] = adcode;
      return adcode || null;
    }
    return null;
  });
}

/**
 * 天气查询：adcode → 实况天气（extensions=base 返回 lives 实况数组）。
 */
function getLiveWeather(adcode) {
  var url = 'https://restapi.amap.com/v3/weather/weatherInfo?key=' + AMAP_KEY +
            '&city=' + adcode + '&extensions=base';
  return httpGet(url, REQUEST_TIMEOUT).then(function(raw) {
    var data = JSON.parse(raw);
    if (data.status === '1' && data.lives && data.lives.length) {
      return data.lives[0];
    }
    return null;
  });
}

/**
 * HTTPS GET 的 Promise 封装，带超时与重定向处理。
 * 用 Node 内置 https 模块，零额外依赖。
 */
function httpGet(url, timeout) {
  return new Promise(function(resolve, reject) {
    var done = false;

    var req = https.get(url, function(res) {
      // 跟随一次 301/302 重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        done = true;
        res.resume();
        httpGet(res.headers.location, timeout).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        done = true;
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }

      var body = '';
      res.setEncoding('utf8');
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        if (!done) { done = true; resolve(body); }
      });
      res.on('error', function(err) {
        if (!done) { done = true; reject(err); }
      });
    });

    req.setTimeout(timeout, function() {
      if (!done) {
        done = true;
        req.destroy();
        reject(new Error('Request timeout'));
      }
    });
    req.on('error', function(err) {
      if (!done) { done = true; reject(err); }
    });
  });
}

/**
 * 安全转数字。
 */
function toNum(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}
