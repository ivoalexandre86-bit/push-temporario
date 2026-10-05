// Integração com a API da Anthropic (Claude) para a Melhoria 5: reescrever
// e melhorar a descrição de uma ação, sempre apresentando o resultado como
// sugestão editável (nunca aplicada automaticamente) — ver o botão
// "Reescrever com IA" em ActionDetail.jsx.
//
// Configuração: defina ANTHROPIC_API_KEY no .env (nunca commitar a chave).
// Se a variável não estiver definida, as rotas que dependem desta IA
// respondem 503 com um erro claro, em vez de quebrar o servidor.
const { AppError } = require('../middleware/errorHandler');

let cachedClient;
let cachedKey;

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (cachedClient && cachedKey === apiKey) return cachedClient;
  // Import tardio: evita exigir a dependência/chave quando a funcionalidade
  // não está configurada (ex.: ambientes de teste automatizado).
  const Anthropic = require('@anthropic-ai/sdk');
  cachedClient = new Anthropic({ apiKey });
  cachedKey = apiKey;
  return cachedClient;
}

const SYSTEM_PROMPT = `Você reescreve e melhora descrições de ações/tarefas de um sistema de gestão de projetos, em português do Brasil.

Regras obrigatórias:
- Preserve TODAS as informações do texto original (datas, nomes, números, responsáveis, links, etc.) — nunca invente nem remova conteúdo.
- Melhore apenas clareza, gramática, pontuação e organização do texto.
- Se o texto original usar listas (com "-", "*", números ou itens em linhas separadas), preserve essa formatação em lista.
- Mantenha um tom profissional e objetivo, sem adicionar opiniões.
- Responda APENAS com o texto reescrito — sem comentários, sem aspas ao redor, sem explicações.`;

async function rewriteDescription(text) {
  const client = getClient();
  if (!client) {
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'A reescrita por IA ainda não foi configurada neste ambiente (defina ANTHROPIC_API_KEY).'
    );
  }

  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

  let message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Reescreva o texto abaixo:\n\n${text}` }],
    });
  } catch (err) {
    throw new AppError(502, 'AI_REQUEST_FAILED', 'Não foi possível obter uma sugestão da IA agora. Tente novamente em instantes.');
  }

  const block = Array.isArray(message?.content) ? message.content.find((c) => c.type === 'text') : null;
  const suggestion = block?.text ? block.text.trim() : '';
  if (!suggestion) {
    throw new AppError(502, 'AI_EMPTY_RESPONSE', 'A IA não retornou nenhum texto.');
  }
  return suggestion;
}

module.exports = { rewriteDescription };
