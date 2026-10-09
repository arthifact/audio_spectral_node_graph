import { AudioPlayer } from './audio.js';
import { buildUI } from './ui.js';
import { ViewportFrame } from './viewport.js';
import CONFIG from './config.js';
import { AdaptiveAnalysis, normalizedSpectrum } from './adaptive.js';
import { SmoothCamera } from './camera.js';
import { isHighlighted, nodeRenderOrder } from './rendering.js';
import {
  bandEnergy,
  melEnergies,
  spectralCentroid,
  spectralSpread,
  spectralTilt,
} from './spectral.js';

// ═══════════════════════════════════════════════════════════════
// SPATIO-TEMPORAL SPECTRAL NODE GRAPH
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// GLOBAL STATE
// ─────────────────────────────────────────────────────────────

const state = {
  fft: null,
  amp: null,
  analysis: new AdaptiveAnalysis(),
  analysisElapsed: 0,
  features: { active: false, level: 0 },
  camera: new SmoothCamera({
    panSpeed: 100,
    maxZoomRate: 0.4,
    panInPixels: true,
  }),
  frame: new ViewportFrame(),

  liveSpectrum: null,
  liveCentroid: 0,
  liveSpread: 0,
  liveRMS: 0,
  liveFlux: 0,

  nodes: [],
  framesSinceSpawn: 0,
  currentBurst: 0,
  unclutterSlots: new Map(),

  bounds: {
    centroid: { min: 0.3, max: 0.7 },
    spread: { min: 0.1, max: 0.4 },
    tilt: { min: 0.3, max: 0.7 },
  },

  rotation: { y: 0, x: 0.28, z: 0, wobbleT: 0 },
  focal: { current: 300, targetSmoothed: 300 },
  pan: {
    x: 0,
    y: 0,
    prevCenterX: 0,
    prevCenterY: 0,
    velocityX: 0,
    velocityY: 0,
  },
  burstBBox: {
    minX: null,
    maxX: null,
    minY: null,
    maxY: null,
    initialized: false,
  },
  bass: { pulse: 0, base: 0, shockPulse: 0, rmsSmooth: 0 },
  shake: { x: 0, y: 0, z: 0 },
  trip: { depth: 0.28, target: 0.28, timer: 110 },
  drag: {
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
    velocityY: 0,
    velocityX: 0,
  },
  stars: [],
  noiseSeeds: { y: 0, x: 0, z: 0 },
  director: {
    panDriftX: 0,
    panDriftY: 0,
    targetDriftX: 0,
    targetDriftY: 0,
    wanderTimer: 0,
    burstKick: 0,
    zoomKick: 0,
  },
  music: { bassRise: 0, melodyDrive: 0, boom: 0, prevCentroid: 0 },
};

// ═══════════════════════════════════════════════════════════════
// MAIN LIFECYCLE
// ═══════════════════════════════════════════════════════════════

let player;
let ui;

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent('visualizer');
  canvas.elt.setAttribute(
    'aria-label',
    'Animated spectral graph of your audio',
  );
  colorMode(HSB, 360, 100, 100, 100);
  textFont('monospace');
  state.fft = new p5.FFT(0.85, CONFIG.audio.fftBins);
  state.amp = new p5.Amplitude();
  initStars();
  initNoiseSeeds();
  player = new AudioPlayer({
    fft: state.fft,
    amplitude: state.amp,
    onChange: () => ui?.update(),
    onReset: resetAudioState,
  });
  ui = buildUI({ player, clear: resetAudioState, toggleFullscreen });
  ui.update();
}

function initStars() {
  for (let i = 0; i < CONFIG.display.starCount; i++) {
    state.stars.push({
      x: random(width),
      y: random(height),
      r: random(0.5, 2.0),
    });
  }
}

function initNoiseSeeds() {
  state.noiseSeeds.y = random(1000);
  state.noiseSeeds.x = random(1000);
  state.noiseSeeds.z = random(1000);
}

// ──────────────────────────────────────────────────────────
// DRAW LOOP
// ──────────────────────────────────────────────────────────

function draw() {
  const bgAlpha = map(constrain(state.bass.pulse, 0, 1.2), 0, 1.2, 88, 68);
  background(0, 0, 2, bgAlpha);

  const panReturnLerp = secondsToLerp(CONFIG.camera.panReturnTimeSec);
  const zoomReturnLerp = secondsToLerp(CONFIG.camera.zoomReturnTimeSec);

  updateCameraRotation();
  drawStars();
  if (CONFIG.grid.enabled) drawReferenceGrid();
  drawFreqBar();

  if (player.isLoaded && player.isPlaying) {
    processAudio();
  } else {
    resetImmersionEffects();
  }

  updateDirectorState();
  updateNodeBounds();

  let projections = projectNodesToScreen();
  applyUnclutterOffsets(projections);
  // The original camera sets the destination; only its response is bounded.
  if (state.camera.scale === null) {
    state.camera.update(
      { x: state.pan.x, y: state.pan.y, scale: state.focal.current },
      0,
    );
  }
  updateCameraTracking(projections, zoomReturnLerp, panReturnLerp);
  const camera = state.camera.update(
    {
      x: state.pan.x,
      y: state.pan.y,
      scale: state.focal.current,
    },
    Math.min(deltaTime / 1000, 0.08),
  );
  state.pan.x = camera.x;
  state.pan.y = camera.y;
  state.focal.current = camera.scale;

  // Render the current camera, then contain every visible node, including history.
  projections = projectNodesToScreen();
  applyUnclutterOffsets(projections);
  projections = frameVisibleNodes(projections);
  const renderOrder = calculateRenderOrder(projections);
  drawEdges3D(projections);
  drawBurstBox(projections);
  drawAxisCross();
  drawNodes3D(renderOrder, projections);
  drawOrbitHint();
  drawReadoutPanel();
  drawVignette();

  applyRepulsion();
  updateNodeLifecycle();
}

function frameVisibleNodes(projections) {
  const header = document.querySelector('.app-header').getBoundingClientRect();
  const obstacles = [
    ...document.querySelectorAll('.controls, .help[open]'),
  ].map((element) => element.getBoundingClientRect());
  const framed = projections.map((point, i) => {
    const node = state.nodes[i];
    const current = isHighlighted(node, state.currentBurst);
    const life = constrain(1 - node.age / CONFIG.nodes.fadeFrames, 0, 1);
    const sizeMult = current ? 1 : pow(life, 0.65);
    const depthFade = constrain(map(point.depth, -500, 300, 0.45, 1), 0.35, 1);
    const alpha = current ? 95 * depthFade : pow(life, 1.6) * 85 * depthFade;
    return {
      ...point,
      visible: alpha >= 1.5 && sizeMult >= 0.05,
      // Include the solid square and labels; faint outer halos may cross the inset.
      radius: node.sz * point.sc * sizeMult * 0.5 + 21 * point.sc,
    };
  });
  return state.frame.update(
    framed,
    { width, height, top: Math.max(55, header.bottom + 20), obstacles },
    Math.min(deltaTime / 1000, 0.08),
  );
}

