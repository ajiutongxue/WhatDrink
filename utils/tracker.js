/**
 * tracker.js - 轻量执行埋点（诊断日志）
 * 记录推荐链路关键节点（解析/天气/LLM/降级/同步）的耗时与失败原因，
 * 持久化到本地存储，供设置页「运行诊断」查看；同时输出结构化 console 日志。
 * CommonJS module for WeChat Mini Program
 */

var STORAGE_KEY = 'tea_doctor_diag';
var MAX_LOGS = 80;

var _logs = null;

function _load() {
  if (_logs) return _logs;
  try {
    var raw = wx.getStorageSync(STORAGE_KEY);
    _logs = Array.isArray(raw) ? raw : [];
  } catch (e) {
    _logs = [];
  }
  return _logs;
}

function _flush() {
  try {
    wx.setStorageSync(STORAGE_KEY, _logs);
  } catch (e) {
    // 存储满等异常时静默降级，埋点不影响主流程
  }
}

/**
 * 记录一条埋点事件。
 * @param {string} event - 事件名，如 'llm_rec' / 'weather' / 'rec_done'
 * @param {Object} [data] - 附加数据，建议包含 ok(boolean)、ms(耗时) 等字段
 */
function track(event, data) {
  var logs = _load();
  var entry = { t: Date.now(), e: event, d: data || {} };
  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
  _flush();
  try {
    console.log('[track] ' + event + ' ' + JSON.stringify(entry.d));
  } catch (e) {
    // ignore
  }
  return entry;
}

/**
 * 返回日志列表，最新的在前。
 */
function getLogs() {
  return _load().slice().reverse();
}

/**
 * 清空全部日志。
 */
function clear() {
  _logs = [];
  _flush();
}

module.exports = {
  track: track,
  getLogs: getLogs,
  clear: clear
};
