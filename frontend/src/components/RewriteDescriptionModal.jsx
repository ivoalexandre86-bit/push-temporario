import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Melhoria 5: botão "Revisão" na descrição da ação. Chama o
// backend (Anthropic/Claude), mostra a sugestão em um campo editável e só
// aplica no formulário da ação quando o usuário clicar em "Usar este texto"
// — nunca substitui automaticamente, conforme pedido.
export default function RewriteDescriptionModal({ open, onClose, actionId, originalText, onApply }) {
  const [suggestion, setSuggestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSuggestion('');
    setError('');
    setRequested(false);
  }, [open]);

  if (!open) return null;

  const requestSuggestion = async () => {
    setLoading(true);
    setError('');
    setRequested(true);
    try {
      const { suggestion: text } = await api.post(`/actions/${actionId}/rewrite-description`, { text: originalText });
      setSuggestion(text);
    } catch (err) {
      setError(err.message || 'Não foi possível gerar uma sugestão agora.');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    onApply(suggestion);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 my-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">✨ Revisão da descrição</h2>
        <p className="text-sm text-gray-500 mb-4">
          A IA sugere uma versão melhorada do texto abaixo. Você pode editar a sugestão à vontade antes de aplicá-la — nada é alterado automaticamente.
        </p>

        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Texto atual</p>
          <div className="input !h-auto whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 max-h-40 overflow-y-auto">
            {originalText || <span className="text-gray-400">(vazio)</span>}
          </div>
        </div>

        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-4">{error}</p>}

        {!requested && !loading && (
          <button onClick={requestSuggestion} className="px-4 py-2 rounded-md text-sm font-medium text-white bg-purple-600 hover:bg-purple-700">
            Gerar sugestão
          </button>
        )}

        {loading && <p className="text-sm text-gray-500">Gerando sugestão...</p>}

        {requested && !loading && suggestion && (
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">Sugestão da IA (edite se quiser)</p>
            <textarea
              rows={8}
              value={suggestion}
              onChange={(e) => setSuggestion(e.target.value)}
              className="input whitespace-pre-wrap"
              autoFocus
            />
          </div>
        )}

        {requested && !loading && error && (
          <button onClick={requestSuggestion} className="mt-2 px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50">
            Tentar novamente
          </button>
        )}

        <div className="flex justify-end gap-2 pt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          {requested && !loading && suggestion && (
            <button type="button" onClick={handleApply} className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700">
              Usar este texto
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
