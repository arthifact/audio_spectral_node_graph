import { AudioPlayer } from './audio.js';
import { buildUI } from './ui.js';
import { sceneViewport, projectPoint } from './viewport.js';
import { AdaptiveAnalysis, normalizedSpectrum, smooth } from './adaptive.js';
import CONFIG from './config.js';

const state = {
  analysis: new AdaptiveAnalysis(),
  features: { active: false, level: 0, pulse: 0 },
  spectrum: null,
  nodes: [],
  stars: [],
  time: 0,
  sampleElapsed: 0,
  analysisElapsed: 0,
  serial: 0,
  group: 0,
  rotation: { x: 0.3, y: 0 },
  drag: { active: false, x: 0, y: 0, vx: 0, vy: 0 },
  scale: 0,
  center: { x: 0, y: 0 },
  pulse: 0,
  level: 0,
  viewport: null,
};
let player, ui, fft, amplitude;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent('visualizer');
  canvas.elt.setAttribute(
    'aria-label',
    'Animated spectral graph of your audio',
  );
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
  colorMode(HSB, 360, 100, 100, 100);
  textFont('monospace');
  fft = new p5.FFT(0.65, CONFIG.audio.fftBins);
  amplitude = new p5.Amplitude();
  state.stars = Array.from({ length: CONFIG.scene.starCount }, () => ({
    x: random(),
    y: random(),
    radius: random(0.5, 1.5),
    phase: random(TWO_PI),
  }));
  player = new AudioPlayer({
    fft,
    amplitude,
    onChange: () => ui?.update(),
    onReset: resetAudioState,
  });
  ui = buildUI({ player, clear: resetAudioState, toggleFullscreen });
  ui.update();
  updateViewport();
  attachPointerControls(canvas.elt);
}

function draw() {
  // Limit a resumed tab's first step; all motion and fading use elapsed seconds.
  const dt = Math.min(Math.max(deltaTime / 1000, 0), 0.08);
  state.time += dt;
  if (player.isPlaying) sampleAudio(dt);
  else
    state.features = { ...state.features, active: false, level: 0, pulse: 0 };
  state.level = smooth(state.level, state.features.level, 0.14, dt);
  state.pulse = smooth(state.pulse, state.features.pulse, 0.06, dt);
  updateRotation(dt);
  updateNodes(dt);
  background(222, 45, 3);
  drawStars();
  const projections = projectNodes(dt);
  drawConnections(projections);
  drawNodes(projections);
  drawSpectrum();
  drawReadout();
}

function sampleAudio(dt) {
  state.sampleElapsed += dt;
  state.analysisElapsed += dt;
  if (state.sampleElapsed < CONFIG.audio.sampleInterval) return;
  // One new measurement per sample, never a backlog of duplicated nodes.
  const elapsed = state.analysisElapsed;
  state.analysisElapsed = 0;
  state.sampleElapsed %= CONFIG.audio.sampleInterval;
  state.spectrum = normalizedSpectrum(fft.analyze('dB'));
  state.features = state.analysis.update({
    spectrum: state.spectrum,
    rms: amplitude.getLevel(),
    sampleRate: getAudioContext().sampleRate,
    dt: elapsed,
  });
  if (!state.features.active) return;
  if (state.features.onset) state.group++;
  spawnNode(state.features);
}

function spawnNode(features) {
  const phase = state.serial++ * 0.32;
  // A small helix separates repeated spectra without obscuring their features.
  const radius = 0.22 + features.level * 0.13;
  state.nodes.push({
    x: features.x * 0.95 + Math.cos(phase) * radius,
    y: features.y * 0.85 + Math.sin(phase) * radius,
    z: (features.tilt - 0.5) * 1.3 + Math.sin(phase * 0.7) * 0.3,
    phase,
    hue: features.hue,
    level: features.level,
    onset: features.onset,
    group: state.group,
    age: 0,
  });
  if (state.nodes.length > CONFIG.nodes.maxCount) state.nodes.shift();
}

function updateNodes(dt) {
  for (const node of state.nodes) node.age += dt;
  state.nodes = state.nodes.filter((node) => node.age < CONFIG.nodes.lifetime);
}

function updateRotation(dt) {
  if (state.drag.active) return;
  const speed = reducedMotion.matches ? 0.025 : CONFIG.scene.rotationSpeed;
  state.rotation.y += (speed * (0.6 + state.level * 0.4) + state.drag.vx) * dt;
  state.rotation.x = smooth(
    state.rotation.x,
    0.25 + Math.sin(state.time * 0.13) * 0.18,
    5,
    dt,
  );
  state.rotation.x += state.drag.vy * dt;
  state.drag.vx *= Math.exp(-dt / 0.3);
  state.drag.vy *= Math.exp(-dt / 0.3);
}