function resetImmersionEffects() {
  state.bass.pulse = lerp(state.bass.pulse, 0, 0.06);
  state.bass.shockPulse = lerp(state.bass.shockPulse, 0, 0.08);
  state.trip.depth = lerp(state.trip.depth, 0.28, 0.02);
  state.trip.target = lerp(state.trip.target, 0.28, 0.03);
  state.trip.timer = max(0, state.trip.timer - 1);
  state.shake.x = lerp(state.shake.x, 0, 0.1);
  state.shake.y = lerp(state.shake.y, 0, 0.1);
  state.shake.z = lerp(state.shake.z, 0, 0.1);
  state.director.burstKick = lerp(state.director.burstKick, 0, 0.12);
  state.director.zoomKick = lerp(state.director.zoomKick, 0, 0.08);
}

function updateNodeLifecycle() {
  state.nodes = state.nodes.filter((n) => {
    n.age += Math.min(deltaTime / 1000, 0.08) * 60;
    applyNodeFlowDrift(n);
    n.dx += n.vx;
    n.dy += n.vy;
    return n.age < CONFIG.nodes.fadeFrames + 20;
  });
}

// ═══════════════════════════════════════════════════════════════
// CAMERA CONTROL
// ═══════════════════════════════════════════════════════════════

function updateCameraRotation() {
  const { drag, rotation } = state;
  if (!drag.isDragging) {
    rotation.y += drag.velocityY;
    rotation.x += drag.velocityX;
    drag.velocityY *= CONFIG.input.dragFriction;
    drag.velocityX *= CONFIG.input.dragFriction;
    if (
      abs(drag.velocityY) < CONFIG.input.dragThreshold &&
      abs(drag.velocityX) < CONFIG.input.dragThreshold
    ) {
      applyWobbleRotation();
    }
  }
}

function applyWobbleRotation() {
  const { rotation, noiseSeeds } = state;
  const cfg = CONFIG.wobble;
  rotation.wobbleT += cfg.speed;

  const spinSpeed =
    cfg.yawSpeed +
    sin(rotation.wobbleT * 0.23) * cfg.yawVariation +
    (noise(rotation.wobbleT * 0.03 + noiseSeeds.y) - 0.5) * 0.0032;
  rotation.y += spinSpeed;

  const pitchSpeed =
    cfg.pitchSpeed +
    sin(rotation.wobbleT * 0.17) * cfg.pitchVariation +
    sin(rotation.wobbleT * 0.39) * cfg.pitchSecondary +
    (noise(rotation.wobbleT * 0.025 + noiseSeeds.x) - 0.5) * 0.0026;
  rotation.x += pitchSpeed;

  rotation.z =
    sin(rotation.wobbleT * 0.08) * cfg.rollSwing +
    sin(rotation.wobbleT * 0.19) * cfg.rollSecondary +
    (noise(rotation.wobbleT * 0.02 + noiseSeeds.z) - 0.5) * 0.06;
}

function updateCameraTracking(proj, zoomReturnLerp, panReturnLerp) {
  const now =
    state.nodes.length > 0 ? state.nodes[state.nodes.length - 1].tSec : 0;
  const win = CONFIG.camera.trackWindowSec;
  const trackIdx = [];
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (n.burstId === state.currentBurst || now - n.tSec < win)
      trackIdx.push(i);
  }
  if (trackIdx.length < 1) {
    resetCameraTracking(zoomReturnLerp, panReturnLerp);
    return;
  }
  updateBurstBBox(trackIdx, proj);
  doCameraZoom();
  doCameraPan(proj, trackIdx);
}

function updateBurstBBox(indices, proj) {
  const bbox = state.burstBBox;
  let bMinX = 1e9,
    bMaxX = -1e9,
    bMinY = 1e9,
    bMaxY = -1e9;
  for (const i of indices) {
    const p = proj[i];
    const half = constrain(state.nodes[i].sz * p.sc * 0.5, 10, 60);
    bMinX = min(bMinX, p.sx - half);
    bMaxX = max(bMaxX, p.sx + half);
    bMinY = min(bMinY, p.sy - half);
    bMaxY = max(bMaxY, p.sy + half);
  }
  if (!bbox.initialized) {
    bbox.minX = bMinX;
    bbox.maxX = bMaxX;
    bbox.minY = bMinY;
    bbox.maxY = bMaxY;
    bbox.initialized = true;
  } else {
    bbox.minX =
      bMinX < bbox.minX
        ? lerp(bbox.minX, bMinX, 0.15)
        : lerp(bbox.minX, bMinX, 0.04);
    bbox.maxX =
      bMaxX > bbox.maxX
        ? lerp(bbox.maxX, bMaxX, 0.15)
        : lerp(bbox.maxX, bMaxX, 0.04);
    bbox.minY =
      bMinY < bbox.minY
        ? lerp(bbox.minY, bMinY, 0.15)
        : lerp(bbox.minY, bMinY, 0.04);
    bbox.maxY =
      bMaxY > bbox.maxY
        ? lerp(bbox.maxY, bMaxY, 0.15)
        : lerp(bbox.maxY, bMaxY, 0.04);
  }
}

function doCameraZoom() {
  const bbox = state.burstBBox;
  const bw = bbox.maxX - bbox.minX;
  const bh = bbox.maxY - bbox.minY;
  const marginW = width * 0.1;
  const marginH = height * 0.1;
  const scaleNeeded = max(bw / marginW, bh / marginH, 0.6);
  let targetFocal = constrain(CONFIG.camera.focalBase / scaleNeeded, 230, 1050);
  const tripMul = lerp(
    CONFIG.immersion.tripFarMul,
    CONFIG.immersion.tripNearMul,
    state.trip.depth,
  );
  const tripBreath =
    1 +
    sin(frameCount * 0.016 + state.rotation.wobbleT * 0.6) *
      (0.03 + state.trip.depth * 0.05);
  targetFocal = constrain(
    targetFocal * tripMul * tripBreath - state.director.zoomKick,
    210,
    1220,
  );
  const focalSmoothLerp = lerp(
    0.06,
    0.2,
    constrain(state.bass.rmsSmooth * 4.0, 0, 1),
  );
  state.focal.targetSmoothed = lerp(
    state.focal.targetSmoothed,
    targetFocal,
    focalSmoothLerp,
  );
  state.focal.current = state.focal.targetSmoothed;
}

