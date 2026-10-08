// Features use linear magnitudes scaled to 0–255. Centroid and spread are
// normalized to Nyquist; flux is RMS change, rather than positive-only flux.
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

export function spectralCentroid(spectrum) {
  let weighted = 0;
  let total = 0;
  for (let k = 0; k < spectrum.length; k++) {
    weighted += k * spectrum[k];
    total += spectrum[k];
  }
  return total < 1 ? 0 : clamp(weighted / total / spectrum.length, 0, 1);
}

export function spectralSpread(spectrum, centroid) {
  const mean = centroid * spectrum.length;
  let variance = 0;
  let total = 0;
  for (let k = 0; k < spectrum.length; k++) {
    variance += (k - mean) ** 2 * spectrum[k];
    total += spectrum[k];
  }
  return total < 1
    ? 0
    : clamp(Math.sqrt(variance / total) / spectrum.length, 0, 1);
}

export function spectralTilt(mel) {
  const half = Math.floor(mel.length / 2);
  const low = mel.slice(0, half).reduce((sum, value) => sum + value, 0);
  const high = mel.slice(half).reduce((sum, value) => sum + value, 0);
  return (low + 0.001) / (low + high + 0.002);
}

export function spectralFlux(mel, previous) {
  if (mel.length === 0) return 0;
  const sum = mel.reduce(
    (total, value, i) => total + (value - previous[i]) ** 2,
    0,
  );
  return Math.sqrt(sum / mel.length);
}

export function bandEnergy(spectrum, lowHz, highHz, sampleRate) {
  if (spectrum.length === 0) return 0;
  const nyquist = sampleRate / 2;
  if (lowHz >= nyquist || highHz < 0) return 0;
  const low = clamp(
    Math.floor((lowHz / nyquist) * spectrum.length),
    0,
    spectrum.length - 1,
  );
  const high = clamp(
    Math.floor((highHz / nyquist) * spectrum.length),
    low,
    spectrum.length - 1,
  );
  let sum = 0;
  for (let k = low; k <= high; k++) sum += spectrum[k] / 255;
  return sum / (high - low + 1);
}

export const hzToMel = (hz) => 2595 * Math.log10(1 + hz / 700);
export const melToHz = (mel) => 700 * (10 ** (mel / 2595) - 1);

// Average overlapping, mel-spaced ranges and normalize their peak to one.
// These are rectangular ranges, not a triangular mel filterbank or MFCCs.
export function melEnergies(spectrum, { bands, maxFreq, sampleRate }) {
  const output = new Array(bands).fill(0);
  if (spectrum.length === 0) return output;
  const nyquist = sampleRate / 2;
  const minMel = hzToMel(80);
  const maxMel = hzToMel(Math.min(maxFreq, nyquist));
  const edges = Array.from({ length: bands + 2 }, (_, i) =>
    melToHz(minMel + (i * (maxMel - minMel)) / (bands + 1)),
  );
  for (let m = 0; m < bands; m++) {
    output[m] = bandEnergy(spectrum, edges[m], edges[m + 2], sampleRate);
  }
  const peak = Math.max(...output);
  return peak > 0 ? output.map((energy) => energy / peak) : output;
}
