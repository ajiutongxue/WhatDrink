/**
 * getWeather cloud function
 * 服务端代理「高德地图」天气 API（国内权威数据源，直接返回中文天气）。
 *
 * 支持两种输入：
 *   1) event.city - 城市名（如「成都」「郑州市」）→ 地理编码 → adcode → 天气
 *   2) event.latitude + event.longitude - 经纬度 → 逆地理编码 → 城市+adcode → 天气
 *
 * 密钥：存放在同目录 config.json（已加入 .gitignore，不会提交到 git）。
 *
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
  var latitude = event && event.latitude;
  var longitude = event && event.longitude;

  var adcode = null;
  var resolvedCity = city || '';

  try {
    // Mode 1: coordinates → reverse geocode → city + adcode
    if (latitude && longitude) {
      var geo = await getCityByLocation(latitude, longitude);
      if (geo) {
        adcode = geo.adcode;
        resolvedCity = geo.city;
      }
    }

    // Mode 2 (or fallback): city name → geocode → adcode
    if (!adcode && resolvedCity) {
      adcode = await getAdcode(resolvedCity);
    }

    if (!adcode) {
      return { success: false, error: 'Cannot resolve location' };
    }

    var live = await getLiveWeather(adcode);
    if (!live) {
      return { success: false, error: 'Empty weather response' };
    }

    return {
      success: true,
      data: {
        temp: toNum(live.temperature),
        feelsLike: toNum(live.temperature),
        humidity: toNum(live.humidity),
        desc: live.weather || '',
        wind: 0,
        winddirection: live.winddirection || '',
        windpower: live.windpower || '',
        city: resolvedCity,
        reporttime: live.reporttime || ''
      }
    };
  } catch (err) {
    console.error('[getWeather] Error:', err);
    return { success: false, error: err.message || 'Unknown error' };
  }
};

/**
 * 逆地理编码：经纬度 → 城市名 + adcode。
 * 高德 regeo 接口返回 addressComponent，从中提取城市和区级 adcode。
 */
function getCityByLocation(lat, lng) {
  var location = lng + ',' + lat; // 高德格式：经度,纬度
  var url = 'https://restapi.amap.com/v3/geocode/regeo?key=' + AMAP_KEY +
            '&location=' + location + '&extensions=base';
  return httpGet(url, REQUEST_TIMEOUT).then(function(raw) {
    var data = JSON.parse(raw);
    if (data.status === '1' && data.regeocode && data.regeocode.addressComponent) {
      var comp = data.regeocode.addressComponent;
      // 直辖市时 city 为空数组，用 province 兜底
      var cityName = (comp.city && typeof comp.city === 'string') ? comp.city : (comp.province || '');
      var adcode = comp.adcode || '';
      if (cityName && adcode) {
        return { city: cityName, adcode: adcode };
      }
    }
    return null;
  });
}

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