function doCameraPan(proj, indices) {
  const { pan, nodes } = state;
  const bbox = state.burstBBox;
  const cfg = CONFIG.camera;
  let cx = 0,
    cy = 0,
    totalWeight = 0;
  for (const i of indices) {
    const age01 = constrain(1 - nodes[i].age / CONFIG.nodes.fadeFrames, 0, 1);
    const weight = age01 * age01;
    cx += proj[i].sx * weight;
    cy += proj[i].sy * weight;
    totalWeight += weight;
  }
  if (totalWeight > 0) {
    cx /= totalWeight;
    cy /= totalWeight;
  } else {
    cx = width / 2;
    cy = height / 2;
  }
  pan.velocityX = lerp(pan.velocityX, cx - pan.prevCenterX, 0.1);
  pan.velocityY = lerp(pan.velocityY, cy - pan.prevCenterY, 0.1);
  pan.prevCenterX = cx;
  pan.prevCenterY = cy;
  const bw = bbox.maxX - bbox.minX;
  const bh = bbox.maxY - bbox.minY;
  const compact01 =
    1 - constrain(max(bw / (width * 0.55), bh / (height * 0.55)), 0, 1);
  const leadX = cx + pan.velocityX * 6;
  const leadY = cy + pan.velocityY * 6;
  const boxCX = (bbox.minX + bbox.maxX) * 0.5;
  const boxCY = (bbox.minY + bbox.maxY) * 0.5;
  const trackX = lerp(leadX, boxCX, compact01 * 0.8);
  const trackY = lerp(leadY, boxCY, compact01 * 0.9);
  const guardPad = lerp(cfg.maxGuardPad, cfg.minGuardPad, compact01);
  const safePadX = width * guardPad;
  const safePadY = height * guardPad;
  let keepX = 0,
    keepY = 0;
  const overL = safePadX - bbox.minX;
  const overR = bbox.maxX - (width - safePadX);
  const overT = safePadY - bbox.minY;
  const overB = bbox.maxY - (height - safePadY);
  if (overL > 0 && overR > 0)
    keepX = width * 0.5 - (bbox.minX + bbox.maxX) * 0.5;
  else if (overL > 0) keepX = overL * cfg.edgeRecoveryStrength;
  else if (overR > 0) keepX = -overR * cfg.edgeRecoveryStrength;
  if (overT > 0 && overB > 0)
    keepY = height * 0.5 - (bbox.minY + bbox.maxY) * 0.5;
  else if (overT > 0) keepY = overT * cfg.edgeRecoveryStrength;
  else if (overB > 0) keepY = -overB * cfg.edgeRecoveryStrength;
  const panGainX = lerp(0.55, 0.82, compact01);
  const panGainY = lerp(0.55, 0.82, compact01);
  const panTargetX = (width * 0.5 - trackX) * panGainX + keepX;
  const panTargetY = (height * 0.5 - trackY) * panGainY + keepY;
  const directedX =
    pan.x +
    panTargetX +
    state.director.panDriftX * 0.45 +
    state.director.burstKick * 0.55;
  const directedY =
    pan.y +
    panTargetY +
    state.director.panDriftY * 0.45 +
    state.director.burstKick * 0.16;
  pan.x = directedX;
  pan.y = directedY;
  pan.x = constrain(pan.x, -width * cfg.maxPanRangeX, width * cfg.maxPanRangeX);
  pan.y = constrain(
    pan.y,
    -height * cfg.maxPanRangeY,
    height * cfg.maxPanRangeY,
  );
}

function resetCameraTracking(zoomReturnLerp, panReturnLerp) {
  state.focal.current = lerp(
    state.focal.current,
    CONFIG.camera.focalStartFar,
    zoomReturnLerp * 0.75,
  );
  state.focal.targetSmoothed = lerp(
    state.focal.targetSmoothed,
    CONFIG.camera.focalStartFar,
    zoomReturnLerp * 0.4,
  );
  state.pan.x = lerp(state.pan.x, 0, panReturnLerp);
  state.pan.y = lerp(state.pan.y, 0, panReturnLerp);
}

// ═══════════════════════════════════════════════════════════════
// DIRECTOR & COMPOSITION
// ═══════════════════════════════════════════════════════════════

function updateDirectorState() {
  const d = state.director;
  const cfg = CONFIG.director;
  d.wanderTimer--;
  if (d.wanderTimer <= 0) {
    d.targetDriftX = random(-cfg.wanderRangeX, cfg.wanderRangeX) * width;
    d.targetDriftY = random(-cfg.wanderRangeY, cfg.wanderRangeY) * height;
    d.wanderTimer = floor(random(cfg.wanderMinFrames, cfg.wanderMaxFrames));
  }
  const energy = constrain(
    state.bass.pulse * 0.55 +
      state.bass.rmsSmooth * 1.8 +
      state.music.melodyDrive * 0.75,
    0,
    1,
  );
  const driftLerp = lerp(0.018, 0.05, energy);
  d.panDriftX = lerp(d.panDriftX, d.targetDriftX, driftLerp);
  d.panDriftY = lerp(d.panDriftY, d.targetDriftY, driftLerp * 0.92);
  d.burstKick *= 0.93;
  d.zoomKick *= 0.94;
}

function onBurstTransition(fluxVal) {
  const strength = constrain(
    map(fluxVal, CONFIG.spectral.fluxThreshold, 0.22, 0.3, 1.0),
    0.3,
    1.0,
  );
  state.director.burstKick += random(
    -CONFIG.director.burstKickPan * strength,
    CONFIG.director.burstKickPan * strength,
  );
  state.director.zoomKick += CONFIG.director.burstKickZoom * strength;
  state.director.wanderTimer = 0;
}

function computeScenePad() {
  const energy = constrain(
    state.bass.pulse * 0.65 + state.bass.rmsSmooth * 2.0,
    0,
    1,
  );
  return lerp(
    CONFIG.composition.padRelaxed,
    CONFIG.composition.padIntense,
    energy,
  );
}

function applyNebulaWarp(nx, ny, node) {
  const t = frameCount * 0.0035;
  const pulse = constrain(state.bass.pulse, 0, 1.2);
  const melodyBoost = state.music.melodyDrive * CONFIG.magic.melodyWarpBoost;
  const warp =
    CONFIG.composition.warpAmount +
    pulse * CONFIG.composition.warpBreath +
    melodyBoost;
  const n1 = noise(node.seedA + t, node.seedB * 0.5 + t * 0.7) - 0.5;
  const n2 = noise(node.seedB + t * 0.8, node.seedA * 0.4 + t) - 0.5;
  return { x: nx + n1 * width * warp, y: ny + n2 * height * warp * 0.82 };
}

function applyNodeFlowDrift(node) {
  const cfg = CONFIG.flow;
  const t = frameCount * cfg.driftNoiseSpeed;
  const melodyBoost =
    1 + state.music.melodyDrive * CONFIG.magic.melodyDriftBoost;
  const burstBoost =
    node.burstId === state.currentBurst
      ? cfg.driftBurstBoost * melodyBoost
      : melodyBoost;
  const nx = noise(node.seedA + t, node.seedB + t * 0.6) - 0.5;
  const ny = noise(node.seedB + t * 0.9, node.seedA + t * 0.4) - 0.5;
  node.vx += nx * cfg.driftAccel * burstBoost;
  node.vy += ny * cfg.driftAccel * burstBoost;
  node.vx *= cfg.driftDamping;
  node.vy *= cfg.driftDamping;
  node.vx = constrain(node.vx, -cfg.driftMaxVel, cfg.driftMaxVel);
  node.vy = constrain(node.vy, -cfg.driftMaxVel, cfg.driftMaxVel);
  if (node.burstId === state.currentBurst && state.music.boom > 0.01) {
    const ox = node.dx,
      oy = node.dy;
    const d = max(1, sqrt(ox * ox + oy * oy));
    const boomPush = state.music.boom * CONFIG.magic.boomOutwardForce;
    node.vx += (ox / d) * boomPush;
    node.vy += (oy / d) * boomPush;
  }
}

