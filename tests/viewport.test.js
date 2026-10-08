import assert from 'node:assert/strict';
import test from 'node:test';
import { sceneViewport, projectPoint } from '../src/viewport.js';

test('portrait scene fits between header and actual controls', () => {
  const area = sceneViewport({
    width: 390,
    height: 844,
    controlsTop: 630,
    controlsLeft: 94,
  });
  assert.equal(area.x, 195);
  assert.ok(area.y - area.height / 2 >= 120);
  assert.ok(area.y + area.height / 2 <= 590);
});

test('desktop and short landscape scenes reserve a side area for controls', () => {
  for (const [width, height] of [
    [1280, 800],
    [740, 390],
  ]) {
    const area = sceneViewport({
      width,
      height,
      controlsTop: height - 200,
      controlsLeft: width - 304,
    });
    assert.ok(area.x + area.width / 2 < width - 304);
    assert.ok(area.height >= 200);
    assert.ok(area.y + area.height / 2 < height);
  }
});

test('projection stays finite through a complete rotation', () => {
  for (let angle = 0; angle < Math.PI * 2; angle += 0.1) {
    const point = projectPoint(
      { x: 1.4, y: -1.3, z: 0.95 },
      { x: angle, y: angle },
      4.5,
    );
    assert.ok(Object.values(point).every(Number.isFinite));
    assert.ok(point.scale > 0 && point.scale <= 1.67);
  }
});