function projectNodes(dt) {
  const area = state.viewport;
  const pulse = reducedMotion.matches ? 0 : state.pulse;
  const points = state.nodes.map((node) => {
    const drift = Math.min(node.age / 5, 1) * 0.1;
    const breath = 1 + pulse * 0.035;
    return projectPoint(
      {
        x: (node.x + Math.sin(state.time * 0.35 + node.phase) * drift) * breath,
        y: (node.y + Math.cos(state.time * 0.28 + node.phase) * drift) * breath,
        z: node.z,
      },
      state.rotation,
      CONFIG.scene.perspective,
    );
  });
  if (points.length > 0) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    state.center.x = smooth(
      state.center.x,
      (Math.min(...xs) + Math.max(...xs)) / 2,
      0.8,
      dt,
    );
    state.center.y = smooth(
      state.center.y,
      (Math.min(...ys) + Math.max(...ys)) / 2,
      0.8,
      dt,
    );
  }
  const extentX = Math.max(
    0.5,
    ...points.map((point) => Math.abs(point.x - state.center.x)),
  );
  const extentY = Math.max(
    0.5,
    ...points.map((point) => Math.abs(point.y - state.center.y)),
  );
  const targetScale = Math.min(
    area.width / (extentX * 2 + 0.35),
    area.height / (extentY * 2 + 0.35),
  );
  state.scale = state.scale
    ? smooth(
        state.scale,
        targetScale,
        targetScale < state.scale ? 0.15 : 1.2,
        dt,
      )
    : targetScale;
  // A hard outer guard keeps new transients inside the available canvas.
  const scale = Math.min(state.scale, targetScale * 1.04);
  return points.map((point, i) => ({
    ...point,
    sx: area.x + (point.x - state.center.x) * scale,
    sy: area.y + (point.y - state.center.y) * scale,
    radius:
      (4 + state.nodes[i].level * 7 + (state.nodes[i].onset ? 3 : 0)) *
      point.scale *
      Math.min(1.25, scale / 200),
    alpha:
      Math.min(1, state.nodes[i].age / 0.12) *
      (1 - state.nodes[i].age / CONFIG.nodes.lifetime) ** 1.2,
  }));
}

function drawConnections(points) {
  noFill();
  for (let i = 1; i < points.length; i++) {
    const a = points[i],
      node = state.nodes[i];
    for (let gap = 1; gap <= CONFIG.nodes.neighbors && gap <= i; gap++) {
      const b = points[i - gap];
      const distance = Math.hypot(a.sx - b.sx, a.sy - b.sy);
      const closeness = Math.max(
        0,
        1 - distance / (state.viewport.width * 0.65),
      );
      if (closeness <= 0) continue;
      const sameGroup = node.group === state.nodes[i - gap].group;
      const alpha =
        Math.min(a.alpha, b.alpha) *
        closeness *
        (gap === 1 ? 42 : 14) *
        (sameGroup ? 1 : 0.5);
      stroke(node.hue, 48, 88, alpha);
      strokeWeight(gap === 1 ? 1 : 0.6);
      line(a.sx, a.sy, b.sx, b.sy);
    }
  }
}

function drawNodes(points) {
  const order = points
    .map((point, i) => ({ ...point, node: state.nodes[i] }))
    .sort((a, b) => b.depth - a.depth);
  rectMode(CENTER);
  for (const point of order) {
    const { node, sx, sy, radius, alpha } = point;
    const near = Math.min(1, (node.age < 0.7 ? 1 : 0.65) * point.scale);
    // A continuous falloff avoids hard rings around overlapping nodes.
    const context = drawingContext;
    context.save();
    const glow = context.createRadialGradient(sx, sy, 0, sx, sy, radius * 3.5);
    glow.addColorStop(0, `hsla(${node.hue}, 85%, 65%, ${alpha * near * 0.19})`);
    glow.addColorStop(1, `hsla(${node.hue}, 85%, 65%, 0)`);
    context.fillStyle = glow;
    context.fillRect(
      sx - radius * 3.5,
      sy - radius * 3.5,
      radius * 7,
      radius * 7,
    );
    context.restore();
    noFill();
    stroke(node.hue, 40, 100, alpha * (35 + near * 50));
    strokeWeight(node.onset ? 1.5 : 0.85);
    rect(sx, sy, radius * 2, radius * 2, 1);
    noStroke();
    fill(node.hue, 12, 100, alpha * 90);
    circle(sx, sy, Math.max(1.5, radius * 0.24));
  }
}

