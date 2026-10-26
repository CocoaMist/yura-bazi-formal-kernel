const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function chatCompletion({
  baseUrl, apiKey, model, messages, maxRetries = 1, temperature = 0,
} = {}) {
  if (!baseUrl || !apiKey || !model) throw new Error('provider requires baseUrl, apiKey and model');
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(`${String(baseUrl).replace(/\/+$/u, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, temperature, messages, response_format: { type: 'json_object' } }),
      });
      const body = await response.text();
      if (!response.ok) {
        const error = new Error(`http ${response.status}: ${body}`);
        error.status = response.status;
        throw error;
      }
      const payload = JSON.parse(body);
      return {
        content: payload?.choices?.[0]?.message?.content ?? '',
        usage: payload?.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    } catch (error) {
      lastError = error;
      if (!RETRYABLE.has(error?.status) || attempt >= maxRetries) throw error;
      await delay(250 * (2 ** attempt));
    }
  }
  throw lastError;
}
