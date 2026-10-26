import { chatCompletion } from './support/completion.mjs';

const SECRET_PATTERNS = Object.freeze([
  [/Authorization:\s*Bearer\s+[^\s'"\\]+/giu, 'Authorization: Bearer [REDACTED]'],
  [/\bBearer\s+[^\s'"\\]+/giu, 'Bearer [REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/gu, '[REDACTED_API_KEY]'],
]);
const MODEL_CAPACITY_PATTERN = /selected model is at capacity|try a different model|model[_ -]?(?:at[_ -]?)?capacity|model.{0,40}(?:at capacity|overloaded)/iu;
const DEFAULT_CAPACITY_FALLBACKS = Object.freeze({
  'gpt-5.6-luna': Object.freeze(['gpt-5.6-terra', 'gpt-5.6-sol']),
  'gpt-5.6-terra': Object.freeze(['gpt-5.6-luna', 'gpt-5.6-sol']),
  'gpt-5.6-sol': Object.freeze(['gpt-5.6-terra', 'gpt-5.6-luna']),
});

export function redactProviderError(error) {
  let message = String(error?.message ?? error ?? 'provider request failed');
  for (const [pattern, replacement] of SECRET_PATTERNS) message = message.replace(pattern, replacement);
  return message;
}

function modelCapacityError(error) {
  return MODEL_CAPACITY_PATTERN.test(String(error?.message ?? error ?? ''));
}

function responsesText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  return (payload?.output ?? []).flatMap(item => item?.content ?? [])
    .filter(item => item?.type === 'output_text' && typeof item.text === 'string')
    .map(item => item.text.trim()).filter(Boolean).join('\n\n');
}

async function responsesCompletion({ baseUrl, apiKey, model, messages, provider, fetchImpl }) {
  const endpoint = `${String(baseUrl).replace(/\/+$/u, '')}/responses`;
  const system = messages.filter(row => row.role === 'system').map(row => String(row.content ?? '')).join('\n\n');
  const input = messages.filter(row => row.role !== 'system').map(row => ({ role: row.role === 'assistant' ? 'assistant' : 'user', content: String(row.content ?? '') }));
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      instructions: `${system}\nReturn exactly one valid JSON object with no markdown fence.`,
      input,
      reasoning: { effort: provider.reasoning_effort ?? 'medium' },
      max_output_tokens: provider.max_output_tokens ?? 8000,
      store: false,
    }),
    signal: AbortSignal.timeout(Math.min(Math.max(provider.timeout_ms ?? 180000, 10000), 900000)),
  });
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > 8_000_000) throw new Error('provider response exceeds 8 MB');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 8_000_000) throw new Error('provider response exceeds 8 MB');
  const raw = new TextDecoder().decode(bytes);
  if (!response.ok) {
    const error = new Error(`http ${response.status}: ${raw.slice(0, 800)}`);
    error.status = response.status;
    throw error;
  }
  const payload = JSON.parse(raw);
  const content = responsesText(payload);
  if (!content) throw new Error('provider returned no response text');
  return { content, usage: payload.usage ?? {} };
}

/** Build an explicitly live OpenAI-compatible adapter. Inline keys are ephemeral runtime values. */
export function createOpenAiCompatibleInvoker(provider = {}, { completionImpl = null, fetchImpl = globalThis.fetch } = {}) {
  if (!provider.base_url || !provider.model) {
    throw new TypeError('live agent-room provider requires base_url and model');
  }
  const keyEnvs = [provider.key_env, ...(provider.key_env_candidates ?? [])].filter(Boolean);
  const keyEnv = keyEnvs.find(name => process.env[name]);
  const apiKey = provider.api_key || (keyEnv ? process.env[keyEnv] : null);
  if (!apiKey) throw new TypeError(keyEnvs.length ? `missing provider credential env: ${keyEnvs.join(' or ')}` : 'missing provider credential');
  const configuredFallbacks = provider.capacity_fallback === false
    ? []
    : provider.capacity_fallback_models ?? DEFAULT_CAPACITY_FALLBACKS[provider.model] ?? [];
  const models = [...new Set([provider.model, ...configuredFallbacks.map(String)])].slice(0, 3);
  const selectedCompletion = completionImpl ?? (provider.api_mode === 'responses'
    ? options => responsesCompletion({ ...options, provider, fetchImpl })
    : chatCompletion);
  return async ({ role, messages }) => {
    const capacityFallbacks = [];
    let result;
    let actualModel = provider.model;
    for (let index = 0; index < models.length; index += 1) {
      actualModel = models[index];
      try {
        result = await selectedCompletion({
          baseUrl: provider.base_url,
          apiKey,
          model: actualModel,
          messages,
          maxRetries: provider.max_retries ?? 1,
          concurrency: provider.concurrency ?? 2,
          chapterId: `agent-room:${role}`,
        });
        break;
      } catch (error) {
        const hasNext = index + 1 < models.length;
        if (modelCapacityError(error) && hasNext) {
          capacityFallbacks.push(Object.freeze({ model: actualModel, error: 'model_at_capacity' }));
          continue;
        }
        const safe = new Error(redactProviderError(error));
        if (error?.status != null) safe.status = error.status;
        if (modelCapacityError(error)) safe.code = 'MODEL_CAPACITY_EXHAUSTED';
        throw safe;
      }
    }
    if (!result) throw new Error('provider returned no result');
    return {
      content: result.content,
      usage: result.usage,
      provider: provider.name ?? 'openai-compatible',
      provider_id: provider.provider_id ?? null,
      model: actualModel,
      requested_model: provider.model,
      capacity_fallbacks: Object.freeze(capacityFallbacks),
    };
  };
}
