import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { makeWav } from '../helpers/audio.js';

const defaultAudio = '**/audio/midsummer-sky.mp3';
const recording = fileURLToPath(
  new URL('../../audio/midsummer-sky.mp3', import.meta.url),
);

test('default piano is ready without autoplay and can be replaced', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled();
  await expect(page.locator('#filename')).toHaveText(
    'Midsummer Sky — Kevin MacLeod',
  );
  await expect(page.locator('#audio-status')).toBeHidden();
  await play.click();
  await expect(
    page.getByRole('button', { name: 'Pause', exact: true }),
  ).toBeEnabled();
  await expect(page.locator('#audio-status')).toBeHidden();
  await expect
    .poll(() =>
      page.locator('canvas').evaluate((canvas) => {
        const pixels = canvas
          .getContext('2d')
          .getImageData(0, 250, canvas.width, canvas.height - 450).data;
        let white = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const low = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
          const high = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
          if (low > 140 && high - low < 20) white++;
        }
        return white;
      }),
    )
    .toBeGreaterThan(30);
  await page.locator('#audio-file').setInputFiles({
    name: 'my-song.wav',
    mimeType: 'audio/wav',
    buffer: makeWav(),
  });
  await expect(page.locator('#filename')).toHaveText('my-song.wav');
  await expect(play).toBeEnabled();
  await expect(page.locator('#audio-status')).toBeHidden();
  expect(errors).toEqual([]);
});

for (const status of [200, 404]) {
  test(`own audio wins over a slow default that returns ${status}`, async ({
    page,
  }) => {
    let release;
    let finish;
    const held = new Promise((resolve) => (release = resolve));
    const finished = new Promise((resolve) => (finish = resolve));
    await page.route(defaultAudio, async (route) => {
      await held;
      await route.fulfill(
        status === 200
          ? { status, contentType: 'audio/mpeg', path: recording }
          : { status, body: 'Not found' },
      );
      finish();
    });
    await page.goto('/');
    await expect(page.locator('#filename')).toHaveText(
      'Midsummer Sky — Kevin MacLeod',
    );
    await expect(page.locator('#audio-status')).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Load audio' }),
    ).toBeEnabled();
    await page.locator('#audio-file').setInputFiles({
      name: 'my-song.wav',
      mimeType: 'audio/wav',
      buffer: makeWav(),
    });
    const play = page.getByRole('button', { name: 'Play', exact: true });
    await expect(play).toBeEnabled();
    release();
    await finished;
    await play.click();
    await expect(
      page.getByRole('button', { name: 'Pause', exact: true }),
    ).toBeEnabled();
    await expect(page.locator('#filename')).toHaveText('my-song.wav');
    await expect(page.locator('#audio-status')).toBeHidden();
  });
}

test('missing default leaves local audio loading available', async ({
  page,
}) => {
  await page.route(defaultAudio, (route) =>
    route.fulfill({ status: 404, body: 'Not found' }),
  );
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText(
    'The default audio could not be loaded.',
  );
  await expect(page.getByRole('button', { name: 'Load audio' })).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }),
  ).toBeDisabled();
  await page.locator('#audio-file').setInputFiles({
    name: 'my-song.wav',
    mimeType: 'audio/wav',
    buffer: makeWav(),
  });
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }),
  ).toBeEnabled();
  await expect(page.locator('#audio-status')).toBeHidden();
});
