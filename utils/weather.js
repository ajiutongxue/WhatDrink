/**
 * weather.js - Weather service wrapper
 * Fetches weather data from wttr.in API
 * CommonJS module for WeChat Mini Program
 */

var tracker = require('./tracker');

/**
 * Fetch current weather for a city.
 * @param {string} city - City name (Chinese supported)
 * @returns {Promise<Object|null>} WeatherData or null on failure
 *
 * WeatherData: {
 *   temp: number,       // Temperature °C
 *   feelsLike: number,  // Feels-like temperature
 *   humidity: number,   // Humidity %
 *   desc: string,       // Weather description (Chinese)
 *   wind: number,       // Wind speed km/h
 *   city: string        // City name
 * }
 */
function fetchWeather(city) {
  return new Promise(function(resolve) {
    if (!city || typeof city !== 'string') {
      resolve(null);
      return;
    }

    var t0 = Date.now();

    // 优先走云函数代理：云函数运行在腾讯云、有完整外网出口，
    // 不受小程序「合法域名白名单」约束，真机无需开启调试模式。
    // 云函数不可用（未部署/云异常）时，降级为直连 wx.request（仅开发工具或开调试时能通）。
    wx.cloud.callFunction({
      name: 'getWeather',
      data: { city: city },
      success: function(res) {
        var result = res && res.result;
        if (result && result.success && result.data) {
          tracker.track('weather', { ok: true, ms: Date.now() - t0, city: city, temp: result.data.temp, via: 'cloud' });
          resolve(result.data);
        } else {
          // 云函数业务失败（wttr.in 超时/空响应等）→ 降级直连
          fetchDirect(city, t0).then(resolve);
        }
      },
      fail: function(err) {
        // 云函数本身不可用（未部署/未初始化等）→ 降级直连
        tracker.track('weather', { ok: false, ms: Date.now() - t0, city: city, errType: 'cloud', err: String(err && err.errMsg || err) });
        fetchDirect(city, t0).then(resolve);
      }
    });
  });
}

/**
 * 降级路径：直接 wx.request wttr.in。
 * 受合法域名白名单限制（wttr.in 无法加入），仅在开发工具/调试模式下可用；
 * 真机关闭调试模式后会失败并 resolve(null)，属可接受的优雅降级。
 */
function fetchDirect(city, t0) {
  return new Promise(function(resolve) {
    var url = 'https://wttr.in/' + encodeURIComponent(city) + '?format=j1&lang=zh';

    wx.request({
      url: url,
      method: 'GET',
      timeout: 10000,
      success: function(res) {
        try {
          var data = res.data;
          if (!data || !data.current_condition || !data.current_condition.length) {
            tracker.track('weather', { ok: false, ms: Date.now() - t0, city: city, errType: 'empty', http: res.statusCode, via: 'direct' });
            resolve(null);
            return;
          }

          var current = data.current_condition[0];
          var desc = '';

          // Try to get Chinese weather description
          if (current.lang_zh && current.lang_zh.length > 0) {
            desc = current.lang_zh[0].value || '';
          } else if (current.weatherDesc && current.weatherDesc.length > 0) {
            desc = current.weatherDesc[0].value || '';
          }

          tracker.track('weather', { ok: true, ms: Date.now() - t0, city: city, temp: _toNum(current.temp_C), via: 'direct' });
          resolve({
            temp: _toNum(current.temp_C),
            feelsLike: _toNum(current.FeelsLikeC),
            humidity: _toNum(current.humidity),
            desc: desc,
            wind: _toNum(current.windspeedKmph),
            city: city
          });
        } catch (e) {
          console.warn('[weather] parse error:', e);
          tracker.track('weather', { ok: false, ms: Date.now() - t0, city: city, errType: 'parse', err: String(e && e.message || e), via: 'direct' });
          resolve(null);
        }
      },
      fail: function(err) {
        console.warn('[weather] request failed:', err);
        tracker.track('weather', { ok: false, ms: Date.now() - t0, city: city, errType: 'request', err: String(err && err.errMsg || err), via: 'direct' });
        resolve(null);
      }
    });
  });
}

/**
 * Safely convert a value to a number.
 * @param {*} val
 * @returns {number}
 */
function _toNum(val) {
  var n = Number(val);
  return isNaN(n) ? 0 : n;
}

module.exports = {
  fetchWeather: fetchWeather
};
