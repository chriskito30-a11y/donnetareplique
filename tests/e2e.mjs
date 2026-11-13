import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
const external = [];
const failed = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:4173/')) external.push(req.url()); });
page.on('requestfailed', req => failed.push(`${req.url()} ${req.failure()?.errorText}`));
try {
  await page.goto('http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'Nouveau texte' }).click();
  page.once('dialog', dialog => dialog.accept('LÉA'));
  await page.getByRole('button', { name: '+ Ajouter' }).click();
  await page.getByRole('button', { name: '+ Ligne' }).click();
  await page.locator('[data-line-text]').fill('Je connais mon texte.');
  await page.locator('[data-line-text]').dispatchEvent('change');
  const roleId = await page.locator('[data-character-name]').getAttribute('data-character-name');
  assert.ok(roleId);
  await page.locator('[data-line-character]').selectOption(roleId);
  await page.locator('[data-project-field="selectedRoleId"]').selectOption(roleId);
  await page.getByRole('button', { name: 'Passer à la répétition' }).click();
  assert.match(await page.locator('.stage-text').innerText(), /Je connais mon texte/);
  await page.locator('[data-action="toggle-rehearsal-options"]').click();
  await page.locator('[data-setting="displayMode"]').selectOption('hidden');
  assert.match(await page.locator('.stage-text').innerText(), /masquée/);
  await page.getByRole('button', { name: 'Indice' }).click();
  assert.match(await page.locator('.stage-text').innerText(), /Je connais mon texte/);
  await page.reload();
  await page.getByRole('button', { name: 'Répéter', exact: true }).click();
  assert.match(await page.locator('.stage-text').innerText(), /masquée/);
  await page.getByRole('button', { name: 'Réglages et données' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter ce projet avec ses sons' }).click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith('.zip'));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  assert.match(await page.locator('h1').innerText({ timeout: 5000 }), /Bibliothèque/);
  await page.getByRole('button', { name: 'Répéter', exact: true }).click();
  assert.match(await page.locator('.stage-text').innerText(), /masquée/);
  await page.getByRole('button', { name: 'Réglages et données' }).click();
  const archive = await readFile(await download.path());
  await page.locator('#backup-file').setInputFiles({ name: 'sauvegarde.zip', mimeType: 'application/zip', buffer: archive });
  await page.getByRole('button', { name: 'Bibliothèque' }).click();
  assert.equal(await page.locator('.project-card').count(), 2);
  assert.deepEqual(failed, []);
  assert.equal(external.length, 0, `Requêtes externes : ${external.join(', ')}`);
  assert.deepEqual(errors, []);
  console.log('E2E OK : édition, mémorisation, persistance, export, rechargement hors ligne, aucune requête externe.');
} finally {
  await browser.close();
}
