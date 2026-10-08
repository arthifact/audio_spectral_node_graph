// Scene tuning. Time-based camera settings use seconds; node lifetimes use frames.
const CONFIG = {
  audio: {
    fftBins: 1024,
    melBands: 40,
    maxFreq: 14000,
    ampThreshold: 0.005,
    spawnEvery: 1,
    rmsAttack: 0.22,
    rmsRelease: 0.025,
  },

  nodes: {
    maxCount: 250,
    fadeFrames: 200,
    repelDistance: 44,
    repelForce: 0.28,
    swellForce: 0.032,
  },

  spectral: {
    fluxThreshold: 0.01,
    unclutterCBins: 32,
    unclutterSBins: 22,
    unclutterStepPx: 6.0,
    unclutterMaxPx: 26,
    unclutterStrength: 0.82,
  },

  camera: {
    trackWindowSec: 1.4,
    focalBase: 920,
    focalStartFar: 340,
    depth: 880,
    panTimeSec: 0.32,
    panReturnTimeSec: 0.6,
    zoomTimeSec: 0.12,
    zoomReturnTimeSec: 0.24,
    closeFocal: 880,
    closeZoomSoften: 0.72,
    closePanSoften: 0.8,
    closeMaxFocalStep: 80,
    maxFocalStep: 160,
    closeMaxPanStep: 70,
    maxPanStep: 110,
    nearZRatio: 0.42,
    nearBias: 88,
    maxScale: 1.85,
    maxPanRangeX: 0.48,
    maxPanRangeY: 0.48,
    minGuardPad: 0.14,
    maxGuardPad: 0.3,
    edgeRecoveryStrength: 2.8,
  },

  wobble: {
    speed: 0.0052,
    panSway: 0.028,
    yawSpeed: 0.0055,
    yawVariation: 0.0042,
    pitchSpeed: 0.004,
    pitchVariation: 0.0036,
    pitchSecondary: 0.0022,
    rollSwing: 0.68,
    rollSecondary: 0.14,
  },

  immersion: {
    tripFarMul: 0.52,
    tripNearMul: 1.72,
  },

  input: {
    dragFriction: 0.92,
    dragThreshold: 0.0006,
  },

  display: {
    windowSeconds: 11,
    starCount: 180,
  },

  composition: {
    padRelaxed: 0.06,
    padIntense: 0.02,
    warpAmount: 0.078,
    warpBreath: 0.048,
  },

  flow: {
    driftAccel: 0.013,
    driftNoiseSpeed: 0.003,
    driftDamping: 0.968,
    driftMaxVel: 2.4,
    driftBurstBoost: 3.2,
  },

  director: {
    wanderMinFrames: 90,
    wanderMaxFrames: 220,
    wanderRangeX: 0.024,
    wanderRangeY: 0.02,
    burstKickPan: 36,
    burstKickZoom: 90,
  },

  magic: {
    boomRiseThreshold: 0.028,
    boomBassThreshold: 0.09,
    boomKick: 1.0,
    boomDecay: 0.88,
    boomOutwardForce: 0.24,
    boomRepelMul: 2.4,
    melodyAttack: 0.24,
    melodyRelease: 0.035,
    melodyDriftBoost: 2.8,
    melodyWarpBoost: 0.08,
  },

  highlight: {
    minStrokeWeight: 1.8,
    glowLayers: 5,
    glowExpand: [1.3, 1.7, 2.2, 2.9, 3.6],
    glowAlpha: [48, 30, 18, 9, 4],
    glowStroke: [1.6, 1.2, 0.8, 0.5, 0.3],
    beaconMinRadius: 4.0,
    beaconAlpha: 85,
  },

  atmosphere: {
    fogNear: -200,
    fogFar: 500,
    maxDesaturation: 38,
    maxBrightnessDrop: 18,
  },

  readout: {
    x: 22,
    y: 68,
    lineHeight: 13,
    labelColor: 28,
    valueColor: 52,
  },

  grid: {
    enabled: false,
    divisions: 8,
    alpha: 6,
    labelAlpha: 14,
  },
};

export default CONFIG;
