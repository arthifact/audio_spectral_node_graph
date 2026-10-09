import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdaptiveAnalysis,
  normalizedSpectrum,
  smooth,
} from '../src/adaptive.js';

const decibels = (gain = 1, bin = 12) =>
  Array.from({ length: 1024 }, (_, i) =>
    i === bin
      ? -24 + 20 * Math.log10(gain)
      : i === bin * 2
        ? -32 + 20 * Math.log10(gain)
        : -Infinity,
  );
const input = (rms, bin = 12, dt = 0.05) => ({
  spectrum: normalizedSpectrum(decibels(1, bin)),
  rms,
  sampleRate: 48000,
  dt,
});

test('changing gain by 60 dB preserves spectral shape and visual response', () => {
  const loud = new AdaptiveAnalysis(),
    quiet = new AdaptiveAnalysis();
  const loudSpectrum = normalizedSpectrum(decibels());
  const quietSpectrum = normalizedSpectrum(decibels(0.001));
  loudSpectrum.forEach((value, i) =>
    assert.ok(Math.abs(value - quietSpectrum[i]) < 1e-4),
  );
  let onsets = 0;
  for (let i = 0; i < 100; i++) {
    const level = 0.1 + Math.sin(i / 7) * 0.08;
    const bin = 4 + (Math.floor(i / 5) % 20) * 4;
    const a = loud.update(input(level, bin));
    const b = quiet.update({
      ...input(level / 1000, bin),
      spectrum: normalizedSpectrum(decibels(0.001, bin)),
    });
    for (const key of ['level', 'flux'])
      assert.ok(Math.abs(a[key] - b[key]) < 1e-6, key);
    assert.equal(a.onset, b.onset);
    assert.equal(b.active, true);
    if (a.onset) onsets++;
  }
  assert.ok(onsets > 0);
});

test('silence never spawns a graph or an onset, including after loud audio', () => {
  const analysis = new AdaptiveAnalysis();
  analysis.update(input(0.5));
  for (let i = 0; i < 100; i++) {
    const result = analysis.update({
      ...input(0),
      spectrum: new Float32Array(1024),
    });
    assert.equal(result.active, false);
    assert.equal(result.onset, false);
    assert.ok(Number.isFinite(result.level));
  }
  assert.ok(analysis.level < 1e-8);
  assert.ok(
    normalizedSpectrum([-Infinity, NaN, -Infinity]).every(
      (value) => value === 0,
    ),
  );
});

test('sensitivity recovers during a quiet passage after a loud intro', () => {
  const analysis = new AdaptiveAnalysis();
  for (let i = 0; i < 40; i++) analysis.update(input(0.3));
  let result;
  for (let i = 0; i < 140; i++) result = analysis.update(input(0.0003));
  assert.equal(result.active, true);
  assert.ok(result.level > 0.7);
});

test('rapid spectral changes have finite flux and an onset cooldown', () => {
  const analysis = new AdaptiveAnalysis();
  const times = [];
  for (let i = 0; i < 400; i++) {
    const result = analysis.update(
      input(i % 2 ? 0.05 : 0.2, i % 9 < 4 ? 4 : 120),
    );
    assert.ok(Number.isFinite(result.flux) && result.flux >= 0);
    if (result.onset) times.push(i * 0.05);
  }
  assert.ok(times.length > 0);
  assert.ok(times.every((time, i) => i === 0 || time - times[i - 1] >= 0.28));
});

test('time-based damping and steady response agree at 30, 60 and 120 Hz', () => {
  const results = [30, 60, 120].map((fps) => {
    const analysis = new AdaptiveAnalysis();
    let motion = 0,
      result;
    for (let i = 0; i < fps * 3; i++) {
      motion = smooth(motion, 1, 0.6, 1 / fps);
      result = analysis.update(input(0.02, 12, 1 / fps));
    }
    return { motion, level: result.level };
  });
  for (const result of results) {
    assert.ok(Math.abs(result.motion - results[0].motion) < 1e-10);
    assert.ok(Math.abs(result.level - results[0].level) < 1e-10);
  }
});
