import { THEME_OPTIONS, setThemePreference, useThemePreference } from '../utils/theme';

export default function Settings() {
  const theme = useThemePreference();

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Configurações</h1>
      <p className="text-sm text-gray-500 mb-6">Preferências deste navegador.</p>

      <section className="bg-white border border-[var(--color-border)] rounded-xl p-5">
        <h2 className="text-base font-semibold text-gray-900">Aparência</h2>
        <p className="text-sm text-gray-500 mb-4">Escolha entre o modo claro e o modo escuro.</p>
        <div role="radiogroup" aria-label="Aparência" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {THEME_OPTIONS.map((opt) => {
            const selected = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setThemePreference(opt.value)}
                className={`text-left rounded-lg border p-3 transition-colors ${
                  selected ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50' : 'border-gray-300 hover:bg-gray-50'
                }`}
              >
                <ThemePreview kind={opt.value} />
                <span className="flex items-center gap-2 mt-3 font-medium text-gray-900">
                  <span aria-hidden="true">{opt.icon}</span>
                  {opt.label}
                  {selected && <span className="ml-auto text-blue-600 text-sm" aria-hidden="true">✓</span>}
                </span>
                <span className="block text-xs text-gray-500 mt-0.5">{opt.hint}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// Small mock of a screen in each mode, so the choice is easy to recognise.
function ThemePreview({ kind }) {
  const light = { bg: '#f4f6f8', bar: '#ffffff', line: '#d1d5db', accent: '#1d4ed8' };
  const dark = { bg: '#0b1120', bar: '#131c2b', line: '#3a4558', accent: '#60a5fa' };
  const half = (c, clip) => (
    <div className="absolute inset-0 p-2" style={{ background: c.bg, clipPath: clip }}>
      <div className="h-2.5 rounded-sm mb-2" style={{ background: c.bar }} />
      <div className="h-1.5 w-2/3 rounded-sm mb-1.5" style={{ background: c.accent }} />
      <div className="h-1.5 w-1/2 rounded-sm mb-1.5" style={{ background: c.line }} />
      <div className="h-1.5 w-3/4 rounded-sm" style={{ background: c.line }} />
    </div>
  );
  return (
    <div className="relative h-16 rounded-md overflow-hidden border border-gray-200" aria-hidden="true">
      {kind === 'escuro' ? half(dark) : half(light)}
      {kind === 'sistema' && half(dark, 'polygon(100% 0, 100% 100%, 0 100%)')}
    </div>
  );
}
