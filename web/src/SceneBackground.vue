<script setup lang="ts">
import { computed } from 'vue';
import dawn from '../../images/base-dawn.svg?url';
import day from '../../images/base-day.svg?url';
import dusk from '../../images/base-dusk.svg?url';
import night from '../../images/base-night.svg?url';
import clouds from '../../images/overlay-clouds-a.svg?url';
import snow from '../../images/overlay-snow.svg?url';
import snowNear from '../../images/overlay-snow-near.svg?url';
import thunder from '../../images/overlay-thunder.svg?url';
import fog from '../../images/overlay-fog.svg?url';
import overcast from '../../images/overlay-overcast.svg?url';
import sun from '../../images/overlay-sun.svg?url';
import moon from '../../images/overlay-moon.svg?url';

const props = defineProps<{ phase: 'dawn' | 'day' | 'dusk' | 'night'; weather: string }>();
const base = computed(() => ({ dawn, day, dusk, night })[props.phase]);
const overlay = computed(() => {
  if (props.weather === 'rain' || props.weather === 'thunder') return null;
  if (props.weather === 'snow') return { src: snow, animation: 'anim-snow', opacity: props.phase === 'day' ? .8 : props.phase === 'night' ? .54 : .66 };
  if (props.weather === 'fog') return { src: fog, animation: 'anim-fog', opacity: { dawn: .65, day: .75, dusk: .53, night: .37 }[props.phase] };
  if (props.weather === 'overcast') return { src: overcast, animation: 'anim-overcast', opacity: 1 };
  if (props.weather === 'cloudy') return { src: clouds, animation: 'anim-clouds', opacity: 1 };
  return { src: props.phase === 'night' ? moon : sun, animation: props.phase === 'night' ? 'anim-twinkle' : 'anim-sun', opacity: 1 };
});
// The mini-program uses separate rainfall particles and two snow depth layers.
// Deterministic positions keep scene updates stable while weather changes.
const rain = computed(() => Array.from({ length: props.weather === 'thunder' ? 84 : props.weather === 'rain' ? 64 : 0 }, (_, i) => ({
  left: `${(i * 61.8) % 100}%`, width: `${.75 + (i % 7) * .1}px`, height: `${14 + (i * 7) % 26}px`,
  opacity: .18 + (i % 9) * .04, animationDuration: `${.55 + (i % 11) * .05}s`, animationDelay: `${-(i % 17) * .13}s`,
})));
</script>

<template>
  <div class="scene-container scene-ready" :class="[`phase-${phase}`, `weather-${weather}`]" aria-hidden="true">
    <img class="scene-base" :src="base" alt="" />
    <div v-if="weather === 'fog'" class="scene-fog-bands"></div>
    <img v-if="overlay" class="scene-overlay scene-overlay-primary" :class="overlay.animation" :src="overlay.src" :style="{ opacity: overlay.opacity }" alt="" />
    <img v-if="weather === 'snow'" class="scene-overlay scene-overlay-secondary anim-snow-near" :src="snowNear" :style="{ opacity: phase === 'day' ? .94 : phase === 'night' ? .64 : .76 }" alt="" />
    <div v-if="rain.length" class="scene-precipitation"><span v-for="(drop, i) in rain" :key="i" class="rain-drop" :style="drop"></span></div>
    <div class="scene-tint" :class="`tint-${phase}`"></div>
    <div class="scene-weather-tint"></div>
    <div v-if="weather === 'thunder'" class="scene-lightning"><img class="scene-lightning-bolt" :src="thunder" alt="" /></div>
  </div>
</template>

<!-- Scene layers and palettes ported from pages/index/index.wxss. -->
<style scoped>
/* ============================================================
   Index Page — 今日推荐 「暖屿」
   柔和粉彩 + 印章点缀 + 手写体标题，像一张温暖的茶笺
   ============================================================ */

/* ========== Dynamic Scene Background ========== */
.scene-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 0;
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.8s ease;
}

.scene-ready { opacity: 1; }

