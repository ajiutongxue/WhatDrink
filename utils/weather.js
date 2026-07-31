/**
 * weather.js - Weather service wrapper
 * 通过 getWeather 云函数获取高德天气（国内权威数据源，直接返回规范中文）。
 * CommonJS module for WeChat Mini Program
 */

var tracker = require('./tracker');

/**
 * Fetch current weather for a city or coordinates.
 * @param {string} city - City name (Chinese supported)
 * @param {object} [options] - Optional: { latitude, longitude } for location-based weather
 * @returns {Promise<Object|null>} WeatherData or null on failure
 *
 * WeatherData: {
 *   temp: number,          // 温度 ℃
 *   feelsLike: number,     // 体感温度（高德无此字段，等于 temp）
 *   humidity: number,      // 湿度 %
 *   desc: string,          // 天气描述（高德返回的规范中文：晴/多云/小雨…）
 *   wind: number,          // 兼容字段（恒 0）
 *   winddirection: string, // 风向（如「南」）
 *   windpower: string,     // 风力等级（如「≤3」）
 *   city: string,          // 城市名
 *   reporttime: string     // 数据发布时间
 * }
 */
function fetchWeather(city, options) {
  return new Promise(function(resolve) {
    var hasCoords = options && options.latitude && options.longitude;
    if (!city && !hasCoords) {
      resolve(null);
      return;
    }

    var t0 = Date.now();
    var callData = {};
    if (hasCoords) {
      callData.latitude = options.latitude;
      callData.longitude = options.longitude;
    }
    if (city) {
      callData.city = city;
    }

    wx.cloud.callFunction({
      name: 'getWeather',
      data: callData,
      success: function(res) {
        var result = res && res.result;
        if (result && result.success && result.data) {
          tracker.track('weather', { ok: true, ms: Date.now() - t0, city: result.data.city, temp: result.data.temp, via: hasCoords ? 'location' : 'city' });
          resolve(result.data);
        } else {
          tracker.track('weather', { ok: false, ms: Date.now() - t0, city: city || 'coords', errType: 'biz', err: String(result && result.error || 'unknown') });
          resolve(null);
        }
      },
      fail: function(err) {
        tracker.track('weather', { ok: false, ms: Date.now() - t0, city: city || 'coords', errType: 'cloud', err: String(err && err.errMsg || err) });
        resolve(null);
      }
    });
  });
}

module.exports = {
  fetchWeather: fetchWeather
};
