import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const host = '127.0.0.1';
const port = 4173;
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  try {
    const pathname = new URL(request.url, `http://${host}:${port}`).pathname;
    const target = resolve(root, '.' + decodeURIComponent(pathname));
    const rel = relative(root, target);
    if (rel.startsWith('..') || rel.startsWith('/') || rel.startsWith('\\')) {
      response.writeHead(403).end();
      return;
    }
    const file = pathname === '/' ? join(root, 'index.html') : target;
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Fichier introuvable');
    response.writeHead(200, {
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end('Fichier introuvable');
  }
});

server.on('error', error => {
  console.error(`Démarrage impossible sur ${host}:${port} : ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  const url = `http://${host}:${port}/`;
  console.log(`Atelier de répliques : ${url}`);
  console.log('Fermez cette fenêtre pour arrêter le serveur local.');
  if (process.platform === 'win32' && !process.argv.includes('--no-browser')) {
    execFile('explorer.exe', [url], error => {
      if (error) console.log(`Ouvrez cette adresse dans votre navigateur : ${url}`);
    });
  }
});
