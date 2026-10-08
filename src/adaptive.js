import {
  melEnergies,
  spectralCentroid,
  spectralSpread,
  spectralFlux,
  spectralTilt,
} from './spectral.js';

const clamp = (value, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value));
export const smooth = (current, target, seconds, dt) =>
  target + (current - target) * Math.exp(-dt / seconds);

// Linear magnitudes preserve spectral shape when recording gain changes.
// Normalization affects analysis only, never the volume of playback.
export function normalizedSpectrum(decibels) {
  const magnitudes = Float32Array.from(decibels, (db, i) =>
    i > 0 && Number.isFinite(db) ? 10 ** (db / 20) : 0,
  );
  const peak = Math.max(0, ...magnitudes);
  // Suppress bins below -54 dB relative to the peak (e.g. PCM quantization noise).
  return magnitudes.map((value) =>
    peak > 1e-10 && value >= peak * 0.002 ? (255 * value) / peak : 0,
  );
}

// Keep each feature legible within its recent range, including steady tones.
class FeatureRange {
  constructor() {
    this.mean = null;
    this.variance = 0;
  }

  update(value, dt) {
    this.mean ??= value;
    const difference = value - this.mean;
    this.mean = smooth(this.mean, value, 2.5, dt);
    this.variance = smooth(this.variance, difference ** 2, 2.5, dt);
    return Math.tanh(difference / (0.06 + 2 * Math.sqrt(this.variance)));
  }
}

export class AdaptiveAnalysis {
  constructor() {
    this.reference = 0;
    this.level = 0;
    this.pulse = 0;
    this.elapsed = 0;
    this.lastOnset = -Infinity;
    this.previousMel = null;
    this.fluxMean = 0;
    this.fluxDeviation = 0;
    this.bassMean = 0;
    this.levelMean = 0;
    this.centroidRange = new FeatureRange();
    this.spreadRange = new FeatureRange();
  }

  update({ spectrum, rms, sampleRate, dt }) {
    this.elapsed += dt;
    this.pulse *= Math.exp(-dt / 0.24);
    // Follow quiet passages too; a loud intro should not set the whole track.
    this.reference = Math.max(rms, this.reference * Math.exp(-dt / 0.9));
    const active = rms > Math.max(0.00001, this.reference * 0.007);
    const targetLevel = active
      ? clamp((rms / this.reference) * 0.72) ** 0.7
      : 0;
    this.level = smooth(this.level, targetLevel, active ? 0.09 : 0.2, dt);
    if (!active) {
      this.previousMel = null;
      return {
        active: false,
        level: this.level,
        pulse: this.pulse,
        onset: false,
      };
    }

    const centroid = spectralCentroid(spectrum);
    const spread = spectralSpread(spectrum, centroid);
    const mel = melEnergies(spectrum, {
      bands: 40,
      maxFreq: 14000,
      sampleRate,
    });
    const flux = this.previousMel ? spectralFlux(mel, this.previousMel) : 0;
    this.previousMel = mel;
    const bassLimit = Math.ceil((180 / (sampleRate / 2)) * spectrum.length);
    let bassTotal = 0;
    let total = 0;
    for (let i = 1; i < spectrum.length; i++) {
      total += spectrum[i];
      if (i < bassLimit) bassTotal += spectrum[i];
    }
    const bass = bassTotal / Math.max(total, 1);
    const fluxThreshold = Math.max(
      0.018,
      this.fluxMean + 1.8 * this.fluxDeviation,
    );
    const onset =
      this.elapsed > 0.25 &&
      this.elapsed - this.lastOnset > 0.28 &&
      (flux > fluxThreshold ||
        (bass - this.bassMean > 0.12 && this.level - this.levelMean > 0.08));
    if (onset) {
      this.lastOnset = this.elapsed;
      this.pulse = clamp(0.35 + flux * 2 + Math.max(0, bass - this.bassMean));
    }
    this.fluxDeviation = smooth(
      this.fluxDeviation,
      Math.abs(flux - this.fluxMean),
      1.2,
      dt,
    );
    this.fluxMean = smooth(this.fluxMean, flux, 1.2, dt);
    this.bassMean = smooth(this.bassMean, bass, 0.45, dt);
    this.levelMean = smooth(this.levelMean, this.level, 0.45, dt);

    const centroidHz = (centroid * sampleRate) / 2;
    const spreadHz = (spread * sampleRate) / 2;
    const brightness = clamp(
      Math.log1p(centroidHz / 150) / Math.log1p(8000 / 150),
    );
    return {
      active,
      level: this.level,
      pulse: this.pulse,
      onset,
      flux,
      bass,
      centroid,
      spread,
      tilt: spectralTilt(mel),
      x: this.centroidRange.update(brightness, dt),
      y: this.spreadRange.update(Math.log1p(spreadHz / 300) / 4, dt),
      hue: 270 - brightness * 240,
    };
  }
}
