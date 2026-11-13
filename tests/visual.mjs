import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:4173/');
  await page.screenshot({ path: 'tests/preview-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Importer un texte' }).click();
  await page.locator('#paste-text').fill('SCÈNE 1\n\nLÉA : On commence ?\nMARC : Oui, la salle est prête.\nLÉA : Alors, allons-y.');
  await page.getByRole('button', { name: 'Préparer le texte collé' }).click();
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await page.locator('[data-project-field="selectedRoleId"]').selectOption({ label: 'LÉA' });
  await page.getByRole('button', { name: 'Passer à la répétition' }).click();
  await page.locator('[data-setting="displayMode"]').selectOption('initials');
  await page.getByRole('button', { name: 'Suivant', exact: false }).last().click();
  await page.screenshot({ path: 'tests/preview-repetition-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'tests/preview-repetition-mobile.png', fullPage: true });
  console.log('Aperçus générés.');
} finally { await browser.close(); }
