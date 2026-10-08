# Contributing

Keep this a small, understandable browser app. Separate audio lifecycle, controls, and spectral calculations from scene rendering. Add dependencies only when they make the project simpler to maintain.

## Work locally

Use Node.js 22 or newer. After cloning the repository:

```sh
npm ci
npm start
```

Open <http://127.0.0.1:8000>. Load your own audio; it stays in the browser. The source preview loads the pinned p5.js libraries from jsDelivr.

## Before a pull request

```sh
npm run format
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

The browser suite builds and serves the same `dist/` directory that is deployed. It uses synthesized WAV data, so tests require no music downloads or network access to a CDN. On Linux, install the browser and system libraries with `npx playwright install --with-deps chromium`.

For visual changes, also try a short track on desktop and a narrow viewport. Check loading, play/pause, track completion, replacement, drag-to-rotate, and fullscreen. For spectral changes, add tests using known bins or silence rather than relying on a screenshot.

Keep personal audio, credentials, and generated reports out of commits. Describe the final behavior and relevant validation in the pull request.

## Publishing

`npm run build` writes a standalone static site into `dist/`, including the pinned p5.js runtime and its license. Audio files, tests, and development tools are excluded.

GitHub Pages uses the **GitHub Actions** publishing source. Merging to `main` runs checks and browser tests before the `Deploy website` workflow publishes `dist/`. The `Checks` workflow also runs for pull requests. Repository maintainers can run the deployment manually from the Actions tab.
