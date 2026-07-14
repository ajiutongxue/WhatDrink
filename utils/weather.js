/**
 * weather.js - Weather service wrapper
 * Fetches weather data from wttr.in API
 * CommonJS module for WeChat Mini Program
 */

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

    var url = 'https://wttr.in/' + encodeURIComponent(city) + '?format=j1&lang=zh';

    wx.request({
      url: url,
      method: 'GET',
      timeout: 10000,
      success: function(res) {
        try {
          var data = res.data;
          if (!data || !data.current_condition || !data.current_condition.length) {
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
          resolve(null);
        }
      },
      fail: function(err) {
        console.warn('[weather] request failed:', err);
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
