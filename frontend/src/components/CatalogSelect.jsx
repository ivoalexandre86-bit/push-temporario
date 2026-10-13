// Dropdowns fed by the editable lists (Listas page). Inactive entries are
// hidden, except the one already chosen so an older action still shows it.

export function ResponsibleSelect({ people, value, onChange, disabled, className = 'input', ...rest }) {
  const options = people.filter((p) => p.active || p.name === value);
  const known = !value || options.some((p) => p.name === value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={className} {...rest}>
      <option value="">Selecione...</option>
      {!known && <option value={value}>{value}</option>}
      {options.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
    </select>
  );
}

export function AreaSelect({ areas, value, onChange, placeholder = true, className = 'input', ...rest }) {
  const options = areas.filter((a) => a.active || String(a.id) === String(value));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className} {...rest}>
      {placeholder && <option value="">Selecione...</option>}
      {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}
