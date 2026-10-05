import { STATUS_META } from '../utils/constants';

export default function StatusChip({ status, metaMap = STATUS_META }) {
  const meta = metaMap[status] || { label: status, bg: '#e5e7eb', fg: '#374151' };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
      style={{ background: meta.bg, color: meta.fg }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.fg }} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
