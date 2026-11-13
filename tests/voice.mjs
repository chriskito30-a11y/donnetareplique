import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.__plays = 0;
    Audio.prototype.play = function () {
      window.__plays++;
      setTimeout(() => this.onended?.(new Event('ended')), 10);
      return Promise.resolve();
    };
  });
  const page = await context.newPage();
  const external = [];
  const errors = [];
  page.on('console', message => console.error('BROWSER:', message.type(), message.text()));
  page.on('requestfailed', request => console.error('REQUEST:', request.url(), request.failure()?.errorText));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173/') && !request.url().startsWith('blob:')) external.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'Nouveau texte' }).click();
  page.once('dialog', dialog => dialog.accept('ALICE'));
  await page.getByRole('button', { name: '+ Ajouter' }).click();
  await page.getByRole('button', { name: '+ Ligne' }).click();
  await page.locator('[data-line-text]').fill('Bonjour, voici ma réplique.');
  await page.locator('[data-line-text]').dispatchEvent('change');
  await page.getByRole('button', { name: 'Passer à la répétition' }).click();
  await page.locator('[data-action="toggle-rehearsal-options"]').click();
  assert.equal(await page.locator('.voice-assignment select option[value^="piper:"]').count(), 8);
  const voiceSelect = page.locator('.voice-assignment select');
  for (const [index, voice] of ['piper:siwis:0', 'piper:tom:0', 'piper:libritts:307'].entries()) {
    await voiceSelect.selectOption(voice);
    await page.getByRole('button', { name: 'Écouter' }).click();
    await page.waitForFunction(expected => window.__plays >= expected, index + 1, { timeout: 60_000 });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('Piper OK : Siwis, Tom et LibriTTS synthétisés localement, sans requête externe.');
} finally { await browser.close(); }
