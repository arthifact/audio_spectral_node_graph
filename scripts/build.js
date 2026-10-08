import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'vendor'), { recursive: true });
for (const path of ['src', 'style.css']) {
  await cp(resolve(root, path), resolve(output, path), { recursive: true });
}
for (const name of ['p5.min.js', 'addons/p5.sound.min.js']) {
  await cp(
    resolve(root, 'node_modules/p5/lib', name),
    resolve(output, 'vendor', name.split('/').at(-1)),
  );
}
await cp(
  resolve(root, 'node_modules/p5/license.txt'),
  resolve(output, 'vendor/LICENSE-p5.txt'),
);
const html = (await readFile(resolve(root, 'index.html'), 'utf8'))
  .replace(
    'https://cdn.jsdelivr.net/npm/p5@1.11.12/lib/p5.js',
    'vendor/p5.min.js',
  )
  .replace(
    'https://cdn.jsdelivr.net/npm/p5@1.11.12/lib/addons/p5.sound.min.js',
    'vendor/p5.sound.min.js',
  );
await writeFile(resolve(output, 'index.html'), html);
await writeFile(resolve(output, '.nojekyll'), '');
console.log('Static site built in dist/ (audio files are never included).');
