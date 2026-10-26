#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { normalizeRoomRequest } from './schema.mjs';
import { materializeRoomSources } from './materialize.mjs';
import { buildResearchRoomPlan, runResearchRoom } from './orchestrator.mjs';
import { createOpenAiCompatibleInvoker } from './provider.mjs';
import { createAgentToolbox } from './tools.mjs';
import { applyEvent, createLiveStatus } from './live-status.mjs';

const DEFAULT_EXTERNAL_TEXT_BASE_URL = 'https://www.ainipy.com/api/desktop/v1';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const valueOf = name => {
  const at = args.indexOf(name);
  if (at < 0) return null;
  if (!args[at + 1]) throw new TypeError(`${name} requires a value`);
  return args[at + 1];
};
const integerOf = (name, fallback) => valueOf(name) == null ? fallback : Number.parseInt(valueOf(name), 10);
const safeTimestamp = () => new Date().toISOString().replace(/[-:TZ.]/gu, '').slice(0, 14);

function artifactPath(raw, label) {
  const outputPath = resolve(root, raw);
  const rel = relative(root, outputPath).replaceAll('\\', '/');
  if (rel.startsWith('../') || !(rel === 'artifacts' || rel.startsWith('artifacts/'))) throw new TypeError(`${label} must stay under artifacts/`);
  return outputPath;
}

if (args.includes('--help')) {
  console.log(`Usage:
  npm run agent:room -- --request <request.json> [--live] [--web]
  npm run agent:room -- --objective <task> --web --live [--agents 5] [--concurrency 3]
  npm run agent:room:ui

Controller options:
  --room-id <id>           safe run identity; generated when omitted
  --system <name>          default mixed
  --agents <n>             dynamic room maximum; default 5, max 16
  --concurrency <n>        simultaneous model agents; default 3, max 16
  --web                    enable public HTTPS web_search/web_fetch
  --files                  enable bounded run-workspace files; never implied by --web
  --agent-tools            enable in-process read-only agent-kit commands
  --ocr                    allow ocr/ocr-status/ocr-relayout under artifacts/ocr; implies --agent-tools
  --web-concurrency <n>    simultaneous network requests; default 4, max 8
  --max-tool-calls <n>     whole-room tool budget; default 48
  --model <name>           direct-mode requested model; default gpt-5.6-terra
  --base-url <url>         direct-mode provider; default AINIPY desktop endpoint
  --key-env <name>         credential environment variable; default AINIPY_API_KEY
  --out <artifacts/...>    full report; defaults to a room run directory
  --events <artifacts/...> JSONL progress/audit ledger
  --checkpoint <path>      resumable checkpoint under artifacts/
  --resume <path>          resume from a checkpoint under artifacts/

Without --live this prints a dry-run plan. Web pages are untrusted research-only
materials and never become formal YuraCore knowledge or runtime Effects. Every
website origin is serialized to one active request across the whole room.`);
  process.exit(0);
}

const requestPathValue = valueOf('--request');
const objective = valueOf('--objective');
if (Boolean(requestPathValue) === Boolean(objective)) throw new TypeError('choose exactly one of --request or --objective');

let raw;
if (requestPathValue) raw = JSON.parse(readFileSync(resolve(root, requestPathValue), 'utf8'));
else {
  const roomId = valueOf('--room-id') ?? `web-room-${safeTimestamp()}-${randomUUID().slice(0, 8)}`;
  raw = {
    protocol: 'yura.agent_room.v1',
    room_id: roomId,
    objective,
    system: valueOf('--system') ?? 'mixed',
    write_policy: 'research_only',
    sources: [],
    allocation: { mode: 'agent', max_agents: integerOf('--agents', 5), concurrency: integerOf('--concurrency', 3) },
    context: { mode: 'smart', target_chars: 12000, preserve_recent: 6 },
    capabilities: { web: args.includes('--web'), files: args.includes('--files'), agent_tools: args.includes('--agent-tools') },
    limits: {
      max_rounds: integerOf('--max-rounds', 8),
      max_agent_chars: integerOf('--max-agent-chars', 3000),
      max_material_chars: 20000,
      timeout_ms: integerOf('--timeout-ms', 180000),
      max_tool_rounds_per_agent: integerOf('--max-tool-rounds', 2),
      max_tool_calls_per_agent: integerOf('--max-agent-tool-calls', 8),
      max_total_tool_calls: integerOf('--max-tool-calls', 48),
      web_concurrency: integerOf('--web-concurrency', 4),
      web_result_chars: integerOf('--web-result-chars', 18000),
    },
    provider: {
      name: 'AINIPY external room',
      provider_id: 'ainipy-room',
      base_url: valueOf('--base-url') ?? process.env.AINIPY_API_URL ?? DEFAULT_EXTERNAL_TEXT_BASE_URL,
      model: valueOf('--model') ?? 'gpt-5.6-terra',
      key_env: valueOf('--key-env') ?? 'AINIPY_API_KEY',
      api_mode: 'responses',
      reasoning_effort: 'medium',
      max_output_tokens: 8000,
      max_retries: 0,
      concurrency: integerOf('--concurrency', 3),
    },
  };
}

