// Dropdowns fed by the editable lists (Listas page). Inactive entries are
// hidden, except the one already chosen so an older action still shows it.
// `allowedIds` narrows the options to a project's own list (null = all).

export function ResponsibleSelect({ people, value, onChange, disabled, allowedIds = null, className = 'input', ...rest }) {
  const options = people.filter((p) => (p.active && (!allowedIds || allowedIds.includes(p.id))) || p.name === value);
  const known = !value || options.some((p) => p.name === value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={className} {...rest}>
      <option value="">Selecione...</option>
      {!known && <option value={value}>{value}</option>}
      {options.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
    </select>
  );
}

export function AreaSelect({ areas, value, onChange, placeholder = true, allowedIds = null, className = 'input', ...rest }) {
  const options = areas.filter((a) => (a.active && (!allowedIds || allowedIds.includes(a.id))) || String(a.id) === String(value));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className} {...rest}>
      {placeholder && <option value="">Selecione...</option>}
      {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}
