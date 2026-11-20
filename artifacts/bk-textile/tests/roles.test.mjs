import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const filename = fileURLToPath(new URL('../src/components/access/roles.ts', import.meta.url));
const output = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: createRequire(import.meta.url) }, { filename });
const choices = (actor, user) => Array.from(module.exports.roleChoices(actor, user));
const admin = { userId: 'actor', role: 'admin', status: 'active', canManageUsers: true };
const staff = { id: 'staff', role: 'user', status: 'active' };

test('administrator can appoint both administrators and deputies without a transfer', () => {
  assert.deepEqual(choices(admin, staff), ['admin', 'deputy']);
  assert.deepEqual(choices(admin, { ...staff, role: 'deputy' }), ['admin', 'user']);
});
test('another administrator cannot be demoted, and deputies cannot appoint roles', () => {
  assert.deepEqual(choices(admin, { ...staff, role: 'admin' }), []);
  assert.deepEqual(choices({ ...admin, role: 'deputy' }, staff), []);
  assert.deepEqual(choices({ ...admin, status: 'disabled' }, staff), []);
  assert.deepEqual(choices({ ...admin, canManageUsers: false }, staff), []);
});
test('self step-down is separate from appointments and nonactive staff cannot be promoted', () => {
  assert.deepEqual(choices(admin, { id: 'actor', role: 'admin', status: 'active' }), ['deputy', 'user']);
  assert.deepEqual(choices(admin, { ...staff, status: 'pending' }), []);
  assert.deepEqual(choices(admin, { ...staff, role: 'deputy', status: 'disabled' }), ['user']);
});
