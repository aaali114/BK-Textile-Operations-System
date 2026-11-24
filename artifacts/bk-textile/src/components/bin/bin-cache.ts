import type { QueryClient } from '@tanstack/react-query';
import { getGetOrderFilesQueryKey, getListBinQueryKey, getListDocumentsAwaitingApprovalQueryKey, getListOrderDocumentsQueryKey } from '@workspace/api-client-react';
import { refreshAfterEmailReapply } from '../orders/helpers';

/**
 * After anything moves into or out of the Bin: the order, its derived data
 * (breakdown, trims, fabrics, emails, activity), files, documents, the approval
 * queue and the Bin itself may all have changed.
 */
export function refreshAfterBinChange(client: QueryClient, orderId: string) {
  refreshAfterEmailReapply(client, orderId);
  void client.invalidateQueries({ queryKey: getGetOrderFilesQueryKey(orderId) });
  void client.invalidateQueries({ queryKey: getListOrderDocumentsQueryKey(orderId) });
  const docPrefix = `${getListOrderDocumentsQueryKey(orderId)[0]}/`;
  void client.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith(docPrefix) });
  void client.invalidateQueries({ queryKey: getListDocumentsAwaitingApprovalQueryKey() });
  void client.invalidateQueries({ queryKey: getListBinQueryKey() });
}
