'use strict';

var assert = require('assert');

var storage = {};
var capturedRequest = null;
var mockResult = null;
global.wx = {
  getStorageSync: function(key) { return storage[key]; },
  setStorageSync: function(key, value) { storage[key] = value; },
  request: function(options) {
    capturedRequest = options;
    var result = mockResult || {
      primary: { name: 'Test Tea 1' },
      alternative: { name: '' },
      today_avoid_note: ''
    };
    options.success({
      statusCode: 200,
      data: { choices: [{ message: { content: JSON.stringify(result) } }] }
    });
    return { abort: function() {} };
  }
};

var llm = require('../utils/llm');

function teas(count) {
  var result = [];
  for (var i = 1; i <= count; i++) {
    result.push({
      id: i,
      name: 'Test Tea ' + i,
      brand: 'Test Brand',
      cat: 'green',
      nature: 'neutral',
      caffeine: 'medium',
      year: 2020
    });
  }
  return result;
}

async function call(model, endpoint, count) {
  capturedRequest = null;
  mockResult = null;
  var response = await llm.callLLM(teas(count || 25), {}, {
    apiKey: 'test-key',
    endpoint: endpoint,
    recModel: model
  });
  assert.ok(response && response.primary, 'mock LLM response should be accepted');
  assert.ok(capturedRequest, 'wx.request should be called');
  return capturedRequest;
}

async function run() {
  var qwen = await call(
    'qwen3.7-plus',
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    25
  );
  assert.strictEqual(qwen.data.enable_thinking, false, 'Qwen hybrid models should disable thinking');
  assert.ok(qwen.data.messages[1].content.indexOf('25. Test Tea 25') >= 0, 'all eligible teas should be sent to the LLM');
  assert.ok(qwen.data.messages[1].content.indexOf('不要包含序号、破折号及后续属性') >= 0, 'prompt should prevent Qwen from copying the full candidate row into name');

  var thinkingOnly = await call(
    'qwen3.7-max-2026-05-17',
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    2
  );
  assert.ok(!Object.prototype.hasOwnProperty.call(thinkingOnly.data, 'enable_thinking'), 'thinking-only Qwen snapshot must not receive an unsupported switch');

  var deepseek = await call('deepseek-v4-flash', 'https://api.deepseek.com', 2);
  assert.deepStrictEqual(deepseek.data.thinking, { type: 'disabled' }, 'DeepSeek V4 should disable thinking with its native parameter');

  mockResult = {
    primary: { name: '1. Test Tea 1 (Test Brand)' },
    alternative: { name: '“Test Tea 2（Test Brand）”' },
    today_avoid_note: ''
  };
  var normalized = await llm.callLLM(teas(2), {}, {
    apiKey: 'test-key',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    recModel: 'qwen3.7-plus'
  });
  assert.strictEqual(normalized.primary.name, 'Test Tea 1', 'numbering and ASCII parentheses should normalize to an eligible tea');
  assert.strictEqual(normalized.primary._teaId, 1, 'resolved primary should keep the eligible tea identity');
  assert.strictEqual(normalized.alternative.name, 'Test Tea 2', 'quotes and full-width parentheses should normalize');
  assert.strictEqual(normalized.alternative._teaId, 2, 'resolved alternative should keep the eligible tea identity');

  mockResult = {
    primary: { name: 'Test Tea 1（Test Brand） - 绿茶, 茶性:neutral, 咖啡因:medium, 2020年' },
    alternative: { name: '' },
    today_avoid_note: ''
  };
  var fullCandidateLine = await llm.callLLM(teas(2), {}, {
    apiKey: 'test-key',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    recModel: 'qwen3.7-plus'
  });
  assert.strictEqual(fullCandidateLine.primary.name, 'Test Tea 1', 'a copied full candidate row should resolve to its eligible tea');
  assert.strictEqual(fullCandidateLine.primary._teaId, 1, 'a copied full candidate row should preserve tea identity');

  mockResult = {
    primary: { name: 'Tea Outside Library' },
    alternative: { name: '' },
    today_avoid_note: ''
  };
  var outside = await llm.callLLM(teas(2), {}, {
    apiKey: 'test-key',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    recModel: 'qwen3.7-plus'
  });
  assert.strictEqual(outside, null, 'a genuinely out-of-pool tea must still be rejected');
  assert.strictEqual(llm.getLastErrorType(), 'eligible');

  mockResult = {
    explicitSentiment: 'positive', confidence: 0.91,
    likedTraits: ['花香', '模型自造标签'], dislikedTraits: [],
    observations: ['桂花香明显'], brewingNote: '90度水', contextNotes: '', summary: '明确觉得好喝'
  };
  capturedRequest = null;
  var noteAnalysis = await llm.analyzeTastingNote('桂花香明显，今天觉得很好喝，下次还想喝。', { name: '测试茶' }, { sourceUpdatedAt: 123 }, {
    apiKey: 'test-key', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', parserModel: 'qwen3.7-plus'
  });
  assert.strictEqual(capturedRequest.data.model, 'qwen3.7-plus', 'note analysis must use the configured parser model');
  assert.ok(capturedRequest.data.messages[1].content.indexOf('不得把中性描述猜成喜好') >= 0 || capturedRequest.data.messages[0].content.indexOf('不得把中性描述猜成喜好') >= 0, 'note prompt must explicitly require conservative sentiment');
  assert.strictEqual(noteAnalysis.explicitSentiment, 'positive');
  assert.deepStrictEqual(noteAnalysis.likedTraits, ['花香'], 'note traits must be constrained to the allowlist');
  assert.strictEqual(noteAnalysis.sourceUpdatedAt, 123);
  var conservative = llm.normalizeNoteAnalysis({ explicitSentiment: 'negative', confidence: 0.6, dislikedTraits: ['涩'] }, 456);
  assert.strictEqual(conservative.explicitSentiment, 'unknown', 'low-confidence inferred sentiment must not affect preference');

  console.log('llm request tests passed');
}


module.exports = run;
