# 界面还原检查 · 2026-10-24

以原小程序 pages 下的 WXML、WXSS 及 app.wxss 为依据。ui-prototype 仅辅助参考，其轮播布局不等于原小程序。

修复：首页宋体日期、珊瑚按钮、上下主备选布局和天气叠层；记录标题回到卡片内；茶库恢复分类线条列表；设置恢复档案、展开的体质问卷、AI、推荐、数据的顺序。库存、画像、图片等现有功能保留。

## 实际截图
首轮前后对照为 390 × 844 CSS 像素浏览器截图；后续反馈与打卡截图包含桌面视图。均非微信原生截图。

| 页面 | 修改前 | 修改后 |
| --- | --- | --- |
| 首页 | [前](01-before-home.png) | [后](11-after-home.png) |
| 推荐结果 | [前](02-before-result.png) | [后](12-after-result.png) |
| 记录 | [前](03-before-history.png) | [后](13-after-history.png) |
| 茶库 | [前](04-before-library.png) | [后](14-after-library.png) |
| 设置 | [前](05-before-settings.png) | [后](15-after-settings.png) |

## 验证
web build、web test、根目录 verify 通过。独立测试环境推荐、打卡、记录读回成功；四页逐页截图检查。构建仍有较大 chunk 提示。天气所有组合及 iPhone 安装、离线真机验收未完成。

2026-10-24 已发布线上，详见 [部署记录](../deployment-20261024.md)。本地预览 http://127.0.0.1:5173 的测试数据独立于生产。
