import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/documents/doc-helpers.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const h = {};
vm.runInNewContext(outputText, { exports: h, require() { throw new Error("no runtime imports expected"); } });
const plain = (v) => JSON.parse(JSON.stringify(v));
const doc = (type, revision, status) => ({ id: `${type}-${revision}`, type, revision, status });

test("groups documents per type, newest revision first", () => {
  const g = h.groupDocuments([doc("packing_list", 1, "superseded"), doc("packing_list", 2, "approved"), doc("cutting_program", 1, "draft")]);
  assert.equal(g[0].latest.id, "cutting_program-1");
  assert.equal(g[1].latest.revision, 2);
  assert.deepEqual(g[1].history.map((d) => d.revision), [1]);
  assert.equal(h.groupDocuments(undefined)[0].latest, null);
});

test("new revision only once the latest is final", () => {
  assert.equal(h.canStartRevision({ latest: null }), true);
  assert.equal(h.canStartRevision({ latest: doc("x", 1, "approved") }), true);
  assert.equal(h.canStartRevision({ latest: doc("x", 1, "in_review") }), false);
  assert.equal(h.canStartRevision({ latest: doc("x", 1, "changes_requested") }), false);
});

test("form round trip, dirty check and nulls", () => {
  const settings = { allowancePct: 5, pcsPerCarton: null, previousReference: null, remarks: "  ", sections: { a: { description: "L1\nL2", quality: null } } };
  const f = h.settingsToForm(settings, [{ lineId: "a" }, { lineId: "b" }]);
  assert.equal(f.allowancePct, "5");
  assert.deepEqual(plain(f.sections.b), { description: "", quality: "" });
  assert.equal(h.formsEqual(f, { ...f, remarks: "" }), true);
  assert.equal(h.formsEqual(f, { ...f, pcsPerCarton: "12" }), false);
  assert.deepEqual(plain(h.formToUpdate({ ...f, pcsPerCarton: "24" })), {
    allowancePct: 5, pcsPerCarton: 24, previousReference: null, remarks: null,
    sections: { a: { description: "L1\nL2", quality: null }, b: { description: null, quality: null } },
  });
});

test("validation mirrors contract limits", () => {
  const base = { allowancePct: "5", pcsPerCarton: "", previousReference: "", remarks: "", sections: {} };
  assert.equal(h.validateDocForm(base), null);
  assert.match(h.validateDocForm({ ...base, allowancePct: "51" }), /Allowance/);
  assert.match(h.validateDocForm({ ...base, pcsPerCarton: "2.5" }), /carton/);
  assert.match(h.validateDocForm({ ...base, sections: { a: { description: "x".repeat(601), quality: "" } } }), /600/);
});

test("file names, statuses and quantities", () => {
  assert.equal(h.documentFileName({ docNumber: "CP/12 A", revision: 2, status: "draft" }, "pdf"), "CP_12_A-rev2-DRAFT.pdf");
  assert.equal(h.documentFileName({ docNumber: "PL-1", revision: 1, status: "approved" }, "xlsx"), "PL-1-rev1.xlsx");
  assert.equal(h.statusInfo("changes_requested").label, "Changes requested");
  assert.equal(h.qtyText(null), "-");
  assert.equal(h.cartonRange(3, 3), "3");
});
