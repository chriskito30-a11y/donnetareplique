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

async function makeDocx(text, boldSpeaker = false) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const paragraphs = boldSpeaker
    ? `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>NANCY</w:t></w:r></w:p><w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
    : `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`);
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
  await page.locator('#script-file').setInputFiles({ name: 'essai.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await makeDocx('Bonjour DOCX', true) });
  await page.getByRole('button', { name: 'Créer le projet' }).waitFor();
  assert.match(await page.locator('.preview-list').innerText(), /Bonjour DOCX/);
  assert.match(await page.locator('.preview-list').innerText(), /NANCY/);
  await page.getByRole('button', { name: 'Créer le projet' }).click();
  await page.getByRole('button', { name: 'Importer un texte' }).click();
  await page.locator('#script-file').setInputFiles({ name: 'essai.txt', mimeType: 'text/plain', buffer: Buffer.from('CLARA : Bonjour TXT') });
  await page.getByRole('button', { name: 'Créer le projet' }).waitFor();
  assert.match(await page.locator('.preview-list').innerText(), /Bonjour TXT/);
  await page.getByRole('button', { name: 'Importer un texte' }).click();
  const noisyScript = [
    'LA CANTATRICE CHAUVE', 'Une pièce de théâtre', 'Page 1', 'ACTE I', 'SCÈNE 1',
    'NANCY', '(Elle entre.)', 'Bonjour, Monsieur.', 'MICHAEL : Je suis ici.', '2',
  ].join('\n');
  await page.locator('#script-file').setInputFiles({ name: 'piece.txt', mimeType: 'text/plain', buffer: Buffer.from(noisyScript) });
  await page.getByRole('button', { name: 'Créer le projet' }).waitFor();
  const preview = await page.locator('.preview-list').innerText();
  assert.match(preview, /ACTE I/);
  assert.match(preview, /SCÈNE 1/);
  assert.match(preview, /NANCY/);
  assert.match(preview, /MICHAEL/);
  assert.match(preview, /Bonjour, Monsieur/);
  assert.doesNotMatch(preview, /CANTATRICE|théâtre|Page 1|\n2\n/);
  assert.deepEqual(errors, []);
  console.log('Imports OK : formats locaux, noms de personnages, scènes et folios filtrés.');
} finally { await browser.close(); }
