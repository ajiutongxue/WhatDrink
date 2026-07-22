# 动态背景系统改造方案

> 目标：将现有固定 3 张场景 SVG 背景，改造为「时段基底 × 天气叠加元素 × 滤镜色温」三层分离架构，实现类似天气预报 App 的动态风景背景。

## 现状

- 单一 `<image class="scene-bg" src="/images/scene-{{scene}}.svg">` 全屏固定背景
- `_weatherToScene()` 正则映射天气描述 → 3 个场景（sunny / cloudy / rainy）
- 3 张 SVG 共享山丘轮廓，仅天空配色和元素不同
- 无时间维度参与背景选择，无分层叠加概念

## 架构设计：三层分离

```
┌─────────────────────────────────┐
│  L3: 色温遮罩层 (CSS rgba)       │  ← 时段色温过渡，无需图片
├─────────────────────────────────┤
│  L2: 天气叠加层 (透明 SVG)       │  ← 太阳/月亮/云/雨/雪/雾，带动画
├─────────────────────────────────┤
│  L1: 风景基底层 (SVG)           │  ← 山丘+天空渐变，随时段切换
└─────────────────────────────────┘
```

核心思路：基底 4 张 × 天气元素 7 种 = 覆盖 28 种画面组合，滤镜/遮罩负责时段色温连续过渡，避免排列组合出图。

## 资产清单

### 基底风景（4 张，750×1624 viewBox）

| 文件 | 时段 | 视觉描述 |
|------|------|----------|
| `base-dawn.svg` | 清晨 6:00~8:00 | 粉蓝→浅金渐变天空，山丘带薄雾感，柔和低对比 |
| `base-day.svg` | 白天 8:00~17:00 | 明亮暖绿，纯风景（太阳移至叠加层） |
| `base-dusk.svg` | 黄昏 17:00~19:30 | 橙→紫渐变，山丘偏暖色剪影 |
| `base-night.svg` | 夜晚 19:30~6:00 | 深蓝→靛紫，山丘暗色，预留星星位置 |

设计原则：山丘轮廓保持一致（延续现有路径），只变天空渐变和地面配色。

### 天气叠加元素（7 种 + 变体，透明背景 SVG）

| 文件 | 天气 | 内容 | 动画效果 |
|------|------|------|----------|
| `overlay-sun.svg` | 晴（白天） | 太阳光晕 + 放射光线 | 光线缓慢旋转/呼吸 |
| `overlay-moon.svg` | 晴（夜晚） | 弯月 + 几颗星星 | 星星闪烁（opacity 脉动） |
| `overlay-clouds-a.svg` | 多云（变体A） | 3~4 朵半透明云 | 云缓慢水平漂移 |
| `overlay-clouds-b.svg` | 多云（变体B） | 不同位置的云 | 云缓慢水平漂移 |
| `overlay-overcast.svg` | 阴 | 大面积层积云，压顶感 | 极缓慢明暗变化 |
| `overlay-rain.svg` | 雨 | 斜向雨丝 + 底部溅起 | 雨丝下落循环 |
| `overlay-thunder.svg` | 雷阵雨 | 厚云 + 闪电 | 闪电间歇闪现 |
| `overlay-snow.svg` | 雪 | 散落雪花粒子 | 雪花飘落+轻微摇摆 |
| `overlay-fog.svg` | 雾/霾 | 中下部半透明雾带 | 雾带缓慢左右漂移 |

雨/雪强度通过叠加层 opacity 控制（小雨 0.5、中雨 0.75、大雨 1.0），无需额外出图。

## WXML 结构

```html
<view class="scene-container">
  <!-- L1: 风景基底 -->
  <image class="scene-base" src="/images/base-{{timePhase}}.svg" mode="aspectFill" />

  <!-- L2: 天气叠加元素 -->
  <image class="scene-overlay {{overlayAnimClass}}"
         src="/images/{{overlaySrc}}" mode="aspectFill"
         style="opacity: {{overlayOpacity}}" />

  <!-- L3: 色温遮罩（纯 CSS） -->
  <view class="scene-tint tint-{{timePhase}}"></view>
</view>
```

## WXSS 关键样式

