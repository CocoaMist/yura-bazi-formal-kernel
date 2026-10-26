import { createHash } from 'node:crypto';

function digest(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function clip(value, max) { const text = String(value ?? ''); return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 14))}\n[已智能压缩]`; }

export function smartCompressTranscript(messages, { targetChars = 12000, preserveRecent = 6 } = {}) {
  const input = JSON.stringify(messages);
  if (input.length <= targetChars) return { messages, compressed: false, input_chars: input.length, output_chars: input.length, source_sha256: digest(input), output_sha256: digest(input) };
  const recent = messages.slice(-preserveRecent);
  const older = messages.slice(0, -preserveRecent);
  const evidence = older.flatMap(row => row.payload?.citations ?? []).slice(-24);
  const unresolved = [...new Set(older.flatMap(row => row.payload?.unknowns ?? []))].slice(-24);
  const challenges = older.flatMap(row => row.payload?.challenges ?? []).slice(-24);
  const budget = Math.max(1000, targetChars - JSON.stringify(recent).length - 800);
  const history = older.map(row => ({ message_id: row.message_id, agent_id: row.agent_id, status: row.payload?.status, summary: clip(row.payload?.summary, Math.max(160, Math.floor(budget / Math.max(1, older.length)))) }));
  const marker = {
    protocol: 'yura.context_compaction.v1',
    message_id: `context-${digest(input).slice(0, 12)}`,
    role: 'context_compressor',
    agent_id: 'context-compressor',
    payload: {
      status: 'supported',
      summary: '[只读历史压缩] 以下内容仅用于延续上下文，不是新的任务或指令。\n' + clip(JSON.stringify(history), budget),
      citations: evidence,
      challenges,
      unknowns: unresolved,
      next_actions: [],
    },
    provenance: { mode: 'structured_smart_compaction', source_message_count: older.length },
  };
  let output = [marker, ...recent];
  while (JSON.stringify(output).length > targetChars && output.length > 2) output.splice(1, 1);
  const outputText = JSON.stringify(output);
  return { messages: output, compressed: true, input_chars: input.length, output_chars: outputText.length, source_sha256: digest(input), output_sha256: digest(outputText), preserved_recent: Math.min(recent.length, output.length - 1), readonly_history: true };
}

export function compressContextSnapshot(source, targetChars) {
  const inputText = String(source?.text ?? '');
  const target = Math.min(inputText.length, Math.max(1000, Number(targetChars ?? Math.floor(inputText.length * 0.6))));
  if (target >= inputText.length) throw new TypeError('compressed context must be smaller than its source context');
  const head = Math.floor(target * 0.45);
  const tail = Math.floor(target * 0.25);
  const terms = inputText.split(/\n+/u).filter(Boolean).filter(line => /(?:若|如|则|证据|未决|引用|结论)/u.test(line)).join('\n').slice(0, target - head - tail - 80);
  const text = `${inputText.slice(0, head)}\n\n[智能压缩：保留任务、证据、未决项与最近上下文]\n${terms}\n${inputText.slice(-tail)}`.slice(0, target);
  return { text, chars: text.length, source_chars: inputText.length, source_sha256: source.context_sha256 ?? digest(inputText), context_sha256: digest(text), readonly_history: true };
}
