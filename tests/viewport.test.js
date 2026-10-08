import assert from 'node:assert/strict';
import test from 'node:test';
import { fitToViewport } from '../src/viewport.js';

test('an offscreen graph fits between the mobile header and controls', () => {
  const input = [
    { sx: 900, sy: -1000, sc: 1.5, depth: 20 },
    { sx: 2500, sy: 1200, sc: 0.5, depth: -30 },
  ];
  const fitted = fitToViewport(input, { width: 390, height: 844 });
  assert.ok(fitted.every((point) => point.sx >= 40 && point.sx <= 350));
  assert.ok(fitted.every((point) => point.sy >= 156 && point.sy <= 590));
  assert.equal(fitted[0].depth, 20);
  assert.equal(input[0].sx, 900);
});

test('empty and single-node graphs remain finite', () => {
  assert.deepEqual(fitToViewport([], { width: 390, height: 844 }), []);
  const [point] = fitToViewport([{ sx: 2000, sy: -500, sc: 1 }], {
    width: 390,
    height: 844,
  });
  assert.equal(point.sx, 195);
  assert.ok(Number.isFinite(point.sy));
  assert.equal(point.sc, 1);
});
