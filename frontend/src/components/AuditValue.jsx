import { auditFieldLabel, formatAuditScalar, parseAuditJson } from '../utils/auditLabels';

const LONG_TEXT = 60;

/**
 * Renders a stored audit value: JSON payloads become an expandable list of
 * labelled fields (nested objects/arrays included); long text can be
 * expanded; codes, booleans and dates are shown in pt-BR.
 */
export default function AuditValue({ value, field }) {
  const json = parseAuditJson(value);
  if (json) {
    const count = Array.isArray(json) ? json.length : Object.keys(json).length;
    return (
      <details className="text-xs">
        <summary className="cursor-pointer text-blue-700 hover:underline whitespace-nowrap">
          {Array.isArray(json) ? `Lista com ${count} item(ns)` : `${count} campo(s)`} — ver detalhes
        </summary>
        <div className="mt-1 max-w-md">
          <JsonTree data={json} parentField={field} />
        </div>
      </details>
    );
  }

  const text = formatAuditScalar(value, field);
  if (text.length <= LONG_TEXT) return <span>{text}</span>;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer">{text.slice(0, LONG_TEXT)}… <span className="text-blue-700 hover:underline">ver tudo</span></summary>
      <p className="mt-1 whitespace-pre-wrap max-w-md">{text}</p>
    </details>
  );
}

function JsonTree({ data, parentField }) {
  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-gray-400">(vazio)</span>;
    if (data.every((v) => v === null || typeof v !== 'object')) {
      return <span>{data.map((v) => formatAuditScalar(v, parentField)).join(', ')}</span>;
    }
    return (
      <ol className="list-decimal pl-4 space-y-1">
        {data.map((item, i) => <li key={i}><JsonTree data={item} parentField={parentField} /></li>)}
      </ol>
    );
  }
  if (data && typeof data === 'object') {
    const entries = Object.entries(data);
    if (entries.length === 0) return <span className="text-gray-400">(vazio)</span>;
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gray-500 whitespace-nowrap">{auditFieldLabel(k)}:</dt>
            <dd className="text-gray-800 break-words">
              {v !== null && typeof v === 'object' ? <JsonTree data={v} parentField={k} /> : formatAuditScalar(v, k)}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span>{formatAuditScalar(data, parentField)}</span>;
}
