import { AudioPlayer } from './audio.js';
import { buildUI } from './ui.js';
import { sceneViewport, projectPoint } from './viewport.js';
import { AdaptiveAnalysis, normalizedSpectrum, smooth } from './adaptive.js';
import CONFIG from './config.js';
import { SmoothCamera } from './camera.js';

const state = {
  analysis: new AdaptiveAnalysis(),
  features: { active: false, level: 0, pulse: 0 },
  spectrum: null,
  nodes: [],
  stars: [],
  time: 0,
  sampleElapsed: 0,
  analysisElapsed: 0,
  group: 0,
  rotation: { x: 0.3, y: 0, z: 0 },
  flowSeed: { x: 0, y: 0, z: 0 },
  drag: { active: false, x: 0, y: 0, vx: 0, vy: 0 },
  camera: new SmoothCamera(),
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
  state.flowSeed = { x: random(1000), y: random(1000), z: random(1000) };
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
  if (state.features.onset) {
    state.group++;
    for (const node of state.nodes) {
      if (node.age > 0.8) continue;
      const push = state.features.pulse * (reducedMotion.matches ? 0.09 : 0.45);
      node.vx += node.dx * push;
      node.vy += node.dy * push;
    }
  }
  spawnNode(state.features);
}

function spawnNode(features) {
  // Restore the spectral plane: centroid and spread on diagonal axes.
  // A slowly changing noise field separates repeated spectra without a loop.
  const t = state.time * 0.35;
  const { flowSeed } = state;
  const x = (features.x - features.y) * Math.SQRT1_2 * 0.9;
  const y = (features.x + features.y) * Math.SQRT1_2 * 0.8;
  state.nodes.push({
    x,
    y,
    z: (features.tilt - 0.5) * 1.3 + (noise(flowSeed.z + t) - 0.5) * 0.3,
    dx: (noise(flowSeed.x + t) - 0.5) * 0.4 + random(-0.45, 0.45),
    dy: (noise(flowSeed.y + t) - 0.5) * 0.4 + random(-0.45, 0.45),
    vx: random(-0.025, 0.025),
    vy: random(-0.025, 0.025),
    seedX: random(1000),
    seedY: random(1000),
    hue: features.hue,
    level: features.level,
    onset: features.onset,
    group: state.group,
    age: 0,
  });
  if (state.nodes.length > CONFIG.nodes.maxCount) state.nodes.shift();
}

function updateNodes(dt) {
  const motion = reducedMotion.matches ? 0.2 : 1;
  const t = state.time * 0.3;
  for (const node of state.nodes) {
    node.age += dt;
    const flow = (0.11 + state.level * 0.08) * motion;
    node.vx = smooth(node.vx, (noise(node.seedX + t) - 0.5) * flow, 0.7, dt);
    node.vy = smooth(node.vy, (noise(node.seedY + t) - 0.5) * flow, 0.7, dt);
    node.dx += node.vx * dt;
    node.dy += node.vy * dt;
  }
  state.nodes = state.nodes.filter((node) => node.age < CONFIG.nodes.lifetime);
  // Gentle local separation replaces the forced spiral with free movement.
  for (let i = 0; i < state.nodes.length; i++) {
    for (let j = i + 1; j < state.nodes.length; j++) {
      const a = state.nodes[i],
        b = state.nodes[j];
      const dx = a.x + a.dx - b.x - b.dx;
      const dy = a.y + a.dy - b.y - b.dy;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.001 || distance > 0.15) continue;
      const push = (1 - distance / 0.15) * 0.07 * dt * motion;
      a.dx += (dx / distance) * push;
      a.dy += (dy / distance) * push;
      b.dx -= (dx / distance) * push;
      b.dy -= (dy / distance) * push;
    }
  }
}

function updateRotation(dt) {
  if (state.drag.active) return;
  const speed = reducedMotion.matches ? 0.025 : CONFIG.scene.rotationSpeed;
  const drift = noise(state.flowSeed.z + state.time * 0.045) - 0.5;
  state.rotation.y += (speed * (0.6 + state.level * 0.4) + state.drag.vx) * dt;
  state.rotation.x = smooth(state.rotation.x, 0.3 + drift * 0.5, 5, dt);
  state.rotation.z = smooth(state.rotation.z, drift * 0.25, 6, dt);
  state.rotation.x += state.drag.vy * dt;
  state.drag.vx *= Math.exp(-dt / 0.3);
  state.drag.vy *= Math.exp(-dt / 0.3);
}

