import { type ChangeEvent, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FilePlus2, Shirt, Upload } from 'lucide-react';
import { getGetOrderFilesQueryKey, useCompleteOrderFileUpload, useGetOrderFiles, useRequestOrderFileUpload } from '@workspace/api-client-react';
import type { OrderFile } from '@workspace/api-client-react';
import { Notice, QueryError, SkeletonRows, errorMessage } from './ui';

export function OrderFilesPanel({ orderId }: { orderId: string }) {
  const client = useQueryClient();
  const filesQuery = useGetOrderFiles(orderId, { query: { queryKey: getGetOrderFilesQueryKey(orderId), enabled: !!orderId } });
  const requestUpload = useRequestOrderFileUpload();
  const completeUpload = useCompleteOrderFileUpload();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const documentsInput = useRef<HTMLInputElement>(null);
  const imagesInput = useRef<HTMLInputElement>(null);
  const files = filesQuery.data as OrderFile[] | undefined;
  const documents = files?.filter((file) => file.fileType === 'document') ?? [];
  const images = files?.filter((file) => file.fileType === 'garment_image') ?? [];

  const uploadFile = async (file: File, fileType: 'document' | 'garment_image') => {
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
    <button className="btn btn-quiet" type="button" onClick={onClick} disabled={busy}>
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
          <input ref={documentsInput} hidden type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain" onChange={selectFile('document')} />
        </div>
        {filesQuery.isError ? <div className="document-list"><QueryError onRetry={() => filesQuery.refetch()} /></div> : filesQuery.isLoading ? <div className="document-list"><SkeletonRows count={2} /></div> : <div className="document-list">
          {documents.length ? documents.map((file) => <div className="document-row" key={file.id}>
            <span className="document-icon"><FilePlus2 size={16} /></span>
            <div className="document-copy"><strong>{file.originalName}</strong>{fileDetails(file)}</div>
            <a className="btn btn-quiet file-download" href={`/api/orders/${orderId}/files/${file.id}/content`} aria-label={`Download ${file.originalName}`}><Download size={14} />Download</a>
          </div>) : <p className="support-note">No order documents uploaded. Files are stored privately on this order.</p>}
        </div>}
      </section>
      <section className="panel">
        <div className="panel-head">
          <div><p className="panel-kicker">Style reference</p><h2 className="panel-title">Garment pictures</h2></div>
          {uploadButton('Add picture', () => imagesInput.current?.click())}
          <input ref={imagesInput} hidden type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={selectFile('garment_image')} />
        </div>
        {filesQuery.isError ? <div className="document-list"><QueryError onRetry={() => filesQuery.refetch()} /></div> : filesQuery.isLoading ? <div className="document-list"><SkeletonRows count={2} /></div> : images.length ? <div className="garment-image-list">
          {images.map((file) => <article className="garment-image-card" key={file.id}>
            <a href={`/api/orders/${orderId}/files/${file.id}/preview`} target="_blank" rel="noreferrer" aria-label={`View ${file.originalName}`}>
              <img src={`/api/orders/${orderId}/files/${file.id}/preview`} alt={file.originalName} loading="lazy" />
            </a>
            <div className="document-copy"><strong>{file.originalName}</strong>{fileDetails(file)}</div>
            <a className="icon-btn" href={`/api/orders/${orderId}/files/${file.id}/content`} aria-label={`Download ${file.originalName}`}><Download size={15} /></a>
          </article>)}
        </div> : <div className="image-unavailable"><Shirt size={24} strokeWidth={1.5} /><strong>No garment pictures uploaded</strong><span>Upload a JPEG, PNG, or WebP image (up to 25 MB) for this order.</span></div>}
      </section>
    </div>
  </>;
}

