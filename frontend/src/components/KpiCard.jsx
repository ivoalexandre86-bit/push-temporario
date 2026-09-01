export default function KpiCard({ label, value, sublabel, tone = 'default', onClick, active }) {
  const toneClasses = {
    default: 'text-gray-900',
    blue: 'text-blue-700',
    green: 'text-green-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
  };
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={`text-left bg-white border rounded-xl p-4 flex flex-col gap-1 transition-shadow ${
        onClick ? 'hover:shadow-md cursor-pointer' : ''
      } ${active ? 'border-blue-400 ring-1 ring-blue-200' : 'border-[var(--color-border)]'}`}
    >
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <span className={`text-2xl font-bold ${toneClasses[tone]}`}>{value}</span>
      {sublabel && <span className="text-xs text-gray-400">{sublabel}</span>}
    </Comp>
  );
}
