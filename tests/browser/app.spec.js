import { test, expect } from '@playwright/test';
import { makeWav } from '../helpers/audio.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
});

test('load, play, pause, clear, finish, and replay local audio', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const uploads = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') uploads.push(request.url());
  });
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }),
  ).toBeDisabled();
  await page.locator('#audio-file').setInputFiles({
    name: 'test-tone.wav',
    mimeType: 'audio/wav',
    buffer: makeWav(),
  });
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled();
  await play.click();
  await expect(
    page.getByRole('button', { name: 'Pause', exact: true }),
  ).toBeEnabled();
  await page.keyboard.press('Space');
  await expect(play).toBeEnabled();
  await page.getByRole('button', { name: 'Clear graph', exact: true }).click();
  await play.click();
  await expect(play).toBeEnabled({ timeout: 10000 });
  await play.click();
  await expect(
    page.getByRole('button', { name: 'Pause', exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
  expect(uploads).toEqual([]);
});

test('invalid audio reports an error and a subsequent valid file recovers', async ({
  page,
}) => {
  await page.locator('#audio-file').setInputFiles({
    name: 'broken.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('not an audio file'),
  });
  await expect(page.getByRole('status')).toContainText('could not be decoded');
  await expect(page.getByRole('button', { name: 'Load audio' })).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }),
  ).toBeDisabled();
  await page.locator('#audio-file').setInputFiles({
    name: 'valid.wav',
    mimeType: 'audio/wav',
    buffer: makeWav(),
  });
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }),
  ).toBeEnabled();
});

test('replacing a playing track restores a ready, paused state', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('#audio-file').setInputFiles({
    name: 'first.wav',
    mimeType: 'audio/wav',
    buffer: makeWav(10),
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.locator('#audio-file').setInputFiles({
    name: 'second.wav',
    mimeType: 'audio/wav',
    buffer: makeWav(),
  });
  await expect(page.locator('#filename')).toHaveText('second.wav');
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Pause', exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test('drop audio and keep controls usable on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const data = await page.evaluateHandle(
    (bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(bytes)], 'dropped.wav', { type: 'audio/wav' }),
      );
      return transfer;
    },
    [...makeWav(4)],
  );
  await page.dispatchEvent('body', 'drop', { dataTransfer: data });
  await expect(page.locator('#filename')).toHaveText('dropped.wav');
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // Colored graph pixels must appear in the scene, not just the spectrum bar.
  await expect
    .poll(async () =>
      page.locator('canvas').evaluate((canvas) => {
        const pixels = canvas
          .getContext('2d')
          .getImageData(40, 120, 310, 470).data;
        let colored = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (
            Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 40 &&
            Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
              Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >
              25
          )
            colored++;
        }
        return colored;
      }),
    )
    .toBeGreaterThan(50);
  const controls = await page.locator('.controls').boundingBox();
  expect(controls.x).toBeGreaterThanOrEqual(0);
  expect(controls.x + controls.width).toBeLessThanOrEqual(390);
  await page.getByText('How to use', { exact: true }).click();
  await expect(page.locator('.help')).toContainText('Play / pause');
});

for (const [profile, gain, sampleRate] of [
  ['pad', 0.01, 44100],
  ['beats', 1, 48000],
  ['dense', 1, 44100],
]) {
  test(`visible, moving graph for ${profile} audio at gain ${gain}`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('#audio-file').setInputFiles({
      name: profile + '.wav',
      mimeType: 'audio/wav',
      buffer: makeWav(7, sampleRate, { profile, gain }),
    });
    const graphPixels = () =>
      page.locator('canvas').evaluate((canvas) => {
        const bounds = canvas.getBoundingClientRect();
        const overlays = [
          ...document.querySelectorAll('.controls, .help, .app-header'),
        ].map((element) => element.getBoundingClientRect());
        const pixels = canvas
          .getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        // The original orbit can move beyond the center. Exclude the spectrum,
        // readout and controls, and include both colored history and white nodes.
        for (let y = 0; y < canvas.height; y++) {
          const screenY = bounds.top + (y / canvas.height) * bounds.height;
          for (let x = 0; x < canvas.width; x++) {
            const screenX = bounds.left + (x / canvas.width) * bounds.width;
            if (screenY < 55 || (screenX < 150 && screenY < 250)) continue;
            if (
              overlays.some(
                (rect) =>
                  screenX >= rect.left &&
                  screenX <= rect.right &&
                  screenY >= rect.top &&
                  screenY <= rect.bottom,
              )
            )
              continue;
            const i = (y * canvas.width + x) * 4;
            const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
            const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
            if ((max > 40 && max - min > 25) || (min > 140 && max - min < 25))
              count++;
          }
        }
        return count;
      });
    expect(await graphPixels()).toBe(0);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(graphPixels).toBeGreaterThan(100);
    const before = await page.locator('canvas').screenshot();
    await page.waitForTimeout(400);
    const after = await page.locator('canvas').screenshot();
    expect(after.equals(before)).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('recent sound is white, stays visible after resizing, and fades on pause', async ({
  page,
}) => {
  await page.locator('#audio-file').setInputFiles({
    name: 'steady.wav',
    mimeType: 'audio/wav',
    buffer: makeWav(10, 44100, { profile: 'pad', gain: 0.1 }),
  });
  const whitePixels = () =>
    page.locator('canvas').evaluate((canvas) => {
      const pixels = canvas
        .getContext('2d')
        .getImageData(0, 130, canvas.width, canvas.height - 350).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const low = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
        const high = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
        if (low > 140 && high - low < 20) count++;
      }
      return count;
    });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(whitePixels).toBeGreaterThan(30);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(whitePixels).toBeGreaterThan(30);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(whitePixels).toBe(0);
});
