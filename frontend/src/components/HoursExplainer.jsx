import { formatHours } from '../utils/format';

/**
 * Collapsible explanation of how planned/actual hours, variation and
 * utilization are calculated (same rules as the action_hours view and
 * /api/dashboard). Optionally shows the basis details returned by the API.
 */
export default function HoursExplainer({ hours, defaultOpen = false }) {
  return (
    <details open={defaultOpen} className="bg-blue-50/60 border border-blue-100 rounded-xl px-4 py-3 mb-4 text-sm text-gray-700">
      <summary className="cursor-pointer font-medium text-blue-800">Como as horas são calculadas</summary>
      <ul className="mt-2 space-y-1.5 list-disc pl-5">
        <li>
          <strong>Horas planejadas (h)</strong>: soma dos lançamentos do tipo “planejado” da ação; se a ação não tiver
          nenhum, vale o campo “Horas planejadas” da própria ação.
        </li>
        <li>
          <strong>Horas reais (h)</strong>: soma dos lançamentos do tipo “real” <em>aprovados</em>. Lançamentos pendentes
          ou rejeitados não entram. Sem lançamentos reais, usa-se a hora legada importada da planilha somente depois de
          confirmada por um administrador.
        </li>
        <li>
          <strong>Variação (h)</strong> = horas reais − horas planejadas. Valor positivo (em vermelho) indica horas acima
          do planejado; negativo, abaixo.
        </li>
        <li>
          <strong>Utilização (%)</strong> = horas reais ÷ horas planejadas × 100. Fica em branco quando não há horas
          planejadas.
        </li>
        <li>
          Todos os totais e percentuais consideram <strong>o mesmo conjunto de ações</strong> — as que atendem aos filtros
          selecionados — e são agrupados pelo <strong>mês de referência</strong> da ação.
        </li>
      </ul>
      {hours && (hours.actionsWithoutPlannedHours > 0 || hours.pendingActualHours > 0) && (
        <ul className="mt-3 space-y-1 text-xs text-gray-600 border-t border-blue-100 pt-2">
          {hours.actionsWithoutPlannedHours > 0 && (
            <li>
              {hours.actionsWithoutPlannedHours} ação(ões) filtrada(s) não têm horas planejadas; elas somam{' '}
              {formatHours(hours.actualHoursWithoutPlan)} reais, que entram no total real e elevam a utilização.
            </li>
          )}
          {hours.pendingActualHours > 0 && (
            <li>{formatHours(hours.pendingActualHours)} de horas reais aguardam aprovação e ainda não entram nos totais.</li>
          )}
        </ul>
      )}
    </details>
  );
}
