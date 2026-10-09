# Audio Spectral Node Graph

[Open the app](https://arthifact.github.io/audio_spectral_node_graph/)

A browser-based audio visualizer built with p5.js and Web Audio. Press Play for the default piano track, or load your own audio. Drag to rotate. Audio is processed locally.

Each node represents a moment of sound. The FFT gives magnitudes $A_k$ at frequencies $f_k$. Two features describe the spectrum:

$$
C = \frac{\sum_k f_k A_k}{\sum_k A_k}, \qquad
S = \sqrt{\frac{\sum_k (f_k-C)^2 A_k}{\sum_k A_k}}
$$

$C$ is the spectral centroid (mean frequency); $S$ is the spectral spread. Their recent ranges set node position; the balance between low and high frequencies sets depth. Centroid sets color, relative RMS level sets size, and spectral changes create pulses. Connections link nearby moments. Recent nodes are white; older ones fade. Sensitivity adapts without changing playback volume.

To run locally with Node.js 22 or newer:

```sh
npm ci
npm start
```

Open <http://127.0.0.1:8000>.

Default audio: [Midsummer Sky](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100158) by Kevin MacLeod (incompetech.com), 1:54, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Original recording, unchanged.