function applyUnclutterOffsets(proj) {
  const { nodes, currentBurst } = state;
  const cfg = CONFIG.spectral;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.burstId !== currentBurst) continue;
    const slot = n.unclutterSlot || 0;
    const seed = n.unclutterSeed || 0;
    const radius =
      min(cfg.unclutterMaxPx, sqrt(slot) * cfg.unclutterStepPx) *
      cfg.unclutterStrength;
    if (radius <= 0) continue;
    const angle = slot * 2.39996323 + seed;
    proj[i].sx += cos(angle) * radius;
    proj[i].sy += sin(angle) * radius * 0.88;
  }
}

// ═══════════════════════════════════════════════════════════════
// AUDIO ANALYSIS & NODE SPAWNING
// ═══════════════════════════════════════════════════════════════

function processAudio() {
  const dt = Math.min(deltaTime / 1000, 0.08);
  state.analysisElapsed += dt;
  const rms = state.amp.getLevel();
  if (state.analysisElapsed >= 0.05) {
    const adaptiveSpectrum = normalizedSpectrum(state.fft.analyze('dB'));
    const spectrum = state.fft.analyze();
    state.features = state.analysis.update({
      spectrum: adaptiveSpectrum,
      rms,
      sampleRate: getAudioContext().sampleRate,
      dt: state.analysisElapsed,
    });
    state.analysisElapsed = 0;
    // Preserve the original spectrum mapping, with a fallback below its floor.
    state.liveSpectrum = spectrum.some((value) => value > 0)
      ? spectrum
      : adaptiveSpectrum;
    state.liveCentroid = spectralCentroid(state.liveSpectrum);
    state.liveSpread = spectralSpread(state.liveSpectrum, state.liveCentroid);
    state.liveFlux = state.features.flux || 0;
    if (state.features.onset) {
      state.currentBurst++;
      onBurstTransition(state.liveFlux);
    }
  }
  state.liveRMS = rms;
  if (!state.liveSpectrum) return;
  // Keep the original RMS response, with a visual floor for quiet recordings.
  const visualRMS = Math.max(rms, state.features.level * 0.08);
  updateImmersionState(state.liveSpectrum, visualRMS, state.liveCentroid);
  spawnNodesFromAudio(state.liveSpectrum, state.liveCentroid, visualRMS);
}

function spawnNodesFromAudio(spectrum, centroid, rms) {
  state.framesSinceSpawn++;
  if (
    state.framesSinceSpawn < CONFIG.audio.spawnEvery ||
    !state.features.active
  )
    return;
  const mel = melEnergies(spectrum, {
    bands: CONFIG.audio.melBands,
    maxFreq: CONFIG.audio.maxFreq,
    sampleRate: getAudioContext().sampleRate,
  });
  spawnNode(mel, centroid, state.liveSpread, rms, player.sound.currentTime());
  state.framesSinceSpawn = 0;
}

function updateImmersionState(spec, rms, centroid) {
  const rmsLerp =
    rms > state.bass.rmsSmooth
      ? CONFIG.audio.rmsAttack
      : CONFIG.audio.rmsRelease;
  state.bass.rmsSmooth = lerp(state.bass.rmsSmooth, rms, rmsLerp);
  const bass = bandEnergy(spec, 26, 170, getAudioContext().sampleRate);
  const mid = bandEnergy(spec, 220, 2200, getAudioContext().sampleRate);
  const high = bandEnergy(spec, 2200, 7600, getAudioContext().sampleRate);
  const centroidDelta = abs(centroid - state.music.prevCentroid);
  state.music.prevCentroid = centroid;
  const melodyTarget = constrain(
    mid * 1.0 + high * 0.85 + centroidDelta * 2.2,
    0,
    1.25,
  );
  const melodyLerp =
    melodyTarget > state.music.melodyDrive
      ? CONFIG.magic.melodyAttack
      : CONFIG.magic.melodyRelease;
  state.music.melodyDrive = lerp(
    state.music.melodyDrive,
    melodyTarget,
    melodyLerp,
  );
  state.bass.base = lerp(state.bass.base, bass, 0.03);
  const rise = max(0, bass - state.bass.base * 0.97);
  state.music.bassRise = lerp(state.music.bassRise, rise, 0.24);
  state.bass.shockPulse = lerp(state.bass.shockPulse, rise * 2.3, 0.12);
  state.bass.shockPulse *= 0.95;
  if (
    rise > CONFIG.magic.boomRiseThreshold &&
    bass > CONFIG.magic.boomBassThreshold
  ) {
    state.music.boom = max(state.music.boom, CONFIG.magic.boomKick);
  }
  state.music.boom *= CONFIG.magic.boomDecay;
  const targetPulse = constrain(
    bass * 1.1 + state.bass.rmsSmooth * 0.8 + state.bass.shockPulse,
    0,
    1.2,
  );
  state.bass.pulse = lerp(state.bass.pulse, targetPulse, 0.11);
  const t = frameCount * 0.035;
  const sway = state.bass.pulse * state.bass.pulse;
  state.shake.x = lerp(state.shake.x, sin(t * 1.6) * 10 * sway, 0.11);
  state.shake.y = lerp(state.shake.y, cos(t * 1.2) * 8 * sway, 0.11);
  state.shake.z = lerp(state.shake.z, sin(t * 2.0 + 1.8) * 0.012 * sway, 0.1);
  updateTripState(rms);
}

function updateTripState(rms) {
  const cfg = state.trip;
  cfg.timer--;
  if (cfg.timer <= 0) {
    const goNear =
      random() < 0.45 + constrain(state.bass.shockPulse * 0.8, 0, 0.3);
    cfg.target = goNear ? random(0.7, 1.0) : random(0.05, 0.34);
    cfg.timer = floor(random(110, 270));
  }
  if (state.bass.shockPulse > 0.13 && random() < 0.2) {
    cfg.target = min(1, cfg.target + random(0.18, 0.38));
    cfg.timer = max(cfg.timer, 70);
  }
  if (rms < 0.02 && state.bass.pulse < 0.12 && random() < 0.03) {
    cfg.target = max(0.05, cfg.target - random(0.08, 0.2));
  }
  cfg.depth = lerp(cfg.depth, cfg.target, 0.022 + state.bass.shockPulse * 0.04);
}

