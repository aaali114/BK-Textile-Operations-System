import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('Bin changes refresh rebuilt order data and all related surfaces', () => {
  const source = readFileSync(new URL('../src/components/bin/bin-cache.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const calls = [];
  const exports = {};
  const api = {
    getGetOrderFilesQueryKey: (id) => [`/orders/${id}/files`],
    getListOrderDocumentsQueryKey: (id) => [`/orders/${id}/documents`],
    getListDocumentsAwaitingApprovalQueryKey: () => ['/documents/awaiting-approval'],
    getListBinQueryKey: () => ['/bin'],
  };
  const client = { invalidateQueries: (args) => { calls.push(args); return Promise.resolve(); } };
  let rebuiltOrder;
  vm.runInNewContext(outputText, {
    exports,
    require: (name) => name === '@workspace/api-client-react' ? api : {
      refreshAfterEmailReapply: (cache, id) => {
        assert.equal(cache, client);
        rebuiltOrder = id;
      },
    },
  });
  exports.refreshAfterBinChange(client, 'fixture-order');
  assert.equal(rebuiltOrder, 'fixture-order');
  for (const path of ['/orders/fixture-order/files', '/orders/fixture-order/documents', '/documents/awaiting-approval', '/bin']) {
    assert.ok(calls.some((call) => call.queryKey?.[0] === path), path);
  }
  const details = calls.find((call) => call.predicate).predicate;
  assert.equal(details({ queryKey: ['/orders/fixture-order/documents/doc-a'] }), true);
  assert.equal(details({ queryKey: ['/orders/another-order/documents/doc-b'] }), false);
});
