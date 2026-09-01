export default function Forbidden() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-4 gap-3">
      <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center text-red-500 text-2xl" aria-hidden="true">🔒</div>
      <h1 className="text-xl font-bold text-gray-900">Acesso não autorizado</h1>
      <p className="text-gray-500 max-w-sm">Você não tem permissão para visualizar esta página. Contate um administrador se acredita que isso é um erro.</p>
    </div>
  );
}
