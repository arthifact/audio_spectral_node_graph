import test from 'node:test';
import assert from 'node:assert/strict';
import { SmoothCamera } from '../src/camera.js';

test('camera eases extreme position and zoom changes within rate limits', () => {
  const camera = new SmoothCamera();
  let previous = camera.update({ x: 0, y: 0, scale: 200 }, 0);
  const dt = 1 / 60;
  for (let frame = 0; frame < 600; frame++) {
    const target =
      frame < 300
        ? { x: 100, y: -100, scale: 2 }
        : { x: -100, y: 100, scale: 20000 };
    const current = camera.update(target, dt);
    assert.ok(Object.values(current).every(Number.isFinite));
    const screenDistance =
      Math.hypot(current.x - previous.x, current.y - previous.y) *
      Math.max(previous.scale, current.scale);
    assert.ok(screenDistance <= 65 * dt + 1e-9);
    assert.ok(
      Math.abs(Math.log(current.scale / previous.scale)) <= 0.35 * dt + 1e-12,
    );
    previous = current;
  }
});

test('pixel-coordinate camera limits pan independently of focal distance', () => {
  const camera = new SmoothCamera({
    panSpeed: 100,
    maxZoomRate: 0.4,
    panInPixels: true,
  });
  let previous = camera.update({ x: 0, y: 0, scale: 300 }, 0);
  const dt = 1 / 60;
  let initialTravel = 0;
  for (let frame = 0; frame < 600; frame++) {
    const target =
      frame < 300
        ? { x: 10000, y: -10000, scale: 2 }
        : { x: -10000, y: 10000, scale: 20000 };
    const current = camera.update(target, dt);
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    assert.ok(Object.values(current).every(Number.isFinite));
    assert.ok(distance <= 100 * dt + 1e-9);
    assert.ok(
      Math.abs(Math.log(current.scale / previous.scale)) <= 0.4 * dt + 1e-12,
    );
    if (frame < 60) initialTravel += distance;
    previous = current;
  }
  assert.ok(
    initialTravel > 75,
    'pixel pan must not be divided by focal distance',
  );
});

test('camera starts and reverses gradually rather than jumping to a new target', () => {
  const camera = new SmoothCamera();
  camera.update({ x: 0, y: 0, scale: 200 }, 0);
  const first = camera.update({ x: 2, y: 0, scale: 20 }, 1 / 60);
  assert.ok(first.x * 200 < 0.06);
  assert.ok(Math.abs(Math.log(first.scale / 200)) < 0.0003);
  for (let i = 0; i < 120; i++)
    camera.update({ x: 2, y: 0, scale: 20 }, 1 / 60);
  const before = camera.update({ x: 2, y: 0, scale: 20 }, 1 / 60);
  const after = camera.update({ x: -2, y: 0, scale: 2000 }, 1 / 60);
  assert.ok(
    after.x > before.x,
    'pan retains momentum while easing toward its new direction',
  );
  assert.ok(after.scale < before.scale, 'zoom reverses its velocity gradually');
});

test('camera motion remains similar at 30 and 60 frames per second', () => {
  function simulate(fps) {
    const camera = new SmoothCamera();
    camera.update({ x: 0, y: 0, scale: 200 }, 0);
    let result;
    for (let frame = 0; frame < fps * 8; frame++) {
      const target =
        frame < fps * 4
          ? { x: 1.5, y: -0.7, scale: 55 }
          : { x: -0.4, y: 0.8, scale: 300 };
      result = camera.update(target, 1 / fps);
    }
    return result;
  }
  const slow = simulate(30);
  const fast = simulate(60);
  assert.ok(Math.hypot(slow.x - fast.x, slow.y - fast.y) * fast.scale < 1.5);
  assert.ok(Math.abs(Math.log(slow.scale / fast.scale)) < 0.005);
});

test('camera handles invalid targets and resumed tabs, and resets between tracks', () => {
  const camera = new SmoothCamera();
  assert.deepEqual(camera.update({ x: 1, y: 1, scale: 100 }, 0), {
    x: 0,
    y: 0,
    scale: 100,
  });
  const resumed = camera.update({ x: 100, y: 100, scale: 1 }, 30);
  assert.ok(Math.abs(Math.log(resumed.scale / 100)) <= 0.35 * 0.08);
  const invalid = camera.update({ x: NaN, y: Infinity, scale: -1 }, NaN);
  assert.deepEqual(invalid, resumed);
  camera.reset();
  assert.deepEqual(camera.update({ x: 0, y: 0, scale: 50 }, 0), {
    x: 0,
    y: 0,
    scale: 50,
  });
});

test('viewport rescaling preserves scene position and pan momentum', () => {
  const camera = new SmoothCamera();
  camera.rescale(0.25);
  assert.equal(camera.scale, null);
  camera.update({ x: 0, y: 0, scale: 200 }, 0);
  for (let i = 0; i < 60; i++) {
    camera.update({ x: 2, y: -1, scale: 20 }, 1 / 60);
  }
  const previous = { ...camera };
  assert.ok(previous.zoomVelocity < 0);
  camera.rescale(0.25);
  assert.equal(camera.scale, previous.scale * 0.25);
  assert.equal(camera.zoomVelocity, 0);
  for (const property of ['x', 'y', 'vx', 'vy']) {
    assert.equal(camera[property], previous[property]);
  }
  const resized = { ...camera };
  for (const factor of [0, -1, NaN, Infinity]) camera.rescale(factor);
  assert.deepEqual({ ...camera }, resized);
});
