export function Loading({ label = 'Carregando...' }) {
  return (
    <div className="flex items-center justify-center gap-2 text-sm text-gray-500 py-10" role="status" aria-live="polite">
      <span className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function EmptyState({ title = 'Nenhum resultado encontrado', description, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-4">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3 text-gray-400 text-xl" aria-hidden="true">∅</div>
      <p className="font-semibold text-gray-700">{title}</p>
      {description && <p className="text-sm text-gray-500 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message = 'Ocorreu um erro ao carregar os dados.', onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-4">
      <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-3 text-red-500 text-xl" aria-hidden="true">!</div>
      <p className="font-semibold text-gray-700">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-4 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
          Tentar novamente
        </button>
      )}
    </div>
  );
}
