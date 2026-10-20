import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Loading, ErrorState, EmptyState } from '../Loading';
import { formatDateTime } from '../../utils/format';

/** Histórico das importações de Excel dos cadastros de logística. */
export default function ImportHistory({ reloadKey, targets }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    setError('');
    api.get('/logistics/import/history').then((d) => setItems(d.items)).catch((e) => setError(e.message));
  }, [reloadKey]);

  if (error) return <ErrorState message={error} />;
  if (!items) return <Loading />;
  const list = targets ? items.filter((i) => targets.includes(i.target)) : items;
  if (!list.length) return <EmptyState title="Nenhuma importação ainda" description="As importações de planilha aparecem aqui, com o resultado de cada uma." />;

  return (
    <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-600">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">Data</th>
            <th className="text-left px-3 py-2 font-semibold">Cadastro</th>
            <th className="text-left px-3 py-2 font-semibold">Arquivo / aba</th>
            <th className="text-left px-3 py-2 font-semibold">Por</th>
            <th className="text-right px-3 py-2 font-semibold">Linhas</th>
            <th className="text-right px-3 py-2 font-semibold">Inseridos</th>
            <th className="text-right px-3 py-2 font-semibold">Atualizados</th>
            <th className="text-right px-3 py-2 font-semibold">Ignorados</th>
            <th className="text-right px-3 py-2 font-semibold">Rejeitados</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {list.map((b) => (
            <HistoryRow key={b.id} b={b} expanded={open === b.id} onToggle={() => setOpen(open === b.id ? null : b.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryRow({ b, expanded, onToggle }) {
  const rejected = b.summary?.rejected || [];
  const warnings = b.summary?.warnings || [];
  const hasDetails = rejected.length || warnings.length || b.summary?.regionsCreated?.length;
  return (
    <>
      <tr>
        <td className="px-3 py-2 whitespace-nowrap text-gray-700">{formatDateTime(b.finishedAt || b.startedAt)}</td>
        <td className="px-3 py-2 text-gray-900">{b.targetLabel}<span className="block text-xs text-gray-500">{b.mode === 'UPSERT' ? 'inserir e atualizar' : 'só inserir novos'}</span></td>
        <td className="px-3 py-2 text-gray-700">{b.sourceFile}<span className="block text-xs text-gray-500">aba “{b.sheetName}”</span></td>
        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{b.importedBy}</td>
        <td className="px-3 py-2 text-right tabular-nums">{b.totalRows}</td>
        <td className="px-3 py-2 text-right tabular-nums text-green-700 font-semibold">{b.insertedRows}</td>
        <td className="px-3 py-2 text-right tabular-nums text-blue-700 font-semibold">{b.updatedRows}</td>
        <td className="px-3 py-2 text-right tabular-nums">{b.skippedRows + b.unchangedRows}</td>
        <td className={`px-3 py-2 text-right tabular-nums ${b.rejectedRows ? 'text-red-700 font-semibold' : ''}`}>{b.rejectedRows}</td>
        <td className="px-3 py-2 text-right">
          {hasDetails ? <button type="button" onClick={onToggle} className="text-blue-700 text-xs font-medium hover:underline whitespace-nowrap">{expanded ? 'Ocultar' : 'Detalhes'}</button> : null}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="px-3 py-3 bg-gray-50 text-xs space-y-2">
            {b.summary?.regionsCreated?.length > 0 && <p>Regionais cadastradas: {b.summary.regionsCreated.join(', ')}</p>}
            {rejected.length > 0 && (
              <div>
                <p className="font-semibold text-red-700">Linhas rejeitadas</p>
                <ul className="list-disc pl-5">{rejected.map((r) => <li key={r.rowNumber}>Linha {r.rowNumber}: {r.errors.join(' ')}</li>)}</ul>
              </div>
            )}
            {warnings.length > 0 && (
              <div>
                <p className="font-semibold text-amber-700">Avisos ({warnings.length} linha(s))</p>
                <ul className="list-disc pl-5 max-h-60 overflow-y-auto scrollbar-thin">{warnings.map((w) => <li key={w.rowNumber}>Linha {w.rowNumber}: {w.warnings.join(' ')}</li>)}</ul>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
