import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bandEnergy,
  hzToMel,
  melToHz,
  melEnergies,
  spectralCentroid,
  spectralSpread,
  spectralTilt,
  spectralFlux,
} from '../src/spectral.js';

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≈ ${expected}`);

test('silence produces finite zero centroid, spread, flux, and band energies', () => {
  const silence = new Array(1024).fill(0);
  assert.equal(spectralCentroid(silence), 0);
  assert.equal(spectralSpread(silence, 0), 0);
  assert.equal(spectralFlux(silence, silence), 0);
  assert.deepEqual(
    melEnergies(silence, { bands: 40, maxFreq: 14000, sampleRate: 48000 }),
    new Array(40).fill(0),
  );
});

test('a single FFT bin has the expected centroid and zero spread', () => {
  const spectrum = [0, 0, 255, 0, 0, 0, 0, 0];
  near(spectralCentroid(spectrum), 0.25);
  near(spectralSpread(spectrum, 0.25), 0);
});

test('symmetric bins preserve their mean and weighted spread', () => {
  const spectrum = [0, 255, 0, 255, 0, 0, 0, 0];
  near(spectralCentroid(spectrum), 0.25);
  near(spectralSpread(spectrum, 0.25), 0.125);
});

test('frequency bands use the actual sample rate at 44.1 and 48 kHz', () => {
  const spectrum = new Array(1024).fill(0);
  spectrum[128] = 255;
  assert.equal(bandEnergy(spectrum, 3010, 3015, 48000), 1);
  assert.equal(bandEnergy(spectrum, 3010, 3015, 44100), 0);
  assert.equal(bandEnergy(spectrum, 2757, 2770, 48000), 0);
  assert.equal(bandEnergy(spectrum, 2757, 2770, 44100), 1);
  assert.equal(bandEnergy(spectrum, 24000, 28000, 48000), 0);
});

test('mel conversions round trip and energies stay normalized', () => {
  for (const hz of [0, 80, 440, 1000, 14000]) near(melToHz(hzToMel(hz)), hz);
  const spectrum = new Array(1024).fill(0);
  spectrum[80] = 200;
  const mel = melEnergies(spectrum, {
    bands: 40,
    maxFreq: 14000,
    sampleRate: 48000,
  });
  assert.equal(mel.length, 40);
  assert.equal(Math.max(...mel), 1);
  assert.ok(mel.every((value) => value >= 0 && value <= 1));
});

test('flux measures both rises and falls, and tilt distinguishes low from high', () => {
  near(spectralFlux([1, 0], [0, 0]), Math.sqrt(0.5));
  near(spectralFlux([0, 0], [1, 0]), Math.sqrt(0.5));
  assert.ok(spectralTilt([1, 1, 0, 0]) > 0.99);
  assert.ok(spectralTilt([0, 0, 1, 1]) < 0.01);
  assert.equal(spectralTilt([0, 0, 0, 0]), 0.5);
});
