// Original synthesized tones: no music fixture or third-party audio required.
export function makeWav(
  seconds = 3,
  sampleRate = 44100,
  { gain = 1, profile = 'chord' } = {},
) {
  const samples = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 4);
    const chord =
      Math.sin(2 * Math.PI * 220 * t) +
      0.6 * Math.sin(2 * Math.PI * 554.37 * t) +
      0.4 * Math.sin(2 * Math.PI * (880 + 300 * Math.sin(t)) * t);
    let signal = chord * pulse * 0.18;
    if (profile === 'pad')
      signal =
        (Math.sin(2 * Math.PI * 196 * t) +
          0.4 * Math.sin(2 * Math.PI * 293.66 * t)) *
        0.16;
    if (profile === 'beats') {
      const beat = t % 0.5;
      signal =
        Math.sin(2 * Math.PI * (55 * t - 0.03 * Math.exp(-beat * 20))) *
        Math.exp(-beat * 15) *
        0.7;
      signal +=
        Math.sin(2 * Math.PI * 2300 * t) * Math.exp(-(t % 0.25) * 60) * 0.18;
    }
    if (profile === 'dense')
      signal =
        Array.from({ length: 10 }, (_, n) =>
          Math.sin(2 * Math.PI * (110 * (n + 1) + n * n * 19) * t),
        ).reduce((sum, value) => sum + value, 0) * 0.06;
    data.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, signal * gain)) * 32767),
      44 + i * 2,
    );
  }
  return data;
}
