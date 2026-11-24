import { type ChangeEvent, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FilePlus2, Shirt, Trash2, Upload } from 'lucide-react';
import { getGetOrderFilesQueryKey, useArchiveOrderFile, useCompleteOrderFileUpload, useGetOrderFiles, useRequestOrderFileUpload } from '@workspace/api-client-react';
import type { OrderFile } from '@workspace/api-client-react';
import { Notice, QueryError, SkeletonRows, errorMessage } from './ui';
import { useAccess } from '../access/AccessProvider';
import { apiErrorInfo } from './helpers';
import { MoveToBinDialog } from '../bin/MoveToBinDialog';
import { archiveBody } from '../bin/bin-helpers';
import { refreshAfterBinChange } from '../bin/bin-cache';

export function OrderFilesPanel({ orderId }: { orderId: string }) {
  const writable = useAccess().canWrite('merchandising');
  const client = useQueryClient();
  const filesQuery = useGetOrderFiles(orderId, { query: { queryKey: getGetOrderFilesQueryKey(orderId), enabled: !!orderId } });
  const requestUpload = useRequestOrderFileUpload();
  const completeUpload = useCompleteOrderFileUpload();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const archiveFile = useArchiveOrderFile();
  const [binTarget, setBinTarget] = useState<OrderFile | null>(null);
  const [binError, setBinError] = useState<string | null>(null);
  const moveToBin = (reason: string) => {
    if (!binTarget) return;
    const name = binTarget.originalName;
    setBinError(null);
    archiveFile.mutate({ orderId, fileId: binTarget.id, data: archiveBody(reason) }, {
      onSuccess: () => {
        client.setQueryData<OrderFile[]>(getGetOrderFilesQueryKey(orderId), (old) => old?.filter((f) => f.id !== binTarget.id));
        refreshAfterBinChange(client, orderId);
        setBinTarget(null);
        setNotice({ message: `${name} moved to the Bin.` });
      },
      onError: (err) => setBinError(apiErrorInfo(err).message),
    });
  };
  const trashButton = (file: OrderFile) => writable && <button type="button" className="trash-btn" onClick={() => { setBinError(null); setBinTarget(file); }} aria-label={`Delete ${file.originalName}`} title="Move to the Bin" data-testid={`button-delete-file-${file.id}`}><Trash2 size={15} /></button>;
  const documentsInput = useRef<HTMLInputElement>(null);
  const imagesInput = useRef<HTMLInputElement>(null);
  const files = filesQuery.data as OrderFile[] | undefined;
  const documents = files?.filter((file) => file.fileType === 'document') ?? [];
  const images = files?.filter((file) => file.fileType === 'garment_image') ?? [];

  const uploadFile = async (file: File, fileType: 'document' | 'garment_image') => {
    if (!writable) return;
    setBusy(true);
    setNotice(null);
    try {
      const requested = await requestUpload.mutateAsync({
        orderId,
        data: { fileType, name: file.name, contentType: file.type, sizeBytes: file.size },
      });
      const put = await fetch(requested.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!put.ok) throw new Error(`Private storage rejected the upload (${put.status}).`);
      await completeUpload.mutateAsync({ orderId, fileId: requested.fileId });
      await client.invalidateQueries({ queryKey: getGetOrderFilesQueryKey(orderId) });
      setNotice({ message: `${file.name} uploaded to this order.` });
    } catch (error) {
      setNotice({ message: errorMessage(error), error: true });
    } finally {
      setBusy(false);
    }
  };

  const selectFile = (fileType: 'document' | 'garment_image') => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void uploadFile(file, fileType);
  };

  const uploadButton = (label: string, onClick: () => void) => (
    writable && <button className="btn btn-quiet" type="button" onClick={onClick} disabled={busy}>
      <Upload size={14} />{busy ? 'Uploading…' : label}
    </button>
  );

  const fileDetails = (file: OrderFile) => (
    <span>
      {file.uploadedByName} · {new Date(file.uploadedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
    </span>
  );

  return <>
    {notice && <Notice message={notice.message} error={notice.error} onClose={() => setNotice(null)} />}
    <div className="order-support-grid">
      <section className="panel">
        <div className="panel-head">
          <div><p className="panel-kicker">Reference material</p><h2 className="panel-title">Documents</h2></div>
          {uploadButton('Add document', () => documentsInput.current?.click())}
          <input ref={documentsInput} hidden disabled={!writable} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain" onChange={selectFile('document')} />
        </div>
        {filesQuery.isError ? <div className="document-list"><QueryError onRetry={() => filesQuery.refetch()} /></div> : filesQuery.isLoading ? <div className="document-list"><SkeletonRows count={2} /></div> : <div className="document-list">
          {documents.length ? documents.map((file) => <div className="document-row" key={file.id}>
            <span className="document-icon"><FilePlus2 size={16} /></span>
            <div className="document-copy"><strong>{file.originalName}</strong>{fileDetails(file)}</div>
            <a className="btn btn-quiet file-download" href={`/api/orders/${orderId}/files/${file.id}/content`} aria-label={`Download ${file.originalName}`}><Download size={14} />Download</a>
            {trashButton(file)}
          </div>) : <p className="support-note">No order documents uploaded. Files are stored privately on this order.</p>}
        </div>}
      </section>
      <section className="panel">
        <div className="panel-head">
          <div><p className="panel-kicker">Style reference</p><h2 className="panel-title">Garment pictures</h2></div>
          {uploadButton('Add picture', () => imagesInput.current?.click())}
          <input ref={imagesInput} hidden disabled={!writable} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={selectFile('garment_image')} />
        </div>
        {filesQuery.isError ? <div className="document-list"><QueryError onRetry={() => filesQuery.refetch()} /></div> : filesQuery.isLoading ? <div className="document-list"><SkeletonRows count={2} /></div> : images.length ? <div className="garment-image-list">
          {images.map((file) => <article className="garment-image-card" key={file.id}>
            <a href={`/api/orders/${orderId}/files/${file.id}/preview`} target="_blank" rel="noreferrer" aria-label={`View ${file.originalName}`}>
              <img src={`/api/orders/${orderId}/files/${file.id}/preview`} alt={file.originalName} loading="lazy" />
            </a>
            <div className="document-copy"><strong>{file.originalName}</strong>{fileDetails(file)}</div>
            <span style={{ display: 'flex', gap: 4 }}><a className="icon-btn" href={`/api/orders/${orderId}/files/${file.id}/content`} aria-label={`Download ${file.originalName}`}><Download size={15} /></a>{trashButton(file)}</span>
          </article>)}
        </div> : <div className="image-unavailable"><Shirt size={24} strokeWidth={1.5} /><strong>No garment pictures uploaded</strong><span>Upload a JPEG, PNG, or WebP image (up to 25 MB) for this order.</span></div>}
      </section>
    </div>
    {binTarget && <MoveToBinDialog testId="dialog-delete-file" title={binTarget.fileType === 'garment_image' ? 'Delete this picture?' : 'Delete this file?'} subject={binTarget.originalName} busy={archiveFile.isPending} error={binError} onConfirm={moveToBin} onClose={() => setBinTarget(null)} />}
  </>;
}

