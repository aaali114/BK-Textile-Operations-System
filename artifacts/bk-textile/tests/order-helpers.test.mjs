import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Run the UI's actual helpers, with only the generated query-key imports stubbed.
// No server requests, database writes, or real order fixtures are involved.
const source = readFileSync(new URL("../src/components/orders/helpers.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
});
const helpers = {};
vm.runInNewContext(outputText, {
  exports: helpers,
  require(name) {
    assert.equal(name, "@workspace/api-client-react");
    return new Proxy({}, { get: (_, key) => (...args) => [key, ...args] });
  },
});
const plain = (value) => JSON.parse(JSON.stringify(value));

test("invoice reference takes priority, with legacy reference fallback", () => {
  assert.deepEqual(plain(helpers.invoiceDisplay({ invoiceRef: "9001/BK-DEMO/2027", reference: "old" })),
    { value: "9001/BK-DEMO/2027", legacy: false });
  assert.deepEqual(plain(helpers.invoiceDisplay({ invoiceRef: null, reference: "TEST-EXAMPLE" })),
    { value: "TEST-EXAMPLE", legacy: true });
});

test("structured changes preserve zero, false, null, and empty strings", () => {
  assert.equal(helpers.changeValueText(0), "0");
  assert.equal(helpers.changeValueText(false), "false");
  assert.equal(helpers.changeValueText(null), "null");
  assert.equal(helpers.changeValueText(""), '""');
  assert.equal(helpers.changeValueText(undefined), "not set");
  const changes = helpers.readChanges({ changes: [null, "bad", { field: "quantity", from: 0, to: 20 }] });
  assert.deepEqual(plain(changes), [{ field: "quantity", from: 0, to: 20 }]);
  assert.equal(helpers.readChanges({ changes: "not an array" }).length, 0);
});

test("invoice changes need a positive integer and meaningful trimmed reason", () => {
  for (const value of ["", "0", "-1", "1.2", "NaN", "Infinity"]) {
    assert.ok(helpers.validInvoiceInput(value, "Fictional test reason"));
  }
  for (const reason of ["", "  ", " a ", "x".repeat(501)]) {
    assert.ok(helpers.validInvoiceInput("9001", reason));
  }
  assert.equal(helpers.validInvoiceInput("9001", "  Test reason  "), null);
});

test("create errors distinguish rejected input and duplicate POs", () => {
  assert.match(helpers.orderSaveErrorText({ status: 400, data: { error: "Unknown buyer" } }), /400.*Unknown buyer/);
  assert.match(helpers.orderSaveErrorText({ status: 409, data: { error: "PO already exists" } }), /Duplicate PO.*409.*PO already exists/);
  assert.equal(helpers.orderSaveErrorText(new Error("Offline")), "Offline");
});

test("missing amounts stay missing while actual zero is formatted", () => {
  assert.equal(helpers.moneyText(null, "USD"), null);
  assert.equal(helpers.moneyText(undefined, "USD"), null);
  assert.equal(helpers.moneyText(0, "USD"), "USD 0.00");
});

test("email reviews refresh every affected order view and source email", () => {
  const invalidated = [];
  helpers.refreshAfterEmailReview({ invalidateQueries: ({ queryKey }) => invalidated.push(plain(queryKey)) }, "fictional-order", "fictional-email");
  assert.deepEqual(invalidated.map((key) => key[0]).sort(), [
    "getGetDashboardSummaryQueryKey", "getGetOrderActivityQueryKey", "getGetOrderBreakdownQueryKey",
    "getGetOrderEmailQueryKey", "getGetOrderEmailsQueryKey", "getGetOrderFabricsQueryKey",
    "getGetOrderQueryKey", "getGetOrderTrimsQueryKey", "getGetOrdersQueryKey",
  ].sort());
  assert.deepEqual(invalidated.find((key) => key[0] === "getGetOrderEmailQueryKey"),
    ["getGetOrderEmailQueryKey", "fictional-order", "fictional-email"]);
});
