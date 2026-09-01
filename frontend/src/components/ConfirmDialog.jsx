import { useEffect, useRef, useState } from 'react';

/**
 * Accessible confirmation dialog. Optionally collects a required reason
 * (used for cancellation reasons / reopening a concluded action).
 */
export default function ConfirmDialog({
  open, title, description, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar',
  requireReason = false, reasonLabel = 'Motivo', danger = false, onConfirm, onCancel,
}) {
  const [reason, setReason] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setTimeout(() => ref.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const canConfirm = !requireReason || reason.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="presentation" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900">{title}</h2>
        {description && <p className="mt-2 text-sm text-gray-600">{description}</p>}
        {requireReason && (
          <div className="mt-4">
            <label htmlFor="confirm-reason" className="block text-sm font-medium text-gray-700 mb-1">{reasonLabel} *</label>
            <textarea
              id="confirm-reason"
              ref={ref}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50">
            {cancelLabel}
          </button>
          <button
            ref={!requireReason ? ref : undefined}
            disabled={!canConfirm}
            onClick={() => onConfirm(reason)}
            className={`px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
