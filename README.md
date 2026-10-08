# Audio Spectral Node Graph

[Open the app](https://arthifact.github.io/audio_spectral_node_graph/)

A browser-based audio visualizer built with p5.js and Web Audio. Load your own audio, press Play, and drag to rotate. Audio is processed locally.

Each node represents a moment of sound. The FFT gives magnitudes $A_k$ at frequencies $f_k$. Two features describe the spectrum:

$$
C = \frac{\sum_k f_k A_k}{\sum_k A_k}, \qquad
S = \sqrt{\frac{\sum_k (f_k-C)^2 A_k}{\sum_k A_k}}
$$

$C$ is the spectral centroid (mean frequency); $S$ is the spectral spread. They set node position, while the balance between low and high frequencies sets depth. Centroid sets color, RMS signal level sets size, and spectral changes start new bursts. Connections link nearby moments.

To run locally with Node.js 22 or newer:

```sh
npm ci
npm start
```

Open <http://127.0.0.1:8000>.
