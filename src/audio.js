// One owner for file decoding, playback, and object URL cleanup.
// The scene only reads this state; controls react through onChange.
export class AudioPlayer {
  constructor({ fft, amplitude, onChange, onReset }) {
    this.fft = fft;
    this.amplitude = amplitude;
    this.onChange = onChange;
    this.onReset = onReset;
    this.sound = null;
    this.isLoaded = false;
    this.isLoading = false;
    this.isPlaying = false;
    this.filename = '';
    this.error = '';
    this.starting = false;
    this.loadId = 0;
    this.pendingLoad = null;
  }

  loadFile(file) {
    if (!file) return;
    if (
      !file.type.startsWith('audio/') &&
      !/\.(mp3|wav|ogg|m4a|aac|flac|aiff?)$/i.test(file.name)
    ) {
      this.error = 'Choose an audio file, such as MP3, WAV, or OGG.';
      this.onChange();
      return;
    }

    return this.loadSource(URL.createObjectURL(file), file.name);
  }

  async loadSource(url, name) {
    const loadId = ++this.loadId;
    this.pendingLoad?.cancel();
    this.pendingLoad = null;
    this.isLoading = true;
    this.isLoaded = false;
    this.isPlaying = false;
    this.starting = false;
    this.filename = name;
    this.error = '';
    if (this.sound) {
      this.sound.onended(() => {});
      this.sound.stop();
      this.sound.dispose();
      this.sound = null;
    }
    this.onReset();
    this.onChange();

    const request = { sound: null, cancel: null };
    this.pendingLoad = request;
    let urlReleased = false;
    const releaseURL = () => {
      if (!urlReleased) {
        URL.revokeObjectURL(url);
        urlReleased = true;
      }
    };
    try {
      const sound = await new Promise((resolve, reject) => {
        request.cancel = () => {
          // Disposing a pending p5 SoundFile suppresses its load callback.
          // Settle the old request ourselves so replacement also releases it.
          request.sound?.dispose();
          releaseURL();
          resolve(null);
        };
        request.sound = loadSound(url, resolve, reject);
      });
      if (loadId !== this.loadId) return;
      this.sound = sound;
      this.fft.setInput(this.sound);
      this.amplitude.setInput(this.sound);
      this.sound.onended((sound) => {
        // p5 updates its playback flags after this callback, including on pause.
        queueMicrotask(() => {
          if (sound !== this.sound) return;
          this.isPlaying = sound.isPlaying();
          this.onChange();
        });
      });
      this.isLoaded = true;
    } catch {
      if (loadId !== this.loadId) return;
      request.sound?.dispose();
      this.sound = null;
      this.error =
        'This file could not be decoded. Try a different MP3 or WAV file.';
    } finally {
      releaseURL();
      if (loadId === this.loadId) {
        this.pendingLoad = null;
        this.isLoading = false;
        this.onChange();
      }
    }
  }

  async togglePlay() {
    if (!this.isLoaded || this.starting) return;
    if (this.isPlaying) {
      this.sound.pause();
      this.isPlaying = false;
      this.onChange();
      return;
    }
    this.starting = true;
    const sound = this.sound;
    const loadId = this.loadId;
    try {
      await userStartAudio();
      if (loadId !== this.loadId || sound !== this.sound || !this.isLoaded)
        return;
      if (!sound.isPaused()) this.onReset();
      sound.play();
      this.isPlaying = true;
      this.error = '';
    } catch {
      if (loadId === this.loadId)
        this.error = 'Playback could not start. Press Play to try again.';
    } finally {
      if (loadId === this.loadId) {
        this.starting = false;
        this.onChange();
      }
    }
  }
}
