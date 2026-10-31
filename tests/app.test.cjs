const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const search = require('../search-utils.js');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('search finds words in saved transcripts and quick notes, ignoring case', () => {
  const session = {
    created: Date.now(),
    transcript: 'We reviewed the project plan.',
    notes: 'Agreed to send Alex the proposal by Friday.',
    summary: 'Decision: launch the pilot in June.'
  };
  assert.equal(search.matchesSearch(session, 'proposal'), true);
  assert.equal(search.matchesSearch(session, 'PROJECT'), true);
  assert.equal(search.matchesSearch(session, 'pilot'), true);
  assert.equal(search.matchesSearch(session, 'not mentioned'), false);
  assert.equal(search.matchesSearch(session, ''), true);
});

test('search result excerpt includes the matching phrase', () => {
  const excerpt = search.excerptFor('Agreed to send Alex the proposal by Friday.', 'proposal');
  assert.match(excerpt, /proposal/);
  assert.equal(search.excerptFor('No match here', 'proposal'), '');
});

test('page references only element IDs that exist in the HTML', () => {
  const html = read('index.html');
  const app = read('app.js');
  const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  const referenced = new Set(Array.from(app.matchAll(/\$\('([^']+)'\)/g), match => match[1]));
  const missing = Array.from(referenced).filter(id => !ids.has(id));
  assert.deepEqual(missing, []);
});

test('speech and summary language selectors include Hungarian', () => {
  const html = read('index.html');
  assert.match(html, /<option value="hu-HU">Hungarian<\/option>/);
  assert.match(html, /<option value="hu">Magyar<\/option>/);
});

test('saved sessions can be loaded into Quick Notes with transcript fallback', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /id="quickNotesStatus"/);
  assert.match(app, /Open in Quick Notes/);
  assert.match(app, /selectSessionForQuickNotes\(session\)/);
  assert.match(app, /TRANSCRIPT\\n' \+ session\.transcript/);
});

test('live transcript has Romanian, English, Hungarian translation targets', () => {
  const html = read('index.html');
  const app = read('app.js');
  const worker = read('worker.js');
  assert.match(html, /id="transcriptLanguage"[\s\S]*value="ro"[\s\S]*value="en"[\s\S]*value="hu"/);
  assert.match(app, /operation: 'translate'/);
  assert.match(worker, /body\.operation === 'translate'/);
});

test('manifest icons and offline cache assets exist', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const icon of manifest.icons) assert.equal(fs.existsSync(path.join(root, icon.src)), true, icon.src);
  const sw = read('sw.js');
  const assets = Array.from(sw.matchAll(/["']\.\/([^"']+)["']/g), match => match[1]).filter(Boolean);
  for (const asset of assets) assert.equal(fs.existsSync(path.join(root, asset)), true, asset);
});

test('all home-screen icon PNGs have the declared dimensions', () => {
  for (const size of [180, 192, 512]) {
    const png = fs.readFileSync(path.join(root, 'icon-' + size + '.png'));
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});