```css
/* 容器 */
.scene-container {
  position: fixed;
  top: 0; left: 0;
  width: 100vw; height: 100vh;
  z-index: 0;
  overflow: hidden;
}

/* 各层定位 */
.scene-base, .scene-overlay, .scene-tint {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
}

/* 切换过渡 */
.scene-base, .scene-overlay {
  transition: opacity 1.2s ease;
}

/* 色温遮罩 */
.scene-tint {
  pointer-events: none;
  transition: background 1.5s ease;
}
.tint-dawn  { background: rgba(180, 200, 255, 0.08); }
.tint-day   { background: transparent; }
.tint-dusk  { background: rgba(255, 140, 50, 0.12); }
.tint-night { background: rgba(20, 30, 80, 0.25); }

/* 夜晚基底滤镜（可选增强） */
.phase-night .scene-base {
  filter: brightness(0.85) saturate(0.7);
}

/* ===== 天气动画 ===== */

/* 雨丝下落 */
@keyframes rain-fall {
  from { transform: translateY(-30rpx); }
  to   { transform: translateY(30rpx); }
}
.anim-rain {
  animation: rain-fall 1.2s linear infinite;
}

/* 雪花飘落 */
@keyframes snow-fall {
  0%   { transform: translateY(-20rpx) rotate(0deg); }
  50%  { transform: translateY(10rpx) rotate(5deg); }
  100% { transform: translateY(40rpx) rotate(-3deg); }
}
.anim-snow {
  animation: snow-fall 4s ease-in-out infinite;
}

/* 云朵漂移 */
@keyframes cloud-drift {
  0%, 100% { transform: translateX(0); }
  50%      { transform: translateX(20rpx); }
}
.anim-clouds {
  animation: cloud-drift 8s ease-in-out infinite;
}

/* 星星闪烁 */
@keyframes twinkle {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}
.anim-twinkle {
  animation: twinkle 3s ease-in-out infinite;
}

/* 闪电闪现 */
@keyframes lightning {
  0%, 92%, 100% { opacity: 0; }
  93%, 95%      { opacity: 1; }
  94%           { opacity: 0.3; }
}
.anim-lightning {
  animation: lightning 6s linear infinite;
}

/* 雾带漂移 */
@keyframes fog-drift {
  0%, 100% { transform: translateX(0); }
  50%      { transform: translateX(-30rpx); }
}
.anim-fog {
  animation: fog-drift 10s ease-in-out infinite;
}

/* 太阳光呼吸 */
@keyframes sun-breathe {
  0%, 100% { transform: scale(1); opacity: 0.9; }
  50%      { transform: scale(1.05); opacity: 1; }
}
.anim-sun {
  animation: sun-breathe 5s ease-in-out infinite;
}
```

## JS 场景决策引擎

替换现有 `_weatherToScene`，新增 `determineScene` 方法：

```javascript
/**
 * 输入：天气描述 desc, 当前小时 hour
 * 输出：{ timePhase, overlaySrc, overlayAnimClass, overlayOpacity }
 */
determineScene: function (desc, hour) {
  // 1. 时段判定
  var timePhase;
  if (hour >= 6 && hour < 8)        timePhase = 'dawn';
  else if (hour >= 8 && hour < 17)  timePhase = 'day';
  else if (hour >= 17 && hour < 19.5) timePhase = 'dusk';
  else                              timePhase = 'night';

  // 2. 天气元素映射
  var d = (desc || '').toLowerCase();
  var overlaySrc, overlayAnimClass, overlayOpacity = 1;

  if (/雷|thunder|storm/.test(d)) {
    overlaySrc = 'overlay-thunder.svg';
    overlayAnimClass = 'anim-lightning';
  } else if (/雨|rain|drizzle|shower|sleet/.test(d)) {
    overlaySrc = 'overlay-rain.svg';
    overlayAnimClass = 'anim-rain';
    // 强度区分
    if (/小雨|drizzle/.test(d)) overlayOpacity = 0.5;
    else if (/中雨/.test(d)) overlayOpacity = 0.75;
    else overlayOpacity = 1;
  } else if (/雪|snow/.test(d)) {
    overlaySrc = 'overlay-snow.svg';
    overlayAnimClass = 'anim-snow';
    if (/小雪/.test(d)) overlayOpacity = 0.6;
    else if (/大雪|暴雪/.test(d)) overlayOpacity = 1;
    else overlayOpacity = 0.8;
  } else if (/雾|霾|fog|mist|haze|沙尘|扬沙/.test(d)) {
    overlaySrc = 'overlay-fog.svg';
    overlayAnimClass = 'anim-fog';
  } else if (/阴|overcast/.test(d)) {
    overlaySrc = 'overlay-overcast.svg';
    overlayAnimClass = '';
  } else if (/云|cloud|多云/.test(d)) {
    // 随机变体
    var variant = Math.random() > 0.5 ? 'a' : 'b';
    overlaySrc = 'overlay-clouds-' + variant + '.svg';
    overlayAnimClass = 'anim-clouds';
  } else {
    // 晴天：区分白天/夜晚
    if (timePhase === 'night') {
      overlaySrc = 'overlay-moon.svg';
      overlayAnimClass = 'anim-twinkle';
    } else {
      overlaySrc = 'overlay-sun.svg';
      overlayAnimClass = 'anim-sun';
    }
  }

  return {
    timePhase: timePhase,
    overlaySrc: overlaySrc,
    overlayAnimClass: overlayAnimClass,
    overlayOpacity: overlayOpacity
  };
}
```