function projectNodes(dt) {
  const area = state.viewport;
  const points = state.nodes.map((node) =>
    projectPoint(
      {
        x: node.x + node.dx,
        y: node.y + node.dy,
        z: node.z,
      },
      state.rotation,
      CONFIG.scene.perspective,
    ),
  );
  const newest = state.nodes.at(-1);
  let centerX = 0,
    centerY = 0,
    weight = 0;
  points.forEach((point, i) => {
    const importance = Math.exp(-state.nodes[i].age / 1.2);
    centerX += point.x * importance;
    centerY += point.y * importance;
    weight += importance;
  });
  // Follow the newest sound gently; distant old points cannot jerk the view.
  centerX = weight ? centerX / weight : 0;
  centerY = weight ? centerY / weight : 0;
  const extentX = Math.max(
    0.55,
    ...points.map((point) => Math.abs(point.x - centerX)),
  );
  const extentY = Math.max(
    0.55,
    ...points.map((point) => Math.abs(point.y - centerY)),
  );
  const frame = state.camera.update(
    {
      x: centerX,
      y: centerY,
      scale: Math.min(
        area.width / (extentX * 2 + 0.65),
        area.height / (extentY * 2 + 0.65),
      ),
    },
    dt,
  );
  return points.map((point, i) => {
    const node = state.nodes[i];
    const inCurrent = node.group === state.group;
    const recent = Math.max(
      Math.max(0, 1 - node.age / 0.22),
      inCurrent ? Math.min(1, Math.max(0, (0.8 - node.age) / 0.35)) : 0,
    );
    const life = Math.max(0, 1 - node.age / CONFIG.nodes.lifetime);
    const alpha = (0.5 + recent * 0.5) * life ** 1.8;
    return {
      ...point,
      sx: area.x + (point.x - frame.x) * frame.scale,
      sy: area.y + (point.y - frame.y) * frame.scale,
      radius:
        (6 + node.level * 9 + (node.onset ? 2 : 0)) *
        point.scale *
        Math.min(1.2, frame.scale / 180) *
        (0.5 + recent * 0.5),
      alpha,
      recent,
      latest: node === newest,
    };
  });
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
        1 - distance / (state.viewport.width * 0.7),
      );
      const highlight = Math.min(a.recent, b.recent);
      const alpha =
        Math.min(a.alpha, b.alpha) * closeness * (gap === 1 ? 65 : 24);
      stroke(node.hue, 25 * (1 - highlight), 92, alpha);
      strokeWeight(0.5 + highlight * 0.55);
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
    const { node, sx, sy, radius, alpha, recent, latest } = point;
    if (alpha < 0.008) continue;
    if (recent > 0.01) {
      const context = drawingContext;
      context.save();
      const glow = context.createRadialGradient(
        sx,
        sy,
        0,
        sx,
        sy,
        radius * 2.8,
      );
      glow.addColorStop(
        0,
        `hsla(${node.hue}, 15%, 90%, ${alpha * recent * 0.18})`,
      );
      glow.addColorStop(1, `hsla(${node.hue}, 15%, 90%, 0)`);
      context.fillStyle = glow;
      context.fillRect(
        sx - radius * 2.8,
        sy - radius * 2.8,
        radius * 5.6,
        radius * 5.6,
      );
      context.restore();
    }
    // White current sound, small translucent colored history.
    noFill();
    stroke(node.hue, 70 * (1 - recent), 100, alpha * 100);
    strokeWeight(latest ? 2.2 : 0.55 + recent * 1.1);
    rect(sx, sy, radius * 2, radius * 2);
    noStroke();
    fill(node.hue, 80 * (1 - recent), 100, alpha * 100);
    circle(
      sx,
      sy,
      latest ? Math.max(4, radius * 0.28) : Math.max(1.5, radius * 0.2),
    );
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
  const previous = state.viewport;
  const controls = document.querySelector('.controls').getBoundingClientRect();
  state.viewport = sceneViewport({
    width,
    height,
    controlsTop: controls.top,
    controlsLeft: controls.left,
  });
  if (previous) {
    state.camera.rescale(
      Math.min(state.viewport.width, state.viewport.height) /
        Math.min(previous.width, previous.height),
    );
  }
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
  state.group = 0;
  state.level = 0;
  state.camera.reset();
}

// p5 global mode discovers lifecycle callbacks on window.
Object.assign(window, { setup, draw, keyPressed, windowResized });
