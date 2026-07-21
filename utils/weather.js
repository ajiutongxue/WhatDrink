/**
 * weather.js - Weather service wrapper
 * 通过 getWeather 云函数获取高德天气（国内权威数据源，直接返回规范中文）。
 * CommonJS module for WeChat Mini Program
 */

var tracker = require('./tracker');

/**
 * Fetch current weather for a city.
 * @param {string} city - City name (Chinese supported)
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
function fetchWeather(city) {
  return new Promise(function(resolve) {
    if (!city || typeof city !== 'string') {
      resolve(null);
      return;
    }

    var t0 = Date.now();

    // 走云函数代理：云函数运行在腾讯云、有完整外网出口，调用高德天气 API，
    // 不受小程序「合法域名白名单」约束，真机无需开启调试模式。
    // 高德返回规范中文天气，客户端无需任何翻译/校正。
    // 云函数失败（未部署/配额耗尽/网络异常）时 resolve(null)，界面优雅地不显示天气。
    wx.cloud.callFunction({
      name: 'getWeather',
      data: { city: city },
      success: function(res) {
        var result = res && res.result;
        if (result && result.success && result.data) {
          tracker.track('weather', { ok: true, ms: Date.now() - t0, city: city, temp: result.data.temp, via: 'cloud' });
          resolve(result.data);
        } else {
          tracker.track('weather', { ok: false, ms: Date.now() - t0, city: city, errType: 'biz', err: String(result && result.error || 'unknown') });
          resolve(null);
        }
      },
      fail: function(err) {
        tracker.track('weather', { ok: false, ms: Date.now() - t0, city: city, errType: 'cloud', err: String(err && err.errMsg || err) });
        resolve(null);
      }
    });
  });
}

module.exports = {
  fetchWeather: fetchWeather
};
