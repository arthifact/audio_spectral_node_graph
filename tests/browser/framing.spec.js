import { test, expect } from '@playwright/test';
import { makeWav } from '../helpers/audio.js';

test('recent and fading node squares stay visible during abrupt drags and resizing', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const paths = new WeakMap();
    const proto = CanvasRenderingContext2D.prototype;
    const beginPath = proto.beginPath;
    const rect = proto.rect;
    const stroke = proto.stroke;
    window.__framingChecks = {
      checked: 0,
      recent: 0,
      history: 0,
      stages: {},
      stage: 'desktop',
      violations: [],
    };
    proto.beginPath = function (...args) {
      paths.set(this, []);
      return beginPath.apply(this, args);
    };
    proto.rect = function (x, y, width, height) {
      const matrix = this.getTransform();
      const corners = [
        [x, y],
        [x + width, y],
        [x, y + height],
        [x + width, y + height],
      ].map(([px, py]) => matrix.transformPoint({ x: px, y: py }));
      const pending = paths.get(this) ?? [];
      pending.push(corners);
      paths.set(this, pending);
      return rect.call(this, x, y, width, height);
    };
    proto.stroke = function (...args) {
      const result = stroke.apply(this, args);
      // Recent bodies have neutral 1.8px outlines; fading history has colored
      // 0.2–0.8px outlines. Glow layers are colored and at least 1.8px wide.
      // Non-rectangular paths and rectangles that were only filled are excluded.
      const color = this.strokeStyle;
      const rgb = color.startsWith('#')
        ? [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16))
        : (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      if (rgb.length !== 3) return result;
      const neutral = Math.max(...rgb) - Math.min(...rgb) <= 1;
      const recent =
        Math.abs(this.lineWidth - 1.8) < 1e-6 && neutral && rgb[0] >= 130;
      const history =
        this.lineWidth >= 0.2 - 1e-6 &&
        this.lineWidth <= 0.8 + 1e-6 &&
        !neutral;
      if (!recent && !history) return result;
      const kind = recent ? 'recent' : 'history';
      const canvas = this.canvas;
      const canvasBounds = canvas.getBoundingClientRect();
      const scaleX = canvasBounds.width / canvas.width;
      const scaleY = canvasBounds.height / canvas.height;
      const matrix = this.getTransform();
      const halfStrokeX =
        (this.lineWidth / 2) * Math.hypot(matrix.a, matrix.c) * scaleX;
      const halfStrokeY =
        (this.lineWidth / 2) * Math.hypot(matrix.b, matrix.d) * scaleY;
      const controls = document
        .querySelector('.controls')
        ?.getBoundingClientRect();
      for (const corners of paths.get(this) ?? []) {
        const xs = corners.map((point) => canvasBounds.left + point.x * scaleX);
        const ys = corners.map((point) => canvasBounds.top + point.y * scaleY);
        const bounds = {
          left: Math.min(...xs) - halfStrokeX,
          right: Math.max(...xs) + halfStrokeX,
          top: Math.min(...ys) - halfStrokeY,
          bottom: Math.max(...ys) + halfStrokeY,
        };
        const outside =
          bounds.left < -0.01 ||
          bounds.top < -0.01 ||
          bounds.right > innerWidth + 0.01 ||
          bounds.bottom > innerHeight + 0.01;
        const covered =
          controls &&
          bounds.right > controls.left &&
          bounds.left < controls.right &&
          bounds.bottom > controls.top &&
          bounds.top < controls.bottom;
        const checks = window.__framingChecks;
        checks.checked += 1;
        checks[kind] += 1;
        checks.stages[checks.stage] = (checks.stages[checks.stage] ?? 0) + 1;
        if ((outside || covered) && checks.violations.length < 20) {
          checks.violations.push({
            stage: checks.stage,
            kind,
            bounds,
            viewport: { width: innerWidth, height: innerHeight },
            controls: controls?.toJSON(),
            outside,
            covered: Boolean(covered),
          });
        }
      }
      return result;
    };
  });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.locator('#audio-file').setInputFiles({
    name: 'framing-stress.wav',
    mimeType: 'audio/wav',
    buffer: makeWav(15, 44100, { profile: 'chord' }),
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__framingChecks.recent))
    .toBeGreaterThan(30);
  await expect
    .poll(() => page.evaluate(() => window.__framingChecks.history))
    .toBeGreaterThan(30);

  for (const [stage, viewport] of [
    ['desktop', { width: 1280, height: 800 }],
    ['portrait', { width: 390, height: 844 }],
    ['landscape', { width: 844, height: 260 }],
  ]) {
    await page.evaluate((name) => {
      window.__framingChecks.stage = name;
    }, stage);
    await page.setViewportSize(viewport);
    await page.mouse.move(60, viewport.height / 2);
    await page.mouse.down();
    for (const [x, y] of [
      [viewport.width - 35, 45],
      [45, viewport.height - 35],
      [viewport.width - 40, viewport.height - 40],
      [80, viewport.height * 0.4],
    ]) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(80);
    }
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate((name) => window.__framingChecks.stages[name], stage),
      )
      .toBeGreaterThan(30);
  }
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const checks = await page.evaluate(() => window.__framingChecks);
  expect(checks.recent).toBeGreaterThan(30);
  expect(checks.history).toBeGreaterThan(30);
  expect(checks.violations).toEqual([]);
  expect(errors).toEqual([]);
});
