import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/access/policy.ts', import.meta.url), 'utf8');
const policy = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: policy });
const plain = (value) => JSON.parse(JSON.stringify(value));
const user = (extra = {}) => ({
  userId: 'fictional-user', name: 'Demo Staff', email: 'demo@example.com',
  status: 'active', role: 'user', canManageUsers: false,
  areas: { dashboard: 'none', merchandising: 'read', department_work: 'none', materials: 'none', quality: 'none' },
  permissions: [], ...extra,
});

test('pending and disabled users have no area or special access', () => {
  for (const status of ['pending', 'disabled']) {
    const person = user({ status, role: 'admin', permissions: ['commercial_edit'], areas: { merchandising: 'write' } });
    assert.equal(policy.canReadArea(person, 'merchandising'), false);
    assert.equal(policy.canWriteArea(person, 'merchandising'), false);
    assert.equal(policy.hasPermission(person, 'commercial_edit'), false);
  }
});

test('area levels and special permissions are independent; legacy isAdmin never grants access', () => {
  for (const level of ['none', 'read', 'write']) {
    const person = user({ isAdmin: true, areas: { merchandising: level } });
    assert.equal(policy.canReadArea(person, 'merchandising'), level !== 'none');
    assert.equal(policy.canWriteArea(person, 'merchandising'), level === 'write');
    assert.equal(policy.hasPermission(person, 'invoice_override'), false);
  }
  const delegated = user({ isAdmin: false, permissions: ['invoice_override', 'intake_run'] });
  assert.equal(policy.hasPermission(delegated, 'invoice_override'), true);
  assert.equal(policy.hasPermission(delegated, 'intake_run'), true);
  assert.equal(policy.hasPermission(delegated, 'commercial_edit'), false);
  assert.equal(policy.canReadArea(undefined, 'dashboard'), false);
});

test('home chooses an allowed area and handles no-area users without redirect loops', () => {
  assert.equal(policy.firstAllowedPath(user()), '/orders');
  const noAreas = { dashboard: 'none', merchandising: 'none', department_work: 'none', materials: 'none', quality: 'none' };
  assert.equal(policy.firstAllowedPath(user({ areas: noAreas })), '/access');
  assert.equal(policy.firstAllowedPath(user({ areas: noAreas, canManageUsers: true })), '/users');
  assert.equal(policy.firstAllowedPath(user({ areas: { ...noAreas, quality: 'write' } })), '/quality');
});

test('operational saves omit every commercial field rather than resending locked values', () => {
  const update = {
    buyer: 'Demo Buyer', poNumber: 'DEMO-300', orderValue: null, currencyCode: null,
    quantity: 0, deliveryDate: '2027-01-01', poIssueDate: null, agencyName: null,
    previousOrderReference: null, endCustomer: null, priceTerms: null, paymentTerms: null,
    shipVia: null, countryOfOrigin: null, overShipTolerancePct: 0,
    style: 'Demo style', description: null, priority: 'normal', status: 'draft',
    pcsPerCarton: 24, garmentDescription: 'Fictional cotton garment',
  };
  assert.deepEqual(plain(policy.permittedOrderUpdate(update, false)), {
    style: 'Demo style', description: null, priority: 'normal', status: 'draft',
    pcsPerCarton: 24, garmentDescription: 'Fictional cotton garment',
  });
  assert.deepEqual(plain(policy.permittedOrderUpdate(update, true)), update);
  assert.deepEqual(plain(policy.permittedOrderUpdate({ style: 'Only style' }, false)), { style: 'Only style' });
  assert.deepEqual(plain(policy.permittedOrderUpdate({ pcsPerCarton: null, garmentDescription: null }, false)), {
    pcsPerCarton: null, garmentDescription: null,
  });
});

test('preparing and approving documents require separate explicit permissions', () => {
  const preparer = user({ permissions: ['prepare_documents'] });
  assert.equal(policy.hasPermission(preparer, 'prepare_documents'), true);
  assert.equal(policy.hasPermission(preparer, 'approve_documents'), false);
  const approver = user({ permissions: ['approve_documents'] });
  assert.equal(policy.hasPermission(approver, 'approve_documents'), true);
  assert.equal(policy.hasPermission(approver, 'prepare_documents'), false);
  for (const status of ['pending', 'disabled']) {
    const inactive = user({ status, permissions: ['prepare_documents', 'approve_documents'] });
    assert.equal(policy.hasPermission(inactive, 'prepare_documents'), false);
    assert.equal(policy.hasPermission(inactive, 'approve_documents'), false);
  }
});
