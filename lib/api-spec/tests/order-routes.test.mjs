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