function spawnNode(mel, centroid, spread, rms, tSec) {
  const hue = map(centroid, 0, 1, 0, 260);
  const sz = map(rms, 0, 0.45, 22, 90);
  const cBin = floor(
    constrain(centroid, 0, 0.9999) * CONFIG.spectral.unclutterCBins,
  );
  const sBin = floor(
    constrain(spread, 0, 0.9999) * CONFIG.spectral.unclutterSBins,
  );
  const unclutterKey = cBin + '|' + sBin;
  const unclutterSlot = state.unclutterSlots.get(unclutterKey) || 0;
  state.unclutterSlots.set(unclutterKey, unclutterSlot + 1);
  const tilt = spectralTilt(mel);
  const node = {
    dx: random(-100, 100),
    dy: random(-100, 100),
    vx: random(-0.35, 0.35),
    vy: random(-0.25, 0.25),
    hue,
    sz,
    rms,
    centroid,
    spread,
    tilt,
    mel,
    tSec,
    unclutterSeed: (cBin * 0.37 + sBin * 0.73) % (Math.PI * 2),
    unclutterSlot,
    burstId: state.currentBurst,
    seedA: random(1000),
    seedB: random(1000),
    t: tSec.toFixed(2),
    age: 0,
  };
  state.nodes.push(node);
  if (state.nodes.length > CONFIG.nodes.maxCount) state.nodes.shift();
}

// ═══════════════════════════════════════════════════════════════
// NODE BOUNDS & 3D PROJECTION
// ═══════════════════════════════════════════════════════════════

function updateNodeBounds() {
  const { nodes, bounds } = state;
  if (nodes.length === 0) return;
  let cMinT = 1e9,
    cMaxT = -1e9,
    sMinT = 1e9,
    sMaxT = -1e9,
    tMinT = 1e9,
    tMaxT = -1e9;
  for (const n of nodes) {
    cMinT = min(cMinT, n.centroid);
    cMaxT = max(cMaxT, n.centroid);
    sMinT = min(sMinT, n.spread);
    sMaxT = max(sMaxT, n.spread);
    tMinT = min(tMinT, n.tilt);
    tMaxT = max(tMaxT, n.tilt);
  }
  const lf = nodes.length === 1 ? 1.0 : nodes.length < 8 ? 0.4 : 0.025;
  if (nodes.length === 1) {
    const pad = 0.05;
    cMinT -= pad;
    cMaxT += pad;
    sMinT -= pad;
    sMaxT += pad;
  }
  bounds.centroid.min = lerp(bounds.centroid.min, cMinT, lf);
  bounds.centroid.max = lerp(bounds.centroid.max, cMaxT, lf);
  bounds.spread.min = lerp(bounds.spread.min, sMinT, lf);
  bounds.spread.max = lerp(bounds.spread.max, sMaxT, lf);
  bounds.tilt.min = lerp(bounds.tilt.min, tMinT, lf);
  bounds.tilt.max = lerp(bounds.tilt.max, tMaxT, lf);
}

function projectNodesToScreen() {
  const { nodes, bounds, currentBurst } = state;
  const tMaxCur = nodes.length > 0 ? nodes[nodes.length - 1].tSec : 1;
  const tMinWin = tMaxCur - CONFIG.display.windowSeconds;
  const pad = computeScenePad();
  return nodes.map((n) => {
    const cRange = max(bounds.centroid.max - bounds.centroid.min, 0.02);
    const sRange = max(bounds.spread.max - bounds.spread.min, 0.02);
    const tRange = max(bounds.tilt.max - bounds.tilt.min, 0.01);
    const cn = (n.centroid - bounds.centroid.min) / cRange;
    const sn = (n.spread - bounds.spread.min) / sRange;
    const r2 = 0.7071;
    const rx = (cn - sn) * r2;
    const ry = (cn + sn) * r2;
    let nx = map(rx, -1, 1, width * pad, width * (1 - pad)) + n.dx;
    let ny = map(ry, 0, 2, height * pad, height * (1 - pad)) + n.dy;
    const warped = applyNebulaWarp(nx, ny, n);
    nx = warped.x;
    ny = warped.y;
    const inFramePadX = width * max(0.012, pad * 0.55);
    const inFramePadY = height * max(0.012, pad * 0.55);
    nx = constrain(nx, inFramePadX, width - inFramePadX);
    ny = constrain(ny, inFramePadY, height - inFramePadY);
    let z = map(
      n.tilt,
      bounds.tilt.min,
      bounds.tilt.min + tRange,
      -CONFIG.camera.depth * 0.9,
      CONFIG.camera.depth * 0.9,
    );
    if (n.burstId === currentBurst) z += map(n.tSec, tMinWin, tMaxCur, -50, 50);
    z = constrain(z, -CONFIG.camera.depth * 0.95, CONFIG.camera.depth * 0.95);
    return project3D(nx, ny, z);
  });
}

function project3D(nx, ny, z) {
  const { rotation, focal, pan, shake } = state;
  const cx = width / 2,
    cy = height / 2;
  const rx = nx - cx,
    ry = ny - cy;
  const cosY = cos(rotation.y + shake.z),
    sinY = sin(rotation.y + shake.z);
  const rx2 = rx * cosY - z * sinY,
    z2 = rx * sinY + z * cosY;
  const cosX = cos(rotation.x),
    sinX = sin(rotation.x);
  const ry2 = ry * cosX - z2 * sinX,
    z3 = ry * sinX + z2 * cosX;
  const cosZ = cos(rotation.z),
    sinZ = sin(rotation.z);
  const rx3 = rx2 * cosZ - ry2 * sinZ,
    ry3 = rx2 * sinZ + ry2 * cosZ;
  const zSafe = max(z3, -focal.current * CONFIG.camera.nearZRatio);
  let scale = focal.current / (focal.current + zSafe + CONFIG.camera.nearBias);
  scale = constrain(scale, 0.2, CONFIG.camera.maxScale);
  return {
    sx: cx + rx3 * scale + pan.x + shake.x,
    sy: cy + ry3 * scale + pan.y + shake.y,
    sc: scale,
    depth: z3,
  };
}

function calculateRenderOrder(projections) {
  return nodeRenderOrder(state.nodes, projections, state.currentBurst);
}

// ═══════════════════════════════════════════════════════════════
// ATMOSPHERIC DEPTH HELPERS
// ═══════════════════════════════════════════════════════════════

function depthFog(zDepth) {
  return constrain(
    map(zDepth, CONFIG.atmosphere.fogNear, CONFIG.atmosphere.fogFar, 0, 1),
    0,
    1,
  );
}

function atmosphericAdjust(zDepth) {
  const fog = depthFog(zDepth);
  return {
    satLoss: fog * CONFIG.atmosphere.maxDesaturation,
    briLoss: fog * CONFIG.atmosphere.maxBrightnessDrop,
  };
}

// ═══════════════════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════════════════

