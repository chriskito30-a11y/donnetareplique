import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  assert.match(await page.locator('#app').innerText(), /OUVRIR_WEBAPP\.cmd/);
  await page.goto('http://127.0.0.1:4173/');
  assert.match(await page.locator('#app').innerText(), /Bibliothèque/);
  console.log('Ouverture OK : message explicatif en file://, interface complète sur localhost.');
} finally {
  await browser.close();
}
