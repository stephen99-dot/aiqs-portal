// The customer's logo must survive the client-copy pipeline end to end.
//
// Regression: the media check that guards against "Excel found a problem with
// some content" used to read the zip's xl/media/ DIRECTORY entry (zero bytes)
// as a broken image, so every client copy with a logo was quietly regenerated
// without it. Nobody's logo ever reached the client.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ExcelJS, AdmZip, generateClientCopyPro, generateClientCopyProSafe, mediaAllValid;
let DEPS_OK = true;
try {
  ExcelJS = require('exceljs');
  AdmZip = require('adm-zip');
  ({ generateClientCopyPro, generateClientCopyProSafe, mediaAllValid } = require('./builderExports'));
} catch (e) {
  DEPS_OK = false;
}

// A real 1×1 PNG, so the test needs no image tooling.
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const PARSED = {
  sections: [
    { number: '1', title: 'Preliminaries', items: [
      { itemRef: '1.1', description: 'Site set-up', unit: 'item', qty: 1, labour: 800, materials: 200, total: 1000 },
      { itemRef: '1.2', description: 'Skips', unit: 'no', qty: 4, labour: 0, materials: 1200, total: 1200 },
    ] },
    { number: '2', title: 'Groundworks', items: [
      { itemRef: '2.1', description: 'Excavate foundations', unit: 'm³', qty: 12.5, labour: 900, materials: 350, total: 1250 },
    ] },
  ],
};

function withLogo(fn) {
  const logoPath = path.join(os.tmpdir(), `cc-logo-${process.pid}-${Date.now()}.png`);
  fs.writeFileSync(logoPath, PNG_1PX);
  return fn(logoPath).finally(() => { try { fs.unlinkSync(logoPath); } catch (e) { /* ignore */ } });
}

async function imageCount(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.getWorksheet('Client Copy').getImages().length;
}

test('a client copy with a logo passes the media check and keeps the logo', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  await withLogo(async (logoPath) => {
    const branding = { company_name: 'Test Build Ltd', logo_path: logoPath, primary_colour: '#1B2A4A', accent_colour: '#F59E0B' };
    const raw = await generateClientCopyPro(PARSED, { vat: 20, branding, project_name: 'Test', client_name: 'Client' });
    assert.strictEqual(await imageCount(raw), 1, 'generator embeds the logo');
    assert.strictEqual(mediaAllValid(raw), true, 'a workbook whose only media is a real PNG is valid');

    const safe = await generateClientCopyProSafe(PARSED, { vat: 20, branding, project_name: 'Test', client_name: 'Client' });
    assert.strictEqual(await imageCount(safe), 1, 'the safe wrapper must not strip a valid logo');
  });
});

test('the media check still rejects a workbook carrying a non-image under xl/media', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  await withLogo(async (logoPath) => {
    const branding = { company_name: 'Test Build Ltd', logo_path: logoPath };
    const raw = await generateClientCopyPro(PARSED, { branding, project_name: 'Test', client_name: 'Client' });
    const zip = new AdmZip(raw);
    zip.addFile('xl/media/image9.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    assert.strictEqual(mediaAllValid(zip.toBuffer()), false, 'an SVG masquerading as a PNG is caught');
  });
});

test('a client copy without a logo has no media and passes the check', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const raw = await generateClientCopyPro(PARSED, { branding: { company_name: 'Test Build Ltd', logo_path: null }, project_name: 'Test', client_name: 'Client' });
  assert.strictEqual(await imageCount(raw), 0);
  assert.strictEqual(mediaAllValid(raw), true);
});