.scene-base,
.scene-overlay,
.scene-tint,
.scene-fog-bands,
.scene-precipitation,
.scene-weather-tint,
.scene-lightning {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.scene-base {
  z-index: 0;
  transition: opacity 1.2s ease, filter 1.8s ease;
}

.scene-overlay {
  transform: scale(1.06);
  transform-origin: center;
  transition: opacity 1.2s ease;
  will-change: transform, opacity;
}

.scene-fog-bands { z-index: 1; }
.scene-overlay-primary { z-index: 2; }
.scene-overlay-secondary,
.scene-precipitation { z-index: 3; }
.scene-tint { z-index: 4; transition: background 2s ease; }
.scene-weather-tint { z-index: 5; }
.scene-lightning { z-index: 6; }

.tint-dawn  { background: rgba(160, 180, 240, 0.06); }
.tint-day   { background: transparent; }
.tint-dusk  { background: rgba(255, 120, 40, 0.10); }
.tint-night { background: rgba(15, 20, 60, 0.28); }

.phase-dawn .scene-base { filter: brightness(0.96) saturate(0.88); }
.phase-dusk .scene-base { filter: brightness(0.9) saturate(0.82) hue-rotate(-5deg); }
.phase-night .scene-base { filter: brightness(0.82) saturate(0.65) hue-rotate(8deg); }

/* Rain and thunder use CSS particles without a cloud image. */
.scene-precipitation { overflow: hidden; }
.rain-drop {
  position: absolute;
  top: -12vh;
  border-radius: 499.5px;
  background: #5C7480;
  animation-name: home-rain-particle;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  will-change: transform;
}
.phase-dawn .rain-drop { background: #6C838C; }
.phase-dusk .rain-drop { background: #82979D; }
.phase-night .rain-drop { background: #CFE0E6; }

@keyframes home-rain-particle {
  from { transform: translate3d(0, -12vh, 0) rotate(12deg); }
  to { transform: translate3d(-6vh, 112vh, 0) rotate(12deg); }
}

@keyframes home-snow-far {
  0% { transform: translate3d(0, -6.77%, 0) scale(1.08); }
  50% { transform: translate3d(1.4%, 0, 0) scale(1.08); }
  100% { transform: translate3d(0, 6.77%, 0) scale(1.08); }
}
@keyframes home-snow-near {
  0% { transform: translate3d(0, -9.85%, 0) scale(1.08); }
  50% { transform: translate3d(-1.8%, 0, 0) scale(1.08); }
  100% { transform: translate3d(0, 9.85%, 0) scale(1.08); }
}
@keyframes home-lightning-flash {
  0%, 91.9%, 92.9%, 93.5%, 94.4%, 100% { opacity: 0; }
  92% { opacity: 0.52; }
  93.6% { opacity: 0.34; }
}
@keyframes home-fog {
  0%, 100% { transform: translate3d(-1.5%, 0, 0) scale(1.08); }
  50% { transform: translate3d(1.5%, -0.25%, 0) scale(1.08); }
}
@keyframes home-overcast {
  0%, 100% { transform: translate3d(-1%, 0, 0) scale(1.08); opacity: 0.76; }
  50% { transform: translate3d(2%, 0, 0) scale(1.08); opacity: 0.96; }
}
@keyframes home-clouds {
  0%, 100% { transform: translate3d(-1%, 0, 0) scale(1.08); opacity: 0.78; }
  50% { transform: translate3d(2%, -1%, 0) scale(1.08); opacity: 0.95; }
}
@keyframes sun-breathe {
  0%, 100% { transform: scale(1.06); opacity: 0.88; }
  50% { transform: scale(1.1); opacity: 1; }
}
@keyframes twinkle {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.anim-snow { animation: home-snow-far 11s linear -4.2s infinite; }
.anim-snow-near { animation: home-snow-near 7.5s linear -2.7s infinite; }
.phase-day .anim-snow,
.phase-day .anim-snow-near { filter: brightness(0) invert(1); }
.anim-fog { animation: home-fog 22s ease-in-out infinite; }
.anim-overcast { transform-origin: center top; animation: home-overcast 17s ease-in-out infinite; }
.anim-clouds { animation: home-clouds 20s ease-in-out infinite; }
.anim-sun { animation: sun-breathe 6s ease-in-out infinite; }
.anim-twinkle { animation: twinkle 3.5s ease-in-out infinite; }

.weather-fog .scene-fog-bands {
  opacity: 0.72;
  background:
    linear-gradient(180deg, transparent 0%, transparent 46%, rgba(226, 234, 231, 0.13) 50%, rgba(237, 241, 239, 0.3) 57%, transparent 66%),
    linear-gradient(180deg, transparent 0%, transparent 64%, rgba(219, 228, 224, 0.16) 70%, rgba(239, 242, 240, 0.22) 76%, transparent 84%);
}

.weather-rain .scene-weather-tint {
  background: linear-gradient(180deg, rgba(91, 119, 128, 0.13) 0%, rgba(118, 143, 149, 0.08) 44%, rgba(192, 207, 205, 0.02) 100%);
}
.weather-snow .scene-weather-tint {
  background: linear-gradient(180deg, rgba(159, 181, 190, 0.11) 0%, rgba(188, 204, 209, 0.07) 46%, rgba(229, 236, 235, 0.03) 100%);
}
.weather-thunder .scene-weather-tint {
  background: linear-gradient(180deg, rgba(49, 69, 82, 0.34) 0%, rgba(74, 94, 104, 0.2) 48%, rgba(139, 154, 156, 0.06) 100%);
}
.weather-overcast .scene-weather-tint {
  background: linear-gradient(180deg, rgba(69, 80, 86, 0.13) 0%, rgba(90, 101, 104, 0.09) 50%, rgba(121, 128, 126, 0.04) 100%);
}
.weather-fog .scene-weather-tint {
  background: linear-gradient(180deg, rgba(158, 181, 172, 0.16) 0%, rgba(184, 201, 194, 0.11) 44%, rgba(218, 225, 221, 0.04) 100%);
}

.phase-night.weather-rain .scene-weather-tint {
  background: linear-gradient(180deg, rgba(78, 101, 119, 0.09) 0%, rgba(107, 127, 139, 0.06) 48%, rgba(163, 178, 181, 0.02) 100%);
}
.phase-night.weather-snow .scene-weather-tint {
  background: linear-gradient(180deg, rgba(128, 151, 170, 0.08) 0%, rgba(153, 173, 183, 0.05) 48%, rgba(196, 207, 208, 0.02) 100%);
}
.phase-night.weather-thunder .scene-weather-tint {
  background: linear-gradient(180deg, rgba(36, 51, 68, 0.22) 0%, rgba(60, 76, 89, 0.13) 48%, rgba(117, 133, 140, 0.04) 100%);
}
.phase-night.weather-overcast .scene-weather-tint {
  background: linear-gradient(180deg, rgba(40, 51, 61, 0.08) 0%, rgba(66, 76, 82, 0.05) 52%, rgba(101, 108, 108, 0.02) 100%);
}
.phase-night.weather-fog .scene-weather-tint {
  background: linear-gradient(180deg, rgba(117, 132, 149, 0.1) 0%, rgba(145, 157, 164, 0.07) 48%, rgba(180, 188, 188, 0.02) 100%);
}

.scene-lightning {
  opacity: 0;
  background: linear-gradient(180deg, rgba(225, 238, 240, 0.7), rgba(214, 229, 232, 0.34));
}
.scene-lightning-bolt {
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.weather-thunder .scene-lightning {
  animation: home-lightning-flash 9s steps(1, end) -4.5s infinite;
}


.scene-container { height: 100dvh; z-index: -1; pointer-events: none; }
.scene-base, .scene-overlay, .scene-lightning-bolt { object-fit: cover; object-position: center bottom; }
@media (prefers-reduced-motion: reduce) { .scene-container *, .scene-container { animation: none !important; transition: none !important; } .rain-drop { display: none; } .scene-lightning { display: none; } }
</style>