function drawEdges3D(projections) {
  const K = 6,
    DMAX = 520,
    WIN = 120;
  for (let i = max(0, state.nodes.length - WIN); i < state.nodes.length; i++) {
    const pa = projections[i];
    const n = state.nodes[i];
    const isCurrent = isHighlighted(n, state.currentBurst);
    const life = constrain(1 - n.age / CONFIG.nodes.fadeFrames, 0, 1);
    for (let j = max(0, i - K); j < i; j++) {
      const pb = projections[j];
      const nb = state.nodes[j];
      const d = dist(pa.sx, pa.sy, pb.sx, pb.sy);
      if (d > DMAX) continue;
      const avgDepth = (pa.depth + pb.depth) / 2;
      const depthFade = constrain(map(avgDepth, -500, 300, 0.3, 1.0), 0.2, 1.0);
      const atmo = atmosphericAdjust(avgDepth);
      const sameBurst = n.burstId === nb.burstId && isCurrent;
      if (sameBurst) {
        const edgeHue = lerp(n.hue, nb.hue, 0.5);
        const edgeSat = max(8, 28 - atmo.satLoss * 0.4);
        stroke(
          edgeHue,
          edgeSat,
          max(60, 100 - atmo.briLoss),
          map(d, 0, DMAX, 90, 20) * depthFade,
        );
        strokeWeight(0.9);
      } else {
        stroke(
          0,
          0,
          max(40, 75 - atmo.briLoss),
          map(d, 0, DMAX, 35, 3) * life * depthFade,
        );
        strokeWeight(0.45);
      }
      line(pa.sx, pa.sy, pb.sx, pb.sy);
    }
  }
}

function drawNodes3D(renderOrder, projections) {
  const hlCfg = CONFIG.highlight;
  for (const idx of renderOrder) {
    const n = state.nodes[idx];
    const p = projections[idx];
    const isCurrent = isHighlighted(n, state.currentBurst);
    const life = constrain(1 - n.age / CONFIG.nodes.fadeFrames, 0, 1);
    const atmo = atmosphericAdjust(p.depth);
    const depthFade = constrain(map(p.depth, -500, 300, 0.45, 1.0), 0.35, 1.0);
    const sizeMult = isCurrent ? 1.0 : pow(life, 0.65);
    const alpha = isCurrent ? 95 * depthFade : pow(life, 1.6) * 85 * depthFade;
    if (alpha < 1.5 || sizeMult < 0.05) continue;
    const sz3 = constrain(n.sz * p.sc * sizeMult, 1, isCurrent ? 110 : 75);
    const nodeSat = isCurrent ? 0 : max(30, 70 - atmo.satLoss * 0.6);
    const nodeBri = max(55, 100 - atmo.briLoss);

    // ── BURST HIGHLIGHT (multi-layer glow + beacon — always visible) ──
    if (isCurrent) {
      for (let g = hlCfg.glowLayers - 1; g >= 0; g--) {
        const glowSize = sz3 * hlCfg.glowExpand[g];
        const effectiveSize = max(glowSize, 8 + g * 4);
        const glowWeight = max(hlCfg.minStrokeWeight, hlCfg.glowStroke[g]);
        noFill();
        stroke(
          n.hue,
          max(10, 50 - atmo.satLoss * 0.5),
          nodeBri,
          hlCfg.glowAlpha[g] * depthFade,
        );
        strokeWeight(glowWeight);
        rectMode(CENTER);
        rect(p.sx, p.sy, effectiveSize, effectiveSize);
      }
      noStroke();
      fill(n.hue, 30, 100, hlCfg.beaconAlpha * depthFade);
      const beaconR = max(hlCfg.beaconMinRadius, sz3 * 0.18);
      ellipse(p.sx, p.sy, beaconR * 2, beaconR * 2);
    }

    // ── Node square outline ──
    noFill();
    stroke(n.hue, nodeSat, nodeBri, alpha);
    strokeWeight(isCurrent ? 1.8 : max(0.2, 0.8 * sizeMult));
    rectMode(CENTER);
    rect(p.sx, p.sy, sz3, sz3);

    // ── Node center dot ──
    noStroke();
    fill(n.hue, max(50, 88 - atmo.satLoss * 0.5), nodeBri, alpha);
    ellipse(p.sx, p.sy, sz3 * 0.28, sz3 * 0.28);

    // ── Labels ──
    if (sz3 > 7 && (isCurrent || life > 0.3)) {
      drawNodeLabel(n, p, alpha, sz3, atmo);
    }
  }
}

function drawNodeLabel(n, p, alpha, sz3, atmo) {
  const fs = max(5, 7 * p.sc);
  const half = sz3 / 2;
  const labelBri = max(45, 92 - (atmo ? atmo.briLoss : 0));
  noStroke();
  textSize(fs);
  textAlign(RIGHT);
  fill(n.hue, 60, labelBri, alpha * 0.82);
  text(
    ((n.centroid * getAudioContext().sampleRate) / 2 / 1000).toFixed(2) + 'k',
    p.sx - half - 4,
    p.sy + fs * 0.35,
  );
  textAlign(LEFT);
  fill(0, 0, max(40, 72 - (atmo ? atmo.briLoss * 0.5 : 0)), alpha * 0.72);
  text(
    ((n.spread * getAudioContext().sampleRate) / 2 / 1000).toFixed(2) + 'k',
    p.sx + half + 4,
    p.sy + fs * 0.35,
  );
}

function drawBurstBox(projections) {
  let x0 = 1e9,
    x1 = -1e9,
    y0 = 1e9,
    y1 = -1e9,
    burstCount = 0;
  for (let i = 0; i < state.nodes.length; i++) {
    if (state.nodes[i].burstId !== state.currentBurst) continue;
    const p = projections[i];
    const half = constrain(state.nodes[i].sz * p.sc * 0.5, 5, 50);
    x0 = min(x0, p.sx - half);
    x1 = max(x1, p.sx + half);
    y0 = min(y0, p.sy - half);
    y1 = max(y1, p.sy + half);
    burstCount++;
  }
  if (burstCount < 2) return;
  const pad = 18;
  x0 -= pad;
  y0 -= pad;
  x1 += pad;
  y1 += pad;
  noFill();
  stroke(0, 0, 30, 22);
  strokeWeight(0.6);
  const cLen = min(30, (x1 - x0) * 0.15, (y1 - y0) * 0.15);
  line(x0, y0, x0 + cLen, y0);
  line(x0, y0, x0, y0 + cLen);
  line(x1, y0, x1 - cLen, y0);
  line(x1, y0, x1, y0 + cLen);
  line(x0, y1, x0 + cLen, y1);
  line(x0, y1, x0, y1 - cLen);
  line(x1, y1, x1 - cLen, y1);
  line(x1, y1, x1, y1 - cLen);
}

function drawAxisCross() {
  const len = 60;
  const { pan, shake } = state;
  const o = project3D(width / 2, height / 2, 0);
  const px = project3D(width / 2 + len, height / 2, 0);
  const py = project3D(width / 2, height / 2 + len, 0);
  const pz = project3D(width / 2, height / 2, len);
  const offsetX = pan.x + shake.x,
    offsetY = pan.y + shake.y;
  strokeWeight(0.5);
  stroke(0, 40, 60, 15);
  line(o.sx + offsetX, o.sy + offsetY, px.sx + offsetX, px.sy + offsetY);
  stroke(120, 40, 60, 15);
  line(o.sx + offsetX, o.sy + offsetY, py.sx + offsetX, py.sy + offsetY);
  stroke(220, 40, 60, 15);
  line(o.sx + offsetX, o.sy + offsetY, pz.sx + offsetX, pz.sy + offsetY);
  noStroke();
  fill(0, 0, 40, 12);
  ellipse(o.sx + offsetX, o.sy + offsetY, 4, 4);
}

