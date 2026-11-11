import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the generated client itself: a misplaced operation in the API spec
// can otherwise typecheck successfully while sending saves to a read-only URL.
const source = readFileSync(
  new URL("../../api-client-react/src/generated/api.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
});
const requests = [];
const client = {};
vm.runInNewContext(outputText, {
  exports: client,
  require(name) {
    if (name === "@tanstack/react-query") return {};
    if (name === "../custom-fetch") {
      return {
        customFetch: async (url, options) => {
          requests.push({ url, ...options });
          return {};
        },
      };
    }
    throw new Error(`Unexpected dependency: ${name}`);
  },
});
const orderId = "10000000-0000-4000-8000-000000000001";

test("order edits PATCH the order, not its activity log", async () => {
  const input = { buyer: "Updated buyer", agencyName: "", orderValue: 1250, currencyCode: "USD" };
  await client.updateOrder(orderId, input);
  const request = requests.pop();
  assert.equal(request.url, `/api/orders/${orderId}`);
  assert.equal(request.method, "PATCH");
  assert.deepEqual(JSON.parse(request.body), input);
});

test("status changes use the same order update route", async () => {
  await client.updateOrder(orderId, { status: "in_production" });
  const request = requests.pop();
  assert.equal(request.url, `/api/orders/${orderId}`);
  assert.equal(request.method, "PATCH");
  assert.deepEqual(JSON.parse(request.body), { status: "in_production" });
});

test("order details and activity remain separate read endpoints", async () => {
  await client.getOrder(orderId);
  const order = requests.pop();
  assert.equal(order.url, `/api/orders/${orderId}`);
  assert.equal(order.method, "GET");
  await client.getOrderActivity(orderId);
  const activity = requests.pop();
  assert.equal(activity.url, `/api/orders/${orderId}/activity`);
  assert.equal(activity.method, "GET");
});

const emailId = "20000000-0000-4000-8000-000000000002";

test("order detail endpoints are read-only GETs under the order", async () => {
  for (const [fn, suffix] of [["getOrderBreakdown", "breakdown"], ["getOrderFabrics", "fabrics"], ["getOrderTrims", "trims"], ["getOrderEmails", "emails"]]) {
    await client[fn](orderId);
    const request = requests.pop();
    assert.equal(request.url, `/api/orders/${orderId}/${suffix}`);
    assert.equal(request.method, "GET");
  }
});

test("reviewing an email link PATCHes that order's email, not the email globally", async () => {
  await client.updateOrderEmail(orderId, emailId, { matchStatus: "matched" });
  const request = requests.pop();
  assert.equal(request.url, `/api/orders/${orderId}/emails/${emailId}`);
  assert.equal(request.method, "PATCH");
  assert.deepEqual(JSON.parse(request.body), { matchStatus: "matched" });
});

test("invoice overrides use the restricted admin routes", async () => {
  await client.setInvoiceCounter({ lastNumber: 4100, reason: "align with books" });
  const counter = requests.pop();
  assert.equal(counter.url, "/api/admin/invoice-counter");
  assert.equal(counter.method, "PUT");
  await client.setOrderInvoiceNumber(orderId, { invoiceNumber: 4050, reason: "correction" });
  const order = requests.pop();
  assert.equal(order.url, `/api/admin/orders/${orderId}/invoice`);
  assert.equal(order.method, "PUT");
});
