import type { DocumentSection, DocumentStatus, DocumentType, OrderDocument, OrderDocumentSettings, OrderDocumentSettingsUpdate } from '@workspace/api-client-react';

export const DOC_TYPES: DocumentType[] = ['cutting_program', 'packing_list'];
export const DOC_TYPE_LABELS: Record<DocumentType, string> = { cutting_program: 'Cutting program', packing_list: 'Packing list' };

export const STATUS_INFO: Record<DocumentStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  in_review: { label: 'In review', tone: 'blue' },
  changes_requested: { label: 'Changes requested', tone: 'warn' },
  approved: { label: 'Approved', tone: '' },
  superseded: { label: 'Superseded', tone: 'neutral' },
};
export function statusInfo(status: string) {
  return STATUS_INFO[status as DocumentStatus] ?? { label: status.replaceAll('_', ' '), tone: 'neutral' };
}

export type DocGroup = { type: DocumentType; latest: OrderDocument | null; history: OrderDocument[] };
/** One group per document type; newest revision first. */
export function groupDocuments(docs: OrderDocument[] | undefined): DocGroup[] {
  return DOC_TYPES.map((type) => {
    const list = (docs ?? []).filter((d) => d.type === type).sort((a, b) => b.revision - a.revision);
    return { type, latest: list[0] ?? null, history: list.slice(1) };
  });
}

/** A new revision may be started only when no open (non-final) revision exists. */
export function canStartRevision(group: DocGroup) {
  return !group.latest || group.latest.status === 'approved' || group.latest.status === 'superseded';
}

export type SectionForm = { description: string; quality: string };
export type DocForm = { allowancePct: string; pcsPerCarton: string; previousReference: string; remarks: string; sections: Record<string, SectionForm> };

export function settingsToForm(settings: OrderDocumentSettings, sections: Pick<DocumentSection, 'lineId'>[] = []): DocForm {
  const out: Record<string, SectionForm> = {};
  const ids = sections.map((s) => s.lineId).concat(Object.keys(settings.sections ?? {})).filter((id, i, all) => all.indexOf(id) === i);
  for (const id of ids) {
    const s = settings.sections?.[id];
    out[id] = { description: s?.description ?? '', quality: s?.quality ?? '' };
  }
  return {
    allowancePct: String(settings.allowancePct ?? 5),
    pcsPerCarton: settings.pcsPerCarton != null ? String(settings.pcsPerCarton) : '',
    previousReference: settings.previousReference ?? '',
    remarks: settings.remarks ?? '',
    sections: out,
  };
}

export function formsEqual(a: DocForm, b: DocForm) {
  if (a.allowancePct.trim() !== b.allowancePct.trim() || a.pcsPerCarton.trim() !== b.pcsPerCarton.trim() || a.previousReference.trim() !== b.previousReference.trim() || a.remarks.trim() !== b.remarks.trim()) return false;
  const keys = Object.keys(a.sections).concat(Object.keys(b.sections));
  for (const k of keys) {
    const x = a.sections[k] ?? { description: '', quality: '' };
    const y = b.sections[k] ?? { description: '', quality: '' };
    if (x.description.trim() !== y.description.trim() || x.quality.trim() !== y.quality.trim()) return false;
  }
  return true;
}

export function validateDocForm(f: DocForm): string | null {
  const allowance = Number(f.allowancePct);
  if (f.allowancePct.trim() === '' || !Number.isFinite(allowance) || allowance < 0 || allowance > 50) return 'Allowance must be between 0 and 50%.';
  if (f.pcsPerCarton.trim()) {
    const p = Number(f.pcsPerCarton);
    if (!Number.isInteger(p) || p < 1 || p > 10000) return 'Pieces per carton must be a whole number from 1 to 10,000.';
  }
  if (f.previousReference.trim().length > 120) return 'Previous reference can be at most 120 characters.';
  if (f.remarks.trim().length > 500) return 'Remarks can be at most 500 characters.';
  for (const s of Object.values(f.sections)) {
    if (s.description.trim().length > 600) return 'A description can be at most 600 characters.';
    if (s.quality.trim().length > 200) return 'A quality line can be at most 200 characters.';
  }
  return null;
}

export function formToUpdate(f: DocForm): OrderDocumentSettingsUpdate {
  const n = (v: string) => (v.trim() ? v.trim() : null);
  const sections: NonNullable<OrderDocumentSettingsUpdate['sections']> = {};
  for (const [id, s] of Object.entries(f.sections)) sections[id] = { description: n(s.description), quality: n(s.quality) };
  return {
    allowancePct: Number(f.allowancePct),
    pcsPerCarton: f.pcsPerCarton.trim() ? Number(f.pcsPerCarton) : null,
    previousReference: n(f.previousReference),
    remarks: n(f.remarks),
    sections,
  };
}

export function documentFileName(doc: Pick<OrderDocument, 'docNumber' | 'revision' | 'status'>, format: 'xlsx' | 'pdf') {
  const base = `${doc.docNumber}-rev${doc.revision}`.replace(/[^A-Za-z0-9._-]+/g, '_');
  return `${base}${doc.status === 'approved' || doc.status === 'superseded' ? '' : '-DRAFT'}.${format}`;
}

export function qtyText(v: number | null | undefined) { return v == null ? '-' : v.toLocaleString(); }
export function cartonRange(from: number, to: number) { return from === to ? String(from) : `${from}–${to}`; }
