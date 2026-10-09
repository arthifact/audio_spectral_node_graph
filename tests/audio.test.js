import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioPlayer } from '../src/audio.js';

function setup(t) {
  const calls = [];
  const inputs = [];
  const revoked = [];
  let changes = 0;
  let resets = 0;
  let nextURL = 0;
  const previousLoadSound = globalThis.loadSound;
  const previousStartAudio = globalThis.userStartAudio;
  t.after(() => {
    if (previousLoadSound === undefined) delete globalThis.loadSound;
    else globalThis.loadSound = previousLoadSound;
    if (previousStartAudio === undefined) delete globalThis.userStartAudio;
    else globalThis.userStartAudio = previousStartAudio;
  });
  t.mock.method(URL, 'createObjectURL', () => `blob:test-${++nextURL}`);
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  globalThis.userStartAudio = async () => {};
  globalThis.loadSound = (url, resolve, reject) => {
    const sound = {
      plays: 0,
      pauses: 0,
      stops: 0,
      disposals: 0,
      playing: false,
      paused: false,
      ended: () => {},
      onended(callback) {
        this.ended = callback;
      },
      play() {
        this.plays++;
        this.playing = true;
        this.paused = false;
      },
      pause() {
        this.pauses++;
        this.playing = false;
        this.paused = true;
      },
      stop() {
        this.stops++;
        this.playing = false;
      },
      dispose() {
        this.disposals++;
        this.playing = false;
      },
      isPlaying() {
        return this.playing;
      },
      isPaused() {
        return this.paused;
      },
    };
    calls.push({ url, sound, resolve: () => resolve(sound), reject });
    return sound;
  };
  const player = new AudioPlayer({
    fft: { setInput: (sound) => inputs.push(['fft', sound]) },
    amplitude: { setInput: (sound) => inputs.push(['amplitude', sound]) },
    onChange: () => changes++,
    onReset: () => resets++,
  });
  return {
    player,
    calls,
    inputs,
    revoked,
    get changes() {
      return changes;
    },
    get resets() {
      return resets;
    },
  };
}

const file = (name = 'My song.mp3') => ({ name, type: 'audio/mpeg' });

test('a local file is decoded and ready without starting playback', async (t) => {
  const { player, calls, inputs, revoked } = setup(t);
  const loaded = player.loadFile(file());
  assert.equal(player.isLoaded, false);
  assert.equal(calls[0].url, 'blob:test-1');
  calls[0].resolve();
  await loaded;
  assert.equal(player.filename, 'My song.mp3');
  assert.equal(player.isLoaded, true);
  assert.equal(player.isPlaying, false);
  assert.equal(calls[0].sound.plays, 0);
  assert.deepEqual(inputs, [
    ['fft', calls[0].sound],
    ['amplitude', calls[0].sound],
  ]);
  assert.deepEqual(revoked, ['blob:test-1']);
});

test('a local file replaces a pending file and ignores its late completion', async (t) => {
  const fixture = setup(t);
  const { player, calls, inputs } = fixture;
  const firstLoad = player.loadFile(file('First.mp3'));
  const localLoad = player.loadFile(file());
  await firstLoad;
  assert.equal(calls[0].sound.disposals, 1);
  assert.equal(player.filename, 'My song.mp3');
  assert.equal(player.isLoaded, false);
  const changes = fixture.changes;
  calls[0].resolve();
  await Promise.resolve();
  assert.equal(fixture.changes, changes);
  assert.equal(player.sound, null);
  assert.equal(player.isLoaded, false);
  calls[1].resolve();
  await localLoad;
  assert.equal(player.sound, calls[1].sound);
  assert.ok(inputs.every(([, sound]) => sound === calls[1].sound));
  assert.deepEqual(fixture.revoked, ['blob:test-1', 'blob:test-2']);
});

test('replacing pending local files releases their resources and ignores stale errors', async (t) => {
  const fixture = setup(t);
  const { player, calls, revoked } = fixture;
  const first = player.loadFile(file('First.mp3'));
  const second = player.loadFile(file('Second.mp3'));
  await first;
  assert.equal(calls[0].sound.disposals, 1);
  assert.deepEqual(revoked, ['blob:test-1']);
  calls[1].resolve();
  await second;
  const changes = fixture.changes;
  calls[0].reject(new Error('Old request failed'));
  await Promise.resolve();
  assert.equal(player.filename, 'Second.mp3');
  assert.equal(player.error, '');
  assert.equal(player.isLoaded, true);
  assert.equal(fixture.changes, changes);
  assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2']);
});