function drawOrbitHint() {
  if (width < 800) return;
  const tMaxCur =
    state.nodes.length > 0 ? state.nodes[state.nodes.length - 1].tSec : 1;
  const tMinWin = tMaxCur - CONFIG.display.windowSeconds;
  const cx = width / 2,
    cy = height - 44,
    rw = 58,
    rh = 15;
  noFill();
  stroke(0, 0, 26, 30);
  strokeWeight(0.7);
  ellipse(cx, cy, rw * 2, rh * 2);
  const tx = cx + cos(state.rotation.y) * rw;
  const ty = cy + sin(state.rotation.y) * rh;
  stroke(0, 0, 52, 48);
  strokeWeight(1);
  line(cx, cy, tx, ty);
  noStroke();
  fill(0, 0, 65, 58);
  ellipse(tx, ty, 3.5, 3.5);
  noStroke();
  fill(0, 0, 32);
  textSize(8);
  textAlign(CENTER);
  text(
    't=' +
      max(0, tMinWin).toFixed(1) +
      's \u2192 ' +
      tMaxCur.toFixed(1) +
      's | burst #' +
      state.currentBurst,
    cx,
    cy - rh - 5,
  );
  fill(0, 0, 24);
  text('drag \u00b7 auto-spin \u00b7 [+/-] rotation', cx, cy + rh + 11);
}

// ── FREQUENCY BAR (live spectrum overlay + centroid marker) ──

function drawFreqBar() {
  const barWidth = min(480, width - 44),
    barHeight = 9,
    bx = 22,
    by = 16;

  // Static rainbow gradient (reference scale)
  for (let i = 0; i < barWidth; i++) {
    stroke(map(i, 0, barWidth, 0, 260), 90, 95, 88);
    strokeWeight(1);
    line(bx + i, by, bx + i, by + barHeight);
  }

  // Live spectrum overlay
  if (state.liveSpectrum && player.isPlaying) {
    const spec = state.liveSpectrum;
    const nyquist = getAudioContext().sampleRate / 2;
    const maxFreqBin = constrain(
      floor((CONFIG.audio.maxFreq / nyquist) * spec.length),
      0,
      spec.length - 1,
    );
    const overlayH = 28;
    noStroke();
    for (let i = 0; i < barWidth; i++) {
      const bin = floor(map(i, 0, barWidth, 0, maxFreqBin));
      const energy = spec[bin] / 255;
      if (energy < 0.02) continue;
      const h = energy * overlayH;
      fill(map(i, 0, barWidth, 0, 260), 70, 100, 35 + energy * 40);
      rect(bx + i, by - h, 1, h);
    }

    // Centroid hairline
    const centroidHz = state.liveCentroid * nyquist;
    const centroidX =
      bx + constrain(centroidHz / CONFIG.audio.maxFreq, 0, 1) * barWidth;
    stroke(0, 0, 100, 70);
    strokeWeight(1.2);
    line(centroidX, by - overlayH - 2, centroidX, by + barHeight + 2);

    // Spread bracket
    const spreadHalfPx =
      ((state.liveSpread * nyquist) / CONFIG.audio.maxFreq) * barWidth * 0.5;
    stroke(0, 0, 60, 30);
    strokeWeight(0.6);
    line(
      centroidX - spreadHalfPx,
      by - overlayH - 2,
      centroidX + spreadHalfPx,
      by - overlayH - 2,
    );

    // Centroid label
    noStroke();
    fill(0, 0, 72, 60);
    textSize(7);
    textAlign(CENTER);
    text(
      ((state.liveCentroid * getAudioContext().sampleRate) / 2 / 1000).toFixed(
        1,
      ) + 'k',
      centroidX,
      by + barHeight + 7,
    );
  }

  // Hz scale labels
  noStroke();
  fill(0, 0, 70);
  textSize(9);
  textAlign(LEFT);
  Array.from(
    { length: 5 },
    (_, i) => ((i * CONFIG.audio.maxFreq) / 4 / 1000).toFixed(1) + 'k',
  ).forEach((label, i) => {
    text(
      label + ' Hz',
      bx + (i * barWidth) / 4 - (i > 0 ? 10 : 0),
      by + barHeight + 11,
    );
  });
}

// ── REFERENCE GRID ──

function drawReferenceGrid() {
  const cfg = CONFIG.grid;
  const div = cfg.divisions,
    margin = 60;
  stroke(0, 0, 20, cfg.alpha);
  strokeWeight(0.3);
  for (let i = 0; i <= div; i++) {
    const x = map(i, 0, div, margin, width - margin);
    const y = map(i, 0, div, margin, height - margin);
    line(x, margin, x, height - margin);
    line(margin, y, width - margin, y);
  }
  noStroke();
  fill(0, 0, 25, cfg.labelAlpha);
  textSize(7);
  textAlign(LEFT);
  text('centroid\u2192', margin, height - margin + 12);
  push();
  translate(margin - 10, height - margin);
  rotate(-HALF_PI);
  textAlign(LEFT);
  text('spread\u2192', 0, 0);
  pop();
}

// ── SCIENTIFIC READOUT PANEL ──

function drawReadoutPanel() {
  if (width < 800) return;
  if (!player.isPlaying || !player.isLoaded) return;
  const cfg = CONFIG.readout;
  let y = cfg.y;
  const x = cfg.x;
  noStroke();
  textSize(8);
  textAlign(LEFT);
  const entries = [
    ['RMS', state.liveRMS.toFixed(4)],
    [
      'CENTROID',
      ((state.liveCentroid * getAudioContext().sampleRate) / 2).toFixed(0) +
        ' Hz',
    ],
    [
      'SPREAD',
      ((state.liveSpread * getAudioContext().sampleRate) / 2).toFixed(0) +
        ' Hz',
    ],
    ['FLUX', state.liveFlux.toFixed(4)],
    ['BASS', state.bass.pulse.toFixed(3)],
    ['MELODY', state.music.melodyDrive.toFixed(3)],
    ['BOOM', state.music.boom.toFixed(3)],
    ['NODES', state.nodes.length + '/' + CONFIG.nodes.maxCount],
    ['BURST', '#' + state.currentBurst],
    ['DEPTH', state.trip.depth.toFixed(2)],
    ['FOCAL', state.focal.current.toFixed(0)],
  ];
  for (const [label, value] of entries) {
    fill(0, 0, cfg.labelColor);
    text(label, x, y);
    fill(0, 0, cfg.valueColor);
    text(value, x + 58, y);
    y += cfg.lineHeight;
  }
}

function drawStars() {
  noStroke();
  const twinkle = 40 + state.bass.pulse * 32;
  for (const s of state.stars) {
    fill(0, 0, random(30, twinkle), 50);
    ellipse(
      s.x,
      s.y,
      s.r + state.bass.pulse * 0.35,
      s.r + state.bass.pulse * 0.35,
    );
  }
}

