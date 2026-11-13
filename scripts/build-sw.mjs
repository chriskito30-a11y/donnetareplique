import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
async function files(dir) {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) result.push(...await files(path));
    else if (item.name !== 'sw.js') result.push(path);
  }
  return result;
}
const paths = (await files(root)).sort();
const entries = paths.map(path => relative(root, path).split(sep).join('/'));
const hash = createHash('sha256');
for (let i = 0; i < paths.length; i++) hash.update(entries[i]).update(await readFile(paths[i]));
const digest = hash.digest('hex').slice(0, 12);
const source = `const CACHE = 'atelier-repliques-${digest}';\nconst ASSETS = ${JSON.stringify(entries.map(x => './' + x))};\nself.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())); });\nself.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('atelier-repliques-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });\nself.addEventListener('fetch', event => { if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return; event.respondWith(caches.open(CACHE).then(async cache => { const hit = await cache.match(event.request.url, { ignoreVary: true }); if (hit) return hit; if (event.request.mode === 'navigate') { const shell = await cache.match('./index.html', { ignoreVary: true }); if (shell) return shell; } return fetch(event.request); })); });\n`;
await writeFile(join(root, 'sw.js'), source);
console.log(`Service worker: ${entries.length} fichiers précachés (${digest})`);