test('a playing file stops when replaced and its end callback cannot change playback', async (t) => {
  const fixture = setup(t);
  const { player, calls } = fixture;
  const first = player.loadFile(file('First.mp3'));
  calls[0].resolve();
  await first;
  await player.togglePlay();
  assert.equal(player.isPlaying, true);
  const oldEnded = calls[0].sound.ended;
  const second = player.loadFile(file());
  assert.equal(player.isPlaying, false);
  assert.equal(calls[0].sound.stops, 1);
  assert.equal(calls[0].sound.disposals, 1);
  calls[1].resolve();
  await second;
  await player.togglePlay();
  const changes = fixture.changes;
  oldEnded(calls[0].sound);
  await Promise.resolve();
  assert.equal(player.isPlaying, true);
  assert.equal(fixture.changes, changes);
});

test('a failed file decode allows recovery with another file', async (t) => {
  const { player, calls } = setup(t);
  const first = player.loadFile(file('Broken.mp3'));
  calls[0].reject(new Error('Cannot decode'));
  await first;
  assert.equal(player.isLoaded, false);
  assert.equal(player.sound, null);
  assert.match(player.error, /could not be decoded/);
  assert.equal(calls[0].sound.disposals, 1);
  const second = player.loadFile(file());
  calls[1].resolve();
  await second;
  assert.equal(player.error, '');
  assert.equal(player.isLoaded, true);
});

test('a local decode failure releases the object URL and reports the current error', async (t) => {
  const { player, calls, revoked } = setup(t);
  const loaded = player.loadFile(file());
  calls[0].reject(new Error('Cannot decode'));
  await loaded;
  assert.equal(player.isLoaded, false);
  assert.match(player.error, /could not be decoded/);
  assert.equal(calls[0].sound.disposals, 1);
  assert.deepEqual(revoked, ['blob:test-1']);
});

test('invalid selections leave the current sound available', async (t) => {
  const { player, calls } = setup(t);
  const loaded = player.loadFile(file());
  calls[0].resolve();
  await loaded;
  player.loadFile({ name: 'notes.txt', type: 'text/plain' });
  assert.equal(player.sound, calls[0].sound);
  assert.equal(player.isLoaded, true);
  assert.equal(calls.length, 1);
  assert.match(player.error, /Choose an audio file/);
});

test('a replaced sound never plays when an earlier audio-context resume finishes', async (t) => {
  const { player, calls } = setup(t);
  const loaded = player.loadFile(file('First.mp3'));
  calls[0].resolve();
  await loaded;
  let resolveStart;
  globalThis.userStartAudio = () =>
    new Promise((resolve) => {
      resolveStart = resolve;
    });
  const play = player.togglePlay();
  const replacement = player.loadFile(file());
  calls[1].resolve();
  await replacement;
  resolveStart();
  await play;
  assert.equal(calls[0].sound.plays, 0);
  assert.equal(calls[1].sound.plays, 0);
  assert.equal(player.isPlaying, false);
  assert.equal(player.starting, false);
});

test('replacement prevents delayed playback and delayed playback errors from affecting the new sound', async (t) => {
  const fixture = setup(t);
  const { player, calls } = fixture;
  const loaded = player.loadFile(file('First.mp3'));
  calls[0].resolve();
  await loaded;
  let rejectOldStart;
  globalThis.userStartAudio = () =>
    new Promise((resolve, reject) => {
      rejectOldStart = reject;
    });
  const oldPlay = player.togglePlay();
  assert.equal(player.starting, true);
  const replacement = player.loadFile(file());
  assert.equal(player.starting, false);
  calls[1].resolve();
  await replacement;
  let resolveNewStart;
  globalThis.userStartAudio = () =>
    new Promise((resolve) => {
      resolveNewStart = resolve;
    });
  const newPlay = player.togglePlay();
  const changes = fixture.changes;
  rejectOldStart(new Error('Obsolete permission request failed'));
  await oldPlay;
  assert.equal(player.error, '');
  assert.equal(player.starting, true);
  assert.equal(fixture.changes, changes);
  assert.equal(calls[0].sound.plays, 0);
  resolveNewStart();
  await newPlay;
  assert.equal(player.starting, false);
  assert.equal(player.isPlaying, true);
  assert.equal(calls[1].sound.plays, 1);
});