function drawVignette() {
  const layers = 12;
  noFill();
  for (let i = 0; i < layers; i++) {
    const f = i / max(1, layers - 1);
    const w = lerp(width * 0.96, width * 1.32, f);
    const h = lerp(height * 0.96, height * 1.42, f);
    const a = 2 + f * (6 + state.bass.pulse * 8);
    stroke(0, 0, 0, a);
    strokeWeight(30);
    ellipse(width * 0.5, height * 0.5, w, h);
  }
}

// ═══════════════════════════════════════════════════════════════
// PHYSICS
// ═══════════════════════════════════════════════════════════════

function applyRepulsion() {
  const { nodes, currentBurst } = state;
  const cfg = CONFIG.nodes;
  const burstIndices = [];
  let centerX = 0,
    centerY = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].burstId !== currentBurst) continue;
    burstIndices.push(i);
    centerX += nodes[i].dx;
    centerY += nodes[i].dy;
  }
  if (burstIndices.length < 2) return;
  centerX /= burstIndices.length;
  centerY /= burstIndices.length;
  const density = constrain(
    map(burstIndices.length, 8, 80, 0.85, 1.25),
    0.85,
    1.25,
  );
  const boomMul = lerp(
    1,
    CONFIG.magic.boomRepelMul,
    constrain(state.music.boom, 0, 1),
  );
  const minDist = cfg.repelDistance * density * boomMul;
  const repelForce = cfg.repelForce * density * boomMul;
  for (let a = 0; a < burstIndices.length; a++) {
    const i = burstIndices[a];
    for (let b = a + 1; b < burstIndices.length; b++) {
      const j = burstIndices[b];
      const ddx = nodes[i].dx - nodes[j].dx;
      const ddy = nodes[i].dy - nodes[j].dy;
      const d = sqrt(ddx * ddx + ddy * ddy);
      if (d < minDist && d > 0.5) {
        const force = ((minDist - d) / minDist) * repelForce;
        nodes[i].dx += (ddx / d) * force;
        nodes[i].dy += (ddy / d) * force;
        nodes[j].dx -= (ddx / d) * force;
        nodes[j].dy -= (ddy / d) * force;
      }
    }
  }
  for (let a = 0; a < burstIndices.length; a++) {
    const i = burstIndices[a];
    const ox = nodes[i].dx - centerX,
      oy = nodes[i].dy - centerY;
    const d = sqrt(ox * ox + oy * oy);
    if (d < 1) continue;
    const ageBoost = constrain(map(nodes[i].age, 0, 120, 1.0, 0.0), 0, 1);
    const push = cfg.swellForce * density * ageBoost;
    nodes[i].vx += (ox / d) * push;
    nodes[i].vy += (oy / d) * push;
  }
}

// ═══════════════════════════════════════════════════════════════
// INPUT & INTERACTION
// ═══════════════════════════════════════════════════════════════

function mousePressed(event) {
  if (event?.target?.tagName !== 'CANVAS') return;
  state.drag.isDragging = true;
  state.drag.lastMouseX = mouseX;
  state.drag.lastMouseY = mouseY;
  state.drag.velocityY = 0;
  state.drag.velocityX = 0;
}

function mouseReleased() {
  state.drag.isDragging = false;
}

function mouseDragged() {
  if (!state.drag.isDragging) return;
  state.drag.velocityY = (mouseX - state.drag.lastMouseX) * 0.01;
  state.drag.velocityX = (mouseY - state.drag.lastMouseY) * 0.01;
  state.rotation.y += state.drag.velocityY;
  state.rotation.x += state.drag.velocityX;
  state.drag.lastMouseX = mouseX;
  state.drag.lastMouseY = mouseY;
}

function keyPressed(event) {
  if (event?.target?.closest('input, textarea, [contenteditable]')) return;
  if (key === ' ' && event?.target?.closest('button, summary, a')) return;
  if (key === ' ') {
    player.togglePlay();
    return false;
  }
  if (key === 'c' || key === 'C') resetAudioState();
  if (key === '+' || key === '=') state.rotation.wobbleT += 0.5;
  if (key === '-') state.rotation.wobbleT -= 0.5;
  if (key === 'f' || key === 'F') toggleFullscreen();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  state.frame.reset();
  state.burstBBox.initialized = false;
  state.pan.prevCenterX = width / 2;
  state.pan.prevCenterY = height / 2;
  state.pan.velocityX = 0;
  state.pan.velocityY = 0;
}

// ─────────────────────────────────────────────────────────────
// FULLSCREEN & SCENE RESET
// ─────────────────────────────────────────────────────────────

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
  state.nodes = [];
  state.analysis = new AdaptiveAnalysis();
  state.analysisElapsed = 0;
  state.features = { active: false, level: 0 };
  state.camera.reset();
  state.frame.reset();
  state.currentBurst = 0;
  state.framesSinceSpawn = 0;
  state.unclutterSlots = new Map();
  state.liveSpectrum = null;
  state.liveCentroid = 0;
  state.liveSpread = 0;
  state.liveRMS = 0;
  state.liveFlux = 0;
  state.bounds.centroid = { min: 0.3, max: 0.7 };
  state.bounds.spread = { min: 0.1, max: 0.4 };
  state.bounds.tilt = { min: 0.3, max: 0.7 };
  state.pan.x = 0;
  state.pan.y = 0;
  state.focal.current = CONFIG.camera.focalStartFar;
  state.focal.targetSmoothed = CONFIG.camera.focalStartFar;
  state.drag.velocityY = 0;
  state.drag.velocityX = 0;
  state.burstBBox.initialized = false;
  state.pan.prevCenterX = 0;
  state.pan.prevCenterY = 0;
  state.pan.velocityX = 0;
  state.pan.velocityY = 0;
  state.bass.pulse = 0;
  state.bass.base = 0;
  state.bass.shockPulse = 0;
  state.bass.rmsSmooth = 0;
  state.shake.x = 0;
  state.shake.y = 0;
  state.shake.z = 0;
  state.trip.depth = 0.28;
  state.trip.target = 0.28;
  state.trip.timer = 110;
  state.director.panDriftX = 0;
  state.director.panDriftY = 0;
  state.director.targetDriftX = 0;
  state.director.targetDriftY = 0;
  state.director.wanderTimer = 0;
  state.director.burstKick = 0;
  state.director.zoomKick = 0;
  state.music.bassRise = 0;
  state.music.melodyDrive = 0;
  state.music.boom = 0;
  state.music.prevCentroid = 0;
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function secondsToLerp(secondsToTarget) {
  const fps = max(1, frameRate() || 60);
  const frames = max(1, secondsToTarget * fps);
  return 1 - pow(0.05, 1 / frames);
}
// p5 global mode discovers lifecycle callbacks on window.
Object.assign(window, {
  setup,
  draw,
  mousePressed,
  mouseReleased,
  mouseDragged,
  keyPressed,
  windowResized,
});
