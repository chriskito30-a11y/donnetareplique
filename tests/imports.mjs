import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { chromium } from 'playwright-core';

function makePdf(text) {
  const content = `BT /F1 14 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

async function makeDocx(text) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'Importer un texte' }).click();
  await page.locator('#script-file').setInputFiles({ name: 'essai.pdf', mimeType: 'application/pdf', buffer: makePdf('ALICE: Bonjour PDF') });
  await page.getByRole('button', { name: 'Créer le projet' }).waitFor();
  assert.match(await page.locator('.preview-list').innerText(), /Bonjour PDF/);
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await page.getByRole('button', { name: 'Importer un texte' }).click();
  await page.locator('#script-file').setInputFiles({ name: 'essai.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await makeDocx('BOB: Bonjour DOCX') });
  await page.getByRole('button', { name: 'Créer le projet' }).waitFor();
  assert.match(await page.locator('.preview-list').innerText(), /Bonjour DOCX/);
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await page.getByRole('button', { name: 'Importer un texte' }).click();
  await page.locator('#script-file').setInputFiles({ name: 'essai.txt', mimeType: 'text/plain', buffer: Buffer.from('CLARA : Bonjour TXT') });
  await page.getByRole('button', { name: 'Créer le projet' }).waitFor();
  assert.match(await page.locator('.preview-list').innerText(), /Bonjour TXT/);
  assert.deepEqual(errors, []);
  console.log('Imports OK : PDF textuel, DOCX et TXT lus localement.');
} finally { await browser.close(); }
