import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4 gap-3">
      <h1 className="text-3xl font-bold text-gray-900">Página não encontrada</h1>
      <p className="text-gray-500">O endereço acessado não existe ou foi movido.</p>
      <Link to="/dashboard" className="mt-2 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
        Voltar ao painel
      </Link>
    </div>
  );
}
