export function buildUI({ player, clear, toggleFullscreen }) {
  const fileInput = document.querySelector('#audio-file');
  const loadButton = document.querySelector('#load-audio');
  const playButton = document.querySelector('#play-audio');
  const clearButton = document.querySelector('#clear-graph');
  const fullscreenButton = document.querySelector('#fullscreen');
  const status = document.querySelector('#audio-status');
  const filename = document.querySelector('#filename');

  loadButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    player.loadFile(fileInput.files[0]);
    fileInput.value = '';
  });
  playButton.addEventListener('click', () => player.togglePlay());
  clearButton.addEventListener('click', clear);
  fullscreenButton.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    fullscreenButton.textContent = document.fullscreenElement
      ? 'Exit fullscreen'
      : 'Fullscreen';
  });

  let dragDepth = 0;
  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    if (!event.dataTransfer.types.includes('Files')) return;
    dragDepth++;
    document.body.classList.add('dropping');
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove('dropping');
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dropping');
    player.loadFile(event.dataTransfer.files[0]);
  });

  return {
    update() {
      loadButton.disabled = player.isLoading;
      loadButton.textContent = player.isLoading ? 'Loading…' : 'Load audio';
      playButton.disabled = !player.isLoaded;
      playButton.textContent = player.isPlaying ? 'Pause' : 'Play';
      clearButton.disabled = !player.isLoaded;
      filename.textContent = player.filename || 'No audio selected';
      status.textContent =
        player.error ||
        (player.isLoading
          ? 'Decoding audio…'
          : player.isLoaded
            ? player.isPlaying
              ? 'Playing. Drag the canvas to rotate.'
              : ''
            : 'Load an audio file.');
    },
  };
}