if (args.includes('--web') || args.includes('--files') || args.includes('--agent-tools') || args.includes('--ocr')) {
  raw.capabilities = {
    ...(raw.capabilities ?? {}),
    web: args.includes('--web') || raw.capabilities?.web === true,
    files: args.includes('--files') || raw.capabilities?.files === true,
    agent_tools: args.includes('--agent-tools') || args.includes('--ocr') || raw.capabilities?.agent_tools === true,
    ocr: args.includes('--ocr') || raw.capabilities?.ocr === true,
  };
  raw.allocation = { ...(raw.allocation ?? {}), mode: 'agent' };
}
if (valueOf('--agents') != null || valueOf('--concurrency') != null) {
  raw.allocation = { ...(raw.allocation ?? {}), mode: 'agent', max_agents: integerOf('--agents', raw.allocation?.max_agents ?? 5), concurrency: integerOf('--concurrency', raw.allocation?.concurrency ?? 3) };
}
raw.limits = {
  ...(raw.limits ?? {}),
  ...(valueOf('--web-concurrency') == null ? {} : { web_concurrency: integerOf('--web-concurrency') }),
  ...(valueOf('--max-tool-calls') == null ? {} : { max_total_tool_calls: integerOf('--max-tool-calls') }),
};

const request = normalizeRoomRequest(raw);
const materials = materializeRoomSources(request, { cwd: root });
if (!args.includes('--live')) {
  console.log(JSON.stringify(buildResearchRoomPlan(request, materials), null, 2));
  process.exit(0);
}

const runRoot = artifactPath(`artifacts/agent-room-runs/${request.room_id}`, 'run directory');
const outputPath = artifactPath(valueOf('--out') ?? `artifacts/agent-room-runs/${request.room_id}/report.json`, '--out');
const eventsPath = artifactPath(valueOf('--events') ?? `artifacts/agent-room-runs/${request.room_id}/events.jsonl`, '--events');
const checkpointPath = artifactPath(valueOf('--checkpoint') ?? `artifacts/agent-room-runs/${request.room_id}/checkpoint.json`, '--checkpoint');
const resumePath = valueOf('--resume') == null ? null : artifactPath(valueOf('--resume'), '--resume');
mkdirSync(runRoot, { recursive: true });
mkdirSync(dirname(outputPath), { recursive: true });
mkdirSync(dirname(eventsPath), { recursive: true });
mkdirSync(dirname(checkpointPath), { recursive: true });
if (!resumePath || !existsSync(eventsPath)) writeFileSync(eventsPath, '', 'utf8');
const checkpoint = resumePath ? JSON.parse(readFileSync(resumePath, 'utf8')) : null;
const statusPath = resolve(runRoot, 'status.json');
const live = createLiveStatus({
  room_id: request.room_id,
  objective: request.objective,
  allocation: request.allocation,
  capabilities: request.capabilities,
  state: 'starting',
  updated_at: new Date().toISOString(),
});
const writeStatus = () => writeFileSync(statusPath, `${JSON.stringify(live, null, 2)}\n`, 'utf8');
writeStatus();
const onEvent = async event => {
  const stamped = { at: new Date().toISOString(), ...event };
  applyEvent(live, stamped);
  writeStatus();
  appendFileSync(eventsPath, `${JSON.stringify(stamped)}\n`, 'utf8');
};

const executeTool = createAgentToolbox({
  cwd: root,
  workspaceRoot: resolve(runRoot, 'workspace'),
  capabilities: request.capabilities,
  webConcurrency: request.limits.web_concurrency,
  webResultChars: request.limits.web_result_chars,
  maxTotalCalls: request.limits.max_total_tool_calls,
  onAudit: async audit => onEvent({ type: 'tool.audit', room_id: request.room_id, ...audit }),
});
const invokers = new Map();
const invokeAgent = ({ role, messages }) => {
  const config = { ...(request.provider ?? {}), ...(request.agents?.[role] ?? {}) };
  const key = JSON.stringify(config);
  if (!invokers.has(key)) invokers.set(key, createOpenAiCompatibleInvoker(config));
  return invokers.get(key)({ role, messages });
};
const report = await runResearchRoom({
  request,
  materials,
  invokeAgent,
  executeTool,
  checkpoint,
  onEvent,
  onCheckpoint: async value => writeFileSync(checkpointPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8'),
});
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  protocol: report.protocol,
  room_id: report.room_id,
  decision: report.decision,
  summary: report.summary,
  unresolved: report.unresolved,
  next_actions: report.next_actions,
  audit: report.audit,
  tools: report.tools,
  promotion: report.promotion,
  artifacts: {
    report: relative(root, outputPath).replaceAll('\\', '/'),
    events: relative(root, eventsPath).replaceAll('\\', '/'),
    status: relative(root, statusPath).replaceAll('\\', '/'),
    checkpoint: relative(root, checkpointPath).replaceAll('\\', '/'),
    workspace: relative(root, resolve(runRoot, 'workspace')).replaceAll('\\', '/'),
  },
}, null, 2));