### 降级策略

天气接口失败时：timePhase 按时间正常走，overlay 默认 `overlay-clouds-a.svg`（最温和的画面）。

### 刷新策略

- `onShow` 时拉取天气 + 计算场景
- `setInterval` 每 5 分钟检查时段是否跨越分界线，若变化则更新 timePhase（CSS transition 自动平滑过渡）
- 随机变体在 `onShow` 时决定，页面生命周期内不变

## 过渡与加载

- 首次加载：基底和叠加层初始 `opacity: 0`，数据就绪后设为目标值，触发 fade in，避免白闪
- 时段切换：仅更新 timePhase，CSS `transition: background 1.5s` 处理遮罩渐变
- 天气切换：更新 overlaySrc + animClass，利用 `transition: opacity 1.2s` 淡入淡出

## 性能与兼容性

- 全部使用 SVG 资产，预计新增总共 20~40KB，包体积无压力
- 动画仅用 CSS transform / opacity（走 GPU 合成层），不用 JS 逐帧驱动
- 色温遮罩用简单 rgba 背景色，不用 backdrop-filter: blur()，兼容低端安卓
- filter 仅在夜晚对基底做轻微 brightness/saturate 调整，开销极小
- 基础库 3.16.2 下 filter / animation / transition 兼容性良好

## 实施步骤

### 阶段 1：架构搭建（代码改造）

1. 改造 `index.wxml`：单图 → 三层容器结构
2. 编写 `index.wxss`：分层定位、过渡动画、色温遮罩、所有 @keyframes
3. 重写 `index.js` 场景逻辑：`determineScene` 替换 `_weatherToScene`，接入时段+天气+随机+降级
4. 用现有 3 张 SVG 临时充当基底，跑通全流程

### 阶段 2：资产生成（SVG 出图）

5. 生成 4 张时段基底 SVG（保持山丘轮廓一致）
6. 生成 7~9 张天气叠加元素 SVG（透明背景）
7. 逐个替换调试视觉效果，调整配色

### 阶段 3：动画打磨 & 测试

8. 微调各动画参数（速度、幅度、延迟）
9. 调整各时段滤镜/遮罩色温参数
10. 全组合测试（4 时段 × 7 天气 = 28 种画面）
11. 真机验证（iOS + 安卓低端机），确认动画流畅无掉帧
12. 清理旧的 `scene-*.svg` 文件和 `_weatherToScene` 代码

## 不变的部分

- 天气卡片 UI 显示（温度/描述/城市）不受影响
- 推荐引擎的天气修正逻辑（`recommend.js`）不变
- 其他页面（history / teaLib / settings / stats）不涉及
- 云函数 `getWeather` 不变
- 设计系统"暖屿"的 CSS 变量和组件样式不变

## 文件变更预估

| 文件 | 操作 |
|------|------|
| `pages/index/index.wxml` | 修改（背景区域改为三层结构） |
| `pages/index/index.wxss` | 修改（新增分层样式+动画） |
| `pages/index/index.js` | 修改（场景决策引擎重写） |
| `images/base-dawn.svg` | 新增 |
| `images/base-day.svg` | 新增 |
| `images/base-dusk.svg` | 新增 |
| `images/base-night.svg` | 新增 |
| `images/overlay-sun.svg` | 新增 |
| `images/overlay-moon.svg` | 新增 |
| `images/overlay-clouds-a.svg` | 新增 |
| `images/overlay-clouds-b.svg` | 新增 |
| `images/overlay-overcast.svg` | 新增 |
| `images/overlay-rain.svg` | 新增 |
| `images/overlay-thunder.svg` | 新增 |
| `images/overlay-snow.svg` | 新增 |
| `images/overlay-fog.svg` | 新增 |
| `images/scene-sunny.svg` | 删除（阶段3完成后） |
| `images/scene-cloudy.svg` | 删除（阶段3完成后） |
| `images/scene-rainy.svg` | 删除（阶段3完成后） |
