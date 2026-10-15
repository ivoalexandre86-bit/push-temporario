import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, BASE_URL } from '../api/client';

/** URL that opens an attachment in a new tab (inline) or downloads it. */
export function attachmentUrl(actionId, attachmentId, { inline = false } = {}) {
  return `${BASE_URL}/actions/${actionId}/attachments/${attachmentId}/download${inline ? '?inline=1' : ''}`;
}

/**
 * Paperclip button in an Ações grid row (shown only when the action has
 * attachments). Opens a small menu listing the files, each with "Abrir"
 * (new tab) and "Baixar".
 */
export default function AttachmentsMenu({ actionId, count, className = 'dg-chevron dg-attach', withLabel = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const ref = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  useEffect(() => {
    if (!open || items) return;
    api.get(`/actions/${actionId}/attachments`)
      .then((d) => setItems(d.items))
      .catch((e) => setError(e.message));
  }, [open, items, actionId]);

  if (!count) return null;

  return (
    <div ref={ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => {
          // The menu goes to <body>, positioned against the viewport: inside the
          // grid it would be clipped by the scroll area and covered by the
          // pinned last column of the rows below.
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
          setOpen((o) => !o);
        }}
        aria-haspopup="true"
        aria-expanded={open}
        title={`${count} anexo${count > 1 ? 's' : ''}: abrir`}
        aria-label={`Abrir anexos da ação #${actionId} (${count})`}
        className={className}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        <span className="text-xs">{withLabel ? `${count} anexo${count > 1 ? 's' : ''}` : count}</span>
      </button>
      {open && createPortal(
        <div ref={menuRef} onClick={(e) => e.stopPropagation()} className="dg-menu text-left" role="menu" style={pos ? { position: 'fixed', top: pos.top, right: pos.right, minWidth: '16rem', maxWidth: '24rem', maxHeight: `calc(100vh - ${pos.top + 16}px)`, overflowY: 'auto' } : undefined}>
          <p className="px-2 pb-1 text-xs" style={{ color: '#8b95a7' }}>Anexos</p>
          {error && <p className="px-2 text-xs" style={{ color: '#f87171' }}>{error}</p>}
          {!items && !error && <p className="px-2 text-xs" style={{ color: '#8b95a7' }}>Carregando...</p>}
          {items?.map((att) => (
            <div key={att.id} className="flex items-center gap-2 px-2 py-1">
              <span className="truncate flex-1" title={att.original_name}>{att.original_name}</span>
              <a href={attachmentUrl(actionId, att.id, { inline: true })} target="_blank" rel="noopener noreferrer" className="text-xs font-medium" style={{ color: '#93c5fd' }}>Abrir</a>
              <a href={attachmentUrl(actionId, att.id)} className="text-xs" style={{ color: '#8b95a7' }}>Baixar</a>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