function drawStars() {
  noStroke();
  for (const star of state.stars) {
    const glow = 13 + 7 * Math.sin(state.time * 0.3 + star.phase);
    fill(215, 20, glow);
    circle(star.x * width, star.y * height, star.radius);
  }
}

function drawSpectrum() {
  const x = 22,
    y = 22,
    barWidth = Math.min(300, width - 44);
  strokeWeight(1);
  for (let i = 0; i < 80; i++) {
    const brightness = i / 79;
    stroke(270 - brightness * 240, 45, 32);
    line(x + brightness * barWidth, y, x + brightness * barWidth, y + 2);
    if (!state.spectrum || !player.isPlaying) continue;
    const hz = 80 * (14000 / 80) ** brightness;
    const bin = Math.min(
      state.spectrum.length - 1,
      Math.round(
        (hz / (getAudioContext().sampleRate / 2)) * state.spectrum.length,
      ),
    );
    const energy = Math.sqrt(state.spectrum[bin] / 255);
    stroke(270 - brightness * 240, 55, 85, 75);
    line(
      x + brightness * barWidth,
      y + 3,
      x + brightness * barWidth,
      y + 3 + energy * 16,
    );
  }
  noStroke();
  fill(210, 10, 35);
  textSize(8);
  textAlign(LEFT);
  text('80 Hz', x, y + 29);
  textAlign(RIGHT);
  text('14 kHz', x + barWidth, y + 29);
}

function drawReadout() {
  if (width < 900 || height < 600) return;
  const features = state.features;
  const nyquist = getAudioContext().sampleRate / 2;
  const rows = [
    ['CENTROID', ((features.centroid || 0) * nyquist).toFixed(0) + ' Hz'],
    ['SPREAD', ((features.spread || 0) * nyquist).toFixed(0) + ' Hz'],
    ['NODES', String(state.nodes.length)],
  ];
  textSize(8);
  textAlign(LEFT);
  noStroke();
  rows.forEach(([label, value], i) => {
    fill(210, 15, 32);
    text(label, 22, 80 + i * 16);
    fill(210, 12, 56);
    text(value, 86, 80 + i * 16);
  });
}

function updateViewport() {
  const controls = document.querySelector('.controls').getBoundingClientRect();
  state.viewport = sceneViewport({
    width,
    height,
    controlsTop: controls.top,
    controlsLeft: controls.left,
  });
}

function attachPointerControls(canvas) {
  canvas.addEventListener('pointerdown', (event) => {
    state.drag = {
      active: true,
      x: event.clientX,
      y: event.clientY,
      vx: 0,
      vy: 0,
    };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!state.drag.active) return;
    const dx = (event.clientX - state.drag.x) * 0.005;
    const dy = (event.clientY - state.drag.y) * 0.005;
    state.rotation.y += dx;
    state.rotation.x += dy;
    Object.assign(state.drag, {
      x: event.clientX,
      y: event.clientY,
      vx: dx * 12,
      vy: dy * 12,
    });
  });
  const release = () => {
    state.drag.active = false;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
}

function keyPressed(event) {
  if (event?.target?.closest('input, textarea, [contenteditable]')) return;
  if (key === ' ' && event?.target?.closest('button, summary, a')) return;
  if (key === ' ') {
    player.togglePlay();
    return false;
  }
  if (key === 'c' || key === 'C') resetAudioState();
  if (key === '+' || key === '=') state.rotation.y += 0.3;
  if (key === '-') state.rotation.y -= 0.3;
  if (key === 'f' || key === 'F') toggleFullscreen();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  updateViewport();
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    player.error = 'Fullscreen is unavailable in this browser.';
    ui.update();
  }
}

function resetAudioState() {
  state.analysis = new AdaptiveAnalysis();
  state.features = { active: false, level: 0, pulse: 0 };
  state.spectrum = null;
  state.nodes = [];
  state.sampleElapsed = 0;
  state.analysisElapsed = 0;
  state.serial = 0;
  state.group = 0;
  state.pulse = 0;
  state.level = 0;
  state.scale = 0;
  state.center = { x: 0, y: 0 };
}

// p5 global mode discovers lifecycle callbacks on window.
Object.assign(window, { setup, draw, keyPressed, windowResized });
