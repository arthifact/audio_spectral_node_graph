import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = process.argv.includes('--built')
  ? resolve(project, 'dist')
  : project;
const port = Number(process.env.PORT || 8000);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
};

createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, 'http://localhost').pathname,
    );
    const parts = pathname.split('/');
    const path = resolve(
      root,
      '.' + (pathname === '/' ? '/index.html' : pathname),
    );
    if (
      !path.startsWith(root + sep) ||
      parts.some((part) => part.startsWith('.'))
    ) {
      response.writeHead(404).end('Not found');
      return;
    }
    const content = await readFile(path);
    response.writeHead(200, {
      'Content-Type': types[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    const status = error instanceof URIError ? 400 : 404;
    response
      .writeHead(status)
      .end(status === 400 ? 'Bad request' : 'Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Audio Spectral Node Graph: http://127.0.0.1:${port}`);
});
