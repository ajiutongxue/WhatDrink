// ============================================================
//  衬线字体加载器
//  微信小程序无法可靠依赖系统 Songti SC / serif 关键字来渲染
//  中文衬线体（真机会回退到 PingFang SC 无衬线），必须显式
//  加载一个字体文件。注册后的 family 名为 NotoSerifSC。
// ============================================================

const FONT_FAMILY = 'NotoSerifSC';

// —— 字体来源（二选一，填下面其一）——
// 1) https URL：需在 mp 后台「开发 → 开发设置 → 下载文件合法域名」
//    加入该域名；或个人版开发调试模式关掉域名校验即可。
// 2) base64 data URI：无需域名，但体积大，不推荐放进代码。
// 留空 '' 则不加载，沿用系统字体（即当前看到的 PingFang 无衬线）。
const FONT_SOURCE = ''; // ← 把你的子集 woff2 的 URL 或 data URI 填这里

let _requested = false;

function loadSerifFont() {
  if (_requested) return;
  _requested = true;

  if (!FONT_SOURCE) {
    console.log('[font] 未配置衬线字体来源，沿用系统字体');
    return;
  }

  wx.loadFontFace({
    family: FONT_FAMILY,
    source: FONT_SOURCE,
    global: true,
    scopes: ['webview', 'native'],
    success: function () {
      console.log('[font] 衬线字体加载成功：' + FONT_FAMILY);
    },
    fail: function (err) {
      console.warn('[font] 衬线字体加载失败：', err);
    }
  });
}

module.exports = { loadSerifFont, FONT_FAMILY };
