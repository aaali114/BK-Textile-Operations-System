import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Pure Bin / email-upload helpers; only type imports, so nothing is stubbed.
const source = readFileSync(new URL("../src/components/bin/bin-helpers.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const h = {};
vm.runInNewContext(outputText, { exports: h, require: () => ({}) });

test("archive body omits blank reasons and trims text", () => {
  assert.deepEqual({ ...h.archiveBody("   ") }, {});
  assert.deepEqual({ ...h.archiveBody("  duplicate PO ") }, { reason: "duplicate PO" });
  assert.equal(h.reasonProblem("x".repeat(500)), null);
  assert.match(h.reasonProblem("x".repeat(501)), /500/);
});

test("cleared summary reads naturally", () => {
  assert.equal(h.clearedSummary({ sizes: 0, trims: 5, fabrics: 0, colours: 0, lines: 0, header: false }), "Removed 5 trims.");
  assert.equal(h.clearedSummary({ sizes: 12, trims: 1, fabrics: 2, colours: 0, lines: 0, header: true }), "Removed 12 size quantities, 1 trim and 2 fabrics. Order header details from that email were cleared.");
  assert.equal(h.clearedSummary({ sizes: 0, trims: 0, fabrics: 0, colours: 0, lines: 0, header: false }), "Nothing else needed clearing.");
  assert.equal(h.clearedSummary(undefined), "Nothing else needed clearing.");
});

test("eml checks extension and 25 MB limit", () => {
  assert.equal(h.emlFileProblem("PO 36572.EML", 1024), null);
  assert.match(h.emlFileProblem("PO 36572.msg", 1024), /\.eml/);
  assert.equal(h.emlFileProblem("a.eml", 25 * 1024 * 1024), null);
  assert.match(h.emlFileProblem("a.eml", 25 * 1024 * 1024 + 1), /25 MB/);
  assert.equal(h.dataUrlToBase64("data:message/rfc822;base64,QUJD"), "QUJD");
});

test("archived banner wording", () => {
  const fmt = () => "4 Mar 2026";
  assert.equal(h.archivedBannerText({ archivedAt: "x", archivedBy: "Rahim", archiveReason: "Buyer cancelled" }, fmt), "This order is in the Bin \u2014 deleted by Rahim on 4 Mar 2026: Buyer cancelled");
  assert.equal(h.archivedBannerText({ archivedAt: "x", archivedBy: "Rahim", archiveReason: " " }, fmt), "This order is in the Bin \u2014 deleted by Rahim on 4 Mar 2026");
});

test("document deletion rules", () => {
  assert.equal(h.canDeleteDocument("draft", true, "user"), true);
  assert.equal(h.canDeleteDocument("changes_requested", false, "admin"), false);
  assert.equal(h.canDeleteDocument("approved", true, "deputy"), false);
  assert.equal(h.canDeleteDocument("superseded", true, "admin"), true);
});

test("bin ordering and typed purge confirmation", () => {
  const sorted = h.sortBinNewestFirst([{ archivedAt: "2026-01-01T00:00:00Z", id: 1 }, { archivedAt: "2026-03-01T00:00:00Z", id: 2 }]);
  assert.deepEqual([...sorted.map((i) => i.id)], [2, 1]);
  const order = { kind: "order", orderRef: "4040/BK-SAS/2026", title: "Order" };
  assert.equal(h.purgeConfirmMatches(order, "4040/BK-SAS/2026 "), true);
  assert.equal(h.purgeConfirmMatches(order, "Order"), false);
  const file = { kind: "file", orderRef: "4040/BK-SAS/2026", title: "front.jpg" };
  assert.equal(h.purgeConfirmMatches(file, "front.jpg"), true);
  assert.equal(h.purgeConfirmMatches(file, ""), false);
});
