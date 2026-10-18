const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../www/offline-formats.js', `file://${__filename}`), 'utf8');

function loadParser({ ocr } = {}) {
  const pages = [
    { items: [{ str: 'This page already contains selectable PDF text.' }] },
    { items: [] }
  ];
  const calls = [];
  const pdf = {
    numPages: pages.length,
    getPage: async n => ({
      getTextContent: async () => ({ items: pages[n - 1].items }),
      getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => ({ promise: Promise.resolve() }),
      cleanup() { calls.push(`cleanup:${n}`); }
    }),
    destroy: async () => { calls.push('destroy'); }
  };
  const context = {
    window: { pdfjsLib: { getDocument: () => ({ promise: Promise.resolve(pdf) }) }, ...(ocr ? { Capacitor: { isNativePlatform: () => true }, ShuyinOCR: ocr } : {}) },
    document: { createElement: () => ({ getContext: () => ({}), toDataURL: () => 'data:image/jpeg;base64,abc' }) },
    Error, String, Math, Promise
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { parse: context.parseLocalBook, calls };
}

test('scanned PDF pages use on-device OCR and retain selectable text', async () => {
  const progress = [], seen = [];
  const { parse, calls } = loadParser({ ocr: { recognize: async ({ imageBase64 }) => { seen.push(imageBase64); return { text: 'OCR识别出的扫描页正文' }; } } });
  const result = await parse({ arrayBuffer: async () => new ArrayBuffer(0) }, 'pdf', { onProgress: (...row) => progress.push(row) });
  assert.match(result.content, /This page already contains selectable PDF text/);
  assert.match(result.content, /OCR识别出的扫描页正文/);
  assert.deepEqual(seen, ['abc']);
  assert.deepEqual(progress.map(x => x[0]), [1, 2]);
  assert.ok(calls.includes('destroy'));
});

test('scanned PDF import gives an explicit message when native OCR is unavailable', async () => {
  const { parse } = loadParser();
  await assert.rejects(
    parse({ arrayBuffer: async () => new ArrayBuffer(0) }, 'pdf'),
    /第 2 页没有可提取文字/); 
});
