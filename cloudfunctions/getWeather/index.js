/**
 * getWeather cloud function
 * Server-side proxy for the wttr.in weather API.
 *
 * Why this exists:
 *   小程序端 wx.request 受「合法域名白名单」限制，而 wttr.in 是境外服务、
 *   无 ICP 备案，无法加入白名单。云函数运行在腾讯云、拥有完整外网出口，
 *   在这里代理请求后，客户端改走 wx.cloud.callFunction（不受白名单约束），
 *   真机即可关闭调试模式。
 *
 * Input:  event.city - 城市名（支持中文）
 * Output: { success: true, data: WeatherData } 或 { success: false, error }
 *
 * WeatherData: { temp, feelsLike, humidity, desc, wind, city }
 */

var https = require('https');

// wttr.in 免费服务偶尔响应慢，8 秒超时，超时即失败（客户端会优雅降级）
var REQUEST_TIMEOUT = 8000;

exports.main = async function(event, context) {
  var city = event && event.city;
  if (!city || typeof city !== 'string') {
    return { success: false, error: 'No city provided' };
  }

  var url = 'https://wttr.in/' + encodeURIComponent(city) + '?format=j1&lang=zh';

  try {
    var raw = await httpGet(url, REQUEST_TIMEOUT);
    var data = JSON.parse(raw);

    if (!data || !data.current_condition || !data.current_condition.length) {
      return { success: false, error: 'Empty weather response' };
    }

    var current = data.current_condition[0];
    var desc = '';

    // 优先取中文天气描述
    if (current.lang_zh && current.lang_zh.length > 0) {
      desc = current.lang_zh[0].value || '';
    } else if (current.weatherDesc && current.weatherDesc.length > 0) {
      desc = current.weatherDesc[0].value || '';
    }

    return {
      success: true,
      data: {
        temp: toNum(current.temp_C),
        feelsLike: toNum(current.FeelsLikeC),
        humidity: toNum(current.humidity),
        desc: desc,
        wind: toNum(current.windspeedKmph),
        city: city
      }
    };
  } catch (err) {
    console.error('[getWeather] Error:', err);
    return { success: false, error: err.message || 'Unknown error' };
  }
};

/**
 * HTTPS GET 的 Promise 封装，带超时与重定向处理。
 * 用 Node 内置 https 模块，零额外依赖。
 */
function httpGet(url, timeout) {
  return new Promise(function(resolve, reject) {
    var done = false;

    var req = https.get(url, function(res) {
      // wttr.in 对部分城市名会 301/302 重定向，跟随一次
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
