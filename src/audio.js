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
  }

  async loadFile(file) {
    if (!file || this.isLoading) return;
    if (
      !file.type.startsWith('audio/') &&
      !/\.(mp3|wav|ogg|m4a|aac|flac|aiff?)$/i.test(file.name)
    ) {
      this.error = 'Choose an audio file, such as MP3, WAV, or OGG.';
      this.onChange();
      return;
    }

    this.isLoading = true;
    this.isLoaded = false;
    this.isPlaying = false;
    this.filename = file.name;
    this.error = '';
    if (this.sound) {
      this.sound.onended(() => {});
      this.sound.stop();
      this.sound.dispose();
      this.sound = null;
    }
    this.onReset();
    this.onChange();

    const url = URL.createObjectURL(file);
    let pending;
    try {
      this.sound = await new Promise((resolve, reject) => {
        pending = loadSound(url, resolve, reject);
      });
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
      pending?.dispose();
      this.error =
        'This file could not be decoded. Try a different MP3 or WAV file.';
    } finally {
      URL.revokeObjectURL(url);
      this.isLoading = false;
      this.onChange();
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
    try {
      await userStartAudio();
      if (sound !== this.sound || !this.isLoaded) return;
      if (!sound.isPaused()) this.onReset();
      sound.play();
      this.isPlaying = true;
      this.error = '';
    } catch {
      this.error = 'Playback could not start. Press Play to try again.';
    } finally {
      this.starting = false;
      this.onChange();
    }
  }
}
