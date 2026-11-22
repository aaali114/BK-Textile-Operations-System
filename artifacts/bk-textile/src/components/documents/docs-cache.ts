import type { QueryClient } from '@tanstack/react-query';
import {
  downloadOrderDocumentFile, getGetOrderDocumentQueryKey, getListDocumentsAwaitingApprovalQueryKey, getListOrderDocumentsQueryKey,
} from '@workspace/api-client-react';
import type { OrderDocument } from '@workspace/api-client-react';
import { refreshOrderCore } from '../orders/helpers';
import { documentFileName } from './doc-helpers';

export function refreshDocuments(client: QueryClient, orderId: string, saved?: OrderDocument) {
  if (saved) client.setQueryData(getGetOrderDocumentQueryKey(orderId, saved.id), saved);
  void client.invalidateQueries({ queryKey: getListOrderDocumentsQueryKey(orderId) });
  void client.invalidateQueries({ queryKey: getListDocumentsAwaitingApprovalQueryKey() });
  if (saved) void client.invalidateQueries({ queryKey: getGetOrderDocumentQueryKey(orderId, saved.id) });
  refreshOrderCore(client, orderId);
}

/** The generated call resolves to a Blob for file responses; save it under a readable name. */
export async function saveDocumentFile(doc: OrderDocument, format: 'xlsx' | 'pdf') {
  const blob = await downloadOrderDocumentFile(doc.orderId, doc.id, format, { responseType: 'blob' });
  const file = blob instanceof Blob ? blob : new Blob([blob as BlobPart]);
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = documentFileName(doc, format);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
