import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const context = await browser.newContext({ permissions: ['microphone'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'Nouveau texte' }).click();
  await page.getByRole('button', { name: '+ Ligne' }).click();
  await page.locator('[data-line-text]').fill('Une prise de test.');
  await page.locator('[data-line-text]').dispatchEvent('change');
  await page.locator('[data-action="record-line"]').click();
  await page.waitForTimeout(900);
  await page.locator('[data-action="record-line"]').click();
  await page.getByText('Prise enregistrée sur cet appareil.').waitFor();
  const size = await page.evaluate(async () => {
    const req = indexedDB.open('atelier-repliques-local');
    const db = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const tx = db.transaction('recordings');
    const rows = await new Promise((resolve, reject) => { const get = tx.objectStore('recordings').getAll(); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
    return rows[0]?.blob?.size ?? 0;
  });
  assert.ok(size > 0, 'La prise audio doit être enregistrée dans IndexedDB.');
  await page.reload();
  await page.getByRole('button', { name: 'Préparer', exact: true }).click();
  await page.locator('[data-action="listen-line"]').click();
  assert.deepEqual(errors, []);
  console.log(`Enregistrement OK : ${size} octets en IndexedDB, disponibles après rechargement.`);
} finally { await browser.close(); }
