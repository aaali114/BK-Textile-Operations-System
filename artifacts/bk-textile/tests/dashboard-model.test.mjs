import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const filename = fileURLToPath(new URL('../src/components/dashboards/dashboard-model.ts', import.meta.url));
const output = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports }, { filename });
const model = module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const widget = { id: 'test', source: 'orders', viz: 'table', x: 0, y: 0, w: 6, h: 6 };

test('dashboard selection uses the explicit selection, then default, then template', () => {
  const list = { dashboards: [{ id: 'a', isDefault: false }, { id: 'b', isDefault: true }], template: {} };
  assert.equal(model.resolveSelection(list, null), 'b');
  assert.equal(model.resolveSelection(list, 'a'), 'a');
  assert.equal(model.resolveSelection(list, 'deleted'), 'b');
  assert.equal(model.resolveSelection(list, model.TEMPLATE_KEY), model.TEMPLATE_KEY);
  assert.equal(model.resolveSelection({ ...list, dashboards: [{ id: 'a' }] }, null), model.TEMPLATE_KEY);
});
test('inaccessible widgets never enter their data-loading path', () => {
  assert.equal(model.widgetAccess({ ...widget, accessible: false }, undefined), 'denied');
  assert.equal(model.widgetAccess(widget, []), 'unknown-source');
  assert.equal(model.widgetAccess(widget, [{ id: 'orders' }]), 'fetch');
});
test('grid save payload has twelve-column bounds and no server-only access fields', () => {
  const source = { ...widget, accessible: false, x: 30, y: -5, w: 30, h: 99, title: '  My orders  ', params: { days: 14 } };
  const saved = plain(model.sanitizeWidgets([source]))[0];
  assert.deepEqual(saved, { ...widget, x: 0, y: 0, w: 12, h: 20, title: 'My orders', params: { days: 14 } });
  assert.equal(source.x, 30);
  assert.equal(source.accessible, false);
  assert.equal(model.sanitizeWidgets(Array(35).fill(widget)).length, 30);
});
test('widget data identity changes with source, parameters, or access, not object key order', () => {
  const key = model.widgetDataKey({ ...widget, params: { a: 1, b: 2 } });
  assert.equal(key, model.widgetDataKey({ ...widget, params: { b: 2, a: 1 } }));
  assert.notEqual(key, model.widgetDataKey({ ...widget, params: { a: 2, b: 2 } }));
  assert.notEqual(key, model.widgetDataKey({ ...widget, source: 'materials', params: { a: 1, b: 2 } }));
  assert.notEqual(key, model.widgetDataKey({ ...widget, accessible: false, params: { a: 1, b: 2 } }));
});
test('numeric formatting preserves zero and missing values rather than inventing totals', () => {
  for (const value of [null, undefined, '', ' ', 'text', false, Infinity, NaN]) assert.equal(model.toNumber(value), null);
  assert.equal(model.toNumber('0'), 0);
  assert.equal(model.toNumber(12.5), 12.5);
  assert.equal(model.formatCell(null, 'money'), '—');
  assert.equal(model.formatCell(0, 'money', { currency: 'USD' }), 'USD 0.00');
  assert.equal(model.formatCell('2026-11-19', 'date').includes('2026'), true);
});
test('source options validate enums, whole-number ranges and serialize numeric parameters', () => {
  const integer = { name: 'days', type: 'integer', min: 1, max: 30, default: 7 };
  const option = { name: 'scope', type: 'enum', options: [{ value: 'mine', label: 'My department' }], default: 'mine' };
  assert.equal(model.paramError(integer, '7'), null);
  for (const value of ['', '1.5', '0', '31', 'Infinity']) assert.ok(model.paramError(integer, value));
  assert.equal(model.paramError(option, 'all'), 'Choose one of the options.');
  assert.equal(model.paramError(option, 'mine'), null);
  assert.deepEqual(plain(model.paramsFromText({ params: [integer, option] }, { days: '7', scope: 'mine' })), { days: 7, scope: 'mine' });
});
test('Everyone and department templates have distinct lookup and names remain within limits', () => {
  const everyone = { department: '*' };
  const merchandise = { department: 'merchandising' };
  assert.equal(model.findTemplate([everyone, merchandise], '*'), everyone);
  assert.equal(model.findTemplate([everyone, merchandise], 'merchandising'), merchandise);
  assert.equal(model.findTemplate([everyone], 'quality'), undefined);
  assert.equal(model.copyName('x'.repeat(80)).length, 80);
});
