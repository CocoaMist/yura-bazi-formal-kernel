import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeRoomRequest } from './schema.mjs';
import { materializeRoomSources } from './materialize.mjs';
import { runResearchRoom } from './orchestrator.mjs';
import { createAgentToolbox } from './tools.mjs';
import { createOpenAiCompatibleInvoker, redactProviderError } from './provider.mjs';
import { createLiveStatus, snapshotFromEvents } from './live-status.mjs';
import { startRoomUi } from './ui-server.mjs';

function request(path, quote) {
  return normalizeRoomRequest({ protocol: 'yura.agent_room.v1', room_id: 'room-test', objective: '核验一条文献解释', system: 'bazi', write_policy: 'research_only', sources: [{ source_id: 's1', path, quote }], limits: { max_rounds: 1, max_agent_chars: 2000, max_material_chars: 4000 } });
}

test('provider errors redact bearer credentials before entering Agent Room records', () => {
  const secret = 'sk-fake-test-only';
  const redacted = redactProviderError(new Error(`Command failed: curl -H Authorization: Bearer ${secret}`));
  assert.doesNotMatch(redacted, new RegExp(secret));
  assert.match(redacted, /Authorization: Bearer \[REDACTED\]/u);
});

test('adapter failures are redacted and force the room audit to fail closed', async () => {
  const secret = 'sk-fake-test-only';
  const req = request('data/sources/wikisource-mingli/source.txt', '原文证据');
  const materials = [{ source_id: 's1', path: 'data/sources/wikisource-mingli/source.txt', locator: 'line:1', source_sha256: 'hash', focus_text: '原文证据', context_text: '原文证据' }];
  const report = await runResearchRoom({ request: req, materials, invokeAgent: async () => { throw new Error(`curl -H Authorization: Bearer ${secret}`); } });
  assert.equal(report.decision, 'blocked');
  assert.equal(report.audit.ok, false);
  assert.deepEqual(report.audit.execution_blockers, ['adapter_failure']);
  assert.match(report.audit.violations.join('\n'), /no_verified_citations/u);
  assert.doesNotMatch(report.summary, new RegExp(secret));
});

test('agent room is bounded, source-verified, and never admission eligible', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-room-'));
  try {
    mkdirSync(join(root, 'data/sources/wikisource-mingli'), { recursive: true });
    const quote = '甲木生春，得令而旺。';
    writeFileSync(join(root, 'data/sources/wikisource-mingli', 'source.txt'), `卷首\n${quote}\n卷终`, 'utf8');
    const req = request('data/sources/wikisource-mingli/source.txt', quote);
    const materials = materializeRoomSources(req, { cwd: root });
    const invokeAgent = async ({ role }) => ({
      content: { status: role === 'critic' ? 'mixed' : 'supported', summary: `${role} summary`, citations: [{ source_id: 's1', quote, locator: 'line' }], candidate_drafts: [], challenges: role === 'critic' ? [{ target_message_id: 'm-analyst_a-01-p1', type: 'missing_condition', summary: 'month condition needs review' }] : [], unknowns: [], next_actions: [] },
      provider: 'mock', model: 'mock-v1', usage: { total_tokens: 1 },
    });
    const events = [];
    const report = await runResearchRoom({ request: req, materials, invokeAgent, onEvent: async event => events.push(event) });
    assert.equal(report.transcript.length, 5);
    assert.equal(report.audit.ok, true);
    assert.equal(report.audit.verified_citation_count, 5);
    assert.equal(report.audit.runtime_or_bridge_impact, false);
    assert.equal(report.promotion.eligible, false);
    assert.equal(events[0].type, 'room.started');
    assert.equal(events.at(-1).type, 'room.completed');
    assert.equal(events.filter(event => event.type === 'agent.started').length, 5);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('agent room rejects source traversal and non-verbatim quotes', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-room-deny-'));
  try {
    mkdirSync(join(root, 'data/sources/wikisource-mingli'), { recursive: true });
    writeFileSync(join(root, 'outside.txt'), 'secret', 'utf8');
    assert.throws(() => materializeRoomSources(request('../outside.txt', 'secret'), { cwd: root }), /outside read-only corpus roots|escapes workspace/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('agent room accepts only the three copied library book corpus roots', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-room-library-'));
  try {
    const allowed = join(root, 'library/book/purchased-20260831');
    const denied = join(root, 'library/private');
    mkdirSync(allowed, { recursive: true });
    mkdirSync(denied, { recursive: true });
    writeFileSync(join(allowed, 'source.txt'), '大运与小运原文', 'utf8');
    writeFileSync(join(denied, 'secret.txt'), 'private', 'utf8');
    const accepted = materializeRoomSources(request(
      'library/book/purchased-20260831/source.txt',
      '大运与小运原文',
    ), { cwd: root });
    assert.equal(accepted[0].focus_text, '大运与小运原文');
    assert.throws(() => materializeRoomSources(request(
      'library/private/secret.txt',
      'private',
    ), { cwd: root }), /outside read-only corpus roots|outside allowed roots/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('agent room may read bounded generated deceased-person research JSON but not sibling test data', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-room-generated-research-'));
  try {
    const allowed = join(root, 'research-tests/deceased-persons/analysis/generated');
    const denied = join(root, 'research-tests/deceased-persons/cases');
    mkdirSync(allowed, { recursive: true });
    mkdirSync(denied, { recursive: true });
    writeFileSync(join(allowed, 'packet.json'), '{"researchOnly":true}', 'utf8');
    writeFileSync(join(denied, 'case.json'), '{"private":true}', 'utf8');
    const accepted = materializeRoomSources(request(
      'research-tests/deceased-persons/analysis/generated/packet.json',
      '"researchOnly":true',
    ), { cwd: root });
    assert.equal(accepted[0].focus_text, '"researchOnly":true');
    assert.throws(() => materializeRoomSources(request(
      'research-tests/deceased-persons/cases/case.json',
      '"private":true',
    ), { cwd: root }), /outside read-only corpus roots|outside allowed roots/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('agent room repairs one malformed model response before recording it', async () => {
  const req = request('data/sources/wikisource-mingli/source.txt', '原文证据');
  const materials = [{ source_id: 's1', path: 'data/sources/wikisource-mingli/source.txt', locator: 'line:1', source_sha256: 'hash', focus_text: '原文证据', context_text: '原文证据' }];
  let malformed = true;
  const events = [];
  const invokeAgent = async ({ role }) => {
    if (role === 'analyst_a' && malformed) { malformed = false; return { content: { answer: '缺少统一字段' }, provider: 'mock', model: 'loose-model' }; }
    return { content: { status: 'supported', summary: `${role} summary`, citations: [{ source_id: 's1', quote: '原文证据', locator: 'line:1' }], challenges: [], unknowns: [], next_actions: [] }, provider: 'mock', model: 'loose-model' };
  };
  const report = await runResearchRoom({ request: req, materials, invokeAgent, onEvent: async event => events.push(event) });
  assert.equal(report.transcript[0].payload.status, 'supported');
  assert.equal(events.filter(event => event.type === 'agent.schema_repaired').length, 1);
});

test('agent room reports a schema repair that remains invalid and still fails closed', async () => {
  const req = request('data/sources/wikisource-mingli/source.txt', '原文证据');
  const materials = [{ source_id: 's1', path: 'data/sources/wikisource-mingli/source.txt', locator: 'line:1', source_sha256: 'hash', focus_text: '原文证据', context_text: '原文证据' }];
  const events = [];
  const invokeAgent = async () => ({ content: { answer: '仍缺少统一字段' }, provider: 'mock', model: 'loose-model' });
  const report = await runResearchRoom({ request: req, materials, invokeAgent, onEvent: async event => events.push(event) });
  assert.equal(report.decision, 'blocked');
  assert.ok(report.audit.execution_blockers.includes('invalid_schema'));
  assert.ok(events.some(event => event.type === 'agent.schema_repair_failed' && event.reason === 'invalid_after_repair'));
});

test('dynamic room allocates agents, shares messages, checkpoints, tools, and AI-reviewed memory', async () => {
  const req = normalizeRoomRequest({ protocol: 'yura.agent_room.v1', room_id: 'room-dynamic', objective: '动态协作', system: 'mixed', write_policy: 'research_only', sources: [{ source_id: 's1', path: 'book-lab/source', quote: '原文证据' }], limits: { max_rounds: 8, max_agent_chars: 3000, max_material_chars: 4000 }, allocation: { mode: 'agent', max_agents: 4, concurrency: 2 }, context: { mode: 'smart', target_chars: 1000, preserve_recent: 1 }, capabilities: { web: true, files: true } });
  const materials = [{ source_id: 's1', path: 'book-lab/source', locator: 'chars:0-4', source_sha256: 'hash', focus_text: '原文证据', context_text: '原文证据' }];
  const seen = [];
  const invokeAgent = async ({ role, messages }) => {
    seen.push({ role, messages });
    if (role === 'coordinator') return { content: { plan: [{ agent_id: 'researcher', specialty: '检索', task: '查证', tools: ['web_search'] }, { agent_id: 'writer', specialty: '汇总', task: '同步总结', depends_on: ['researcher'], tools: ['write_file'] }] } };
    if (role === 'memory_reviewer') return { content: { status: 'supported', summary: '审核完成', citations: [], challenges: [], unknowns: [], next_actions: [], memories: [{ title: '记忆', content: '可复用证据', tags: ['证据'], decision: 'accepted', reason: '有来源' }] } };
    if (role === 'researcher' && !JSON.parse(messages[1].content).tool_results.length) return { content: { status: 'unresolved', summary: '需要搜索', citations: [], challenges: [], unknowns: [], next_actions: [], tool_requests: [{ name: 'web_search', arguments: { query: '原文' } }] } };
    return { content: { status: 'supported', summary: `${role} 已同步共享信息`.repeat(30), citations: [{ source_id: 's1', quote: '原文证据', locator: 'chars:0-4' }], challenges: [], unknowns: [], next_actions: [] }, provider: 'mock', model: 'mock' };
  };
  const checkpoints = [];
  const report = await runResearchRoom({ request: req, materials, invokeAgent, executeTool: async () => ({ ok: true, query: '原文', text: '公开结果' }), onCheckpoint: async value => checkpoints.push(value) });
  assert.equal(report.transcript.length, 2);
  assert.equal(report.memory_reviews[0].decision, 'accepted');
  assert.ok(checkpoints.length >= 2);
  assert.ok(seen.find(row => row.role === 'writer').messages[1].content.includes('researcher'));
  assert.equal(checkpoints[0].protocol, 'yura.agent_room_checkpoint.v1');
  assert.equal(checkpoints[0].room_id, 'room-dynamic');
});

test('dynamic room refuses a checkpoint from another controller objective', async () => {
  const req = normalizeRoomRequest({ protocol: 'yura.agent_room.v1', room_id: 'room-current', objective: '当前目标', system: 'mixed', write_policy: 'research_only', sources: [], allocation: { mode: 'agent', max_agents: 2 }, capabilities: { web: true } });
  await assert.rejects(() => runResearchRoom({ request: req, materials: [], invokeAgent: async () => ({}), checkpoint: { room_id: 'room-other', plan: [] } }), /checkpoint room_id/u);
});

test('dynamic room strips planner and delegated tools when capabilities are disabled', async () => {
  const req = normalizeRoomRequest({ protocol: 'yura.agent_room.v1', room_id: 'room-no-tools', objective: '只读注入材料', system: 'mixed', write_policy: 'research_only', sources: [{ source_id: 's1', path: 'data/sources/wikisource-mingli/source.txt', quote: '原文证据' }], limits: { max_rounds: 2, max_agent_chars: 3000, max_material_chars: 4000 }, allocation: { mode: 'agent', max_agents: 3, concurrency: 2 }, capabilities: { web: false, files: false } });
  const materials = [{ source_id: 's1', path: 'data/sources/wikisource-mingli/source.txt', locator: 'line:1', source_sha256: 'hash', focus_text: '原文证据', context_text: '原文证据' }];
  const invokeAgent = async ({ role }) => {
    if (role === 'coordinator') return { content: { plan: [{ agent_id: 'reader', task: '读材料', tools: ['read_file', 'web_search'] }, { agent_id: 'writer', task: '写结果', depends_on: ['reader'], tools: ['write_file'] }] } };
    if (role === 'memory_reviewer') return { content: { memories: [] } };
    return { content: { status: 'supported', summary: '只使用注入材料', citations: [{ source_id: 's1', quote: '原文证据', locator: 'line:1' }], candidate_drafts: [], challenges: [], unknowns: [], next_actions: [], delegations: [] }, provider: 'mock', model: 'mock' };
  };
  const report = await runResearchRoom({ request: req, materials, invokeAgent });
  assert.deepEqual(report.allocation.plan.map(row => row.tools), [[], []]);
  assert.equal(report.audit.ok, true);
});

test('agent toolbox resolves slash-prefixed research roots but still blocks outside paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-tools-'));
  try {
    mkdirSync(join(root, 'data/sources/wikisource-mingli'), { recursive: true });
    writeFileSync(join(root, 'data/sources/wikisource-mingli', 'source.txt'), '原文证据', 'utf8');
    writeFileSync(join(root, 'outside.txt'), 'secret', 'utf8');
    const toolbox = createAgentToolbox({ cwd: root, workspaceRoot: join(root, 'artifacts', 'workspace'), capabilities: { web: false, files: true } });
    const accepted = await toolbox({ name: 'read_file', arguments: { path: '/data/sources/wikisource-mingli/source.txt' } }, 'reader');
    assert.equal(accepted.ok, true);
    assert.equal(accepted.text, '原文证据');
    const blocked = await toolbox({ name: 'read_file', arguments: { path: '../outside.txt' } }, 'reader');
    assert.equal(blocked.ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('agent toolbox reads copied library books but cannot write beside them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-tools-library-'));
  try {
    const libraryRoot = join(root, 'library/book/wikisource-mingli');
    mkdirSync(libraryRoot, { recursive: true });
    writeFileSync(join(libraryRoot, 'source.txt'), '岁运原文', 'utf8');
    const toolbox = createAgentToolbox({
      cwd: root,
      workspaceRoot: join(root, 'artifacts', 'workspace'),
      capabilities: { web: false, files: true },
    });
    const accepted = await toolbox({
      name: 'read_file',
      arguments: { path: '/library/book/wikisource-mingli/source.txt' },
    }, 'reader');
    assert.equal(accepted.ok, true);
    assert.equal(accepted.text, '岁运原文');
    const blocked = await toolbox({
      name: 'write_file',
      arguments: { path: '../../../library/book/wikisource-mingli/rewrite.txt', content: 'no' },
    }, 'writer');
    assert.equal(blocked.ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('agent room canonicalizes candidate drafts and objective challenges', async () => {
  const req = request('data/sources/wikisource-mingli/source.txt', '原文证据');
  const materials = [{ source_id: 's1', path: 'data/sources/wikisource-mingli/source.txt', locator: 'line:1', source_sha256: 'hash', focus_text: '原文证据', context_text: '原文证据' }];
  const invokeAgent = async ({ role }) => ({
    content: { status: 'mixed', summary: `${role} summary`, citations: [{ source_id: 's1', quote: '原文证据', locator: 'line:1' }], candidate_drafts: [{ category: 'source_principle', interpretation: '研究解释', evidence_quote: '原文证据', source_id: 's1', locator: 'line:1', uncertainty: '仅限本段' }], challenges: [{ target_message_id: 'user', type: 'missing_condition', summary: '目标缺少条件' }], unknowns: [], next_actions: [] },
    provider: 'mock', model: 'mock',
  });
  const report = await runResearchRoom({ request: req, materials, invokeAgent });
  assert.equal(report.audit.ok, true);
  assert.equal(report.candidate_drafts[0].content, '研究解释');
  assert.equal(report.candidate_drafts[0].quote, '原文证据');
  assert.equal(report.disagreements[0].target_message_id, 'objective');
});

test('agent room canonicalizes free-text challenges instead of spreading characters into report fields', async () => {
  const req = request('data/sources/wikisource-mingli/source.txt', '原文证据');
  const materials = [{ source_id: 's1', path: 'data/sources/wikisource-mingli/source.txt', locator: 'line:1', source_sha256: 'hash', focus_text: '原文证据', context_text: '原文证据' }];
  const invokeAgent = async ({ role }) => ({
    content: { status: 'mixed', summary: `${role} summary`, citations: [{ source_id: 's1', quote: '原文证据', locator: 'line:1' }], challenges: ['自由文本异议'], unknowns: [], next_actions: [] },
    provider: 'mock', model: 'mock',
  });
  const report = await runResearchRoom({ request: req, materials, invokeAgent });
  assert.equal(report.disagreements[0].target_message_id, 'objective');
  assert.equal(report.disagreements[0].type, 'free_text');
  assert.equal(report.disagreements[0].summary, '自由文本异议');
  assert.equal('0' in report.disagreements[0], false);
});

test('web-only rooms are explicit, bounded, and do not require a local source', () => {
  const room = normalizeRoomRequest({ protocol: 'yura.agent_room.v1', room_id: 'web-only', objective: '公开网页核验', system: 'mixed', write_policy: 'research_only', sources: [], allocation: { mode: 'agent' }, capabilities: { web: true, files: false }, limits: { web_concurrency: 8, max_total_tool_calls: 12 } });
  assert.equal(room.sources.length, 0);
  assert.equal(room.capabilities.web, true);
  assert.equal(room.capabilities.files, false);
  assert.equal(room.capabilities.agent_tools, false);
  assert.equal(room.limits.web_concurrency, 8);
  assert.throws(() => normalizeRoomRequest({ ...room, room_id: 'no-web', sources: [], capabilities: { web: false } }), /sources must contain 1-8/u);
});

test('dynamic room accepts sixteen model agents and rejects a seventeenth', () => {
  const base = { protocol: 'yura.agent_room.v1', room_id: 'room-sixteen', objective: '十六并发边界', system: 'mixed', write_policy: 'research_only', sources: [], allocation: { mode: 'agent', max_agents: 16, concurrency: 16 }, capabilities: { web: true } };
  const room = normalizeRoomRequest(base);
  assert.equal(room.allocation.max_agents, 16);
  assert.equal(room.allocation.concurrency, 16);
  assert.throws(() => normalizeRoomRequest({ ...base, allocation: { mode: 'agent', max_agents: 16, concurrency: 17 } }), /concurrency must be 1-16/u);
  assert.throws(() => normalizeRoomRequest({ ...base, allocation: { mode: 'agent', max_agents: 17, concurrency: 16 } }), /max_agents must be 2-16/u);
});

test('web toolbox serializes each website, keeps cross-site concurrency, and deduplicates identical work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-web-tools-'));
  let active = 0;
  let peak = 0;
  let fetches = 0;
  const originActive = new Map();
  const originPeaks = new Map();
  const html = query => `<html><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(`https://example.com/${query}`)}">Result ${query}</a><div class="result__snippet">Evidence ${query}</div></html>`;
  try {
    const toolbox = createAgentToolbox({
      cwd: root,
      workspaceRoot: join(root, 'workspace'),
      capabilities: { web: true, files: false },
      webConcurrency: 2,
      fetchImpl: async url => {
        const parsed = new URL(url);
        const origin = parsed.origin;
        fetches += 1; active += 1; peak = Math.max(peak, active);
        originActive.set(origin, (originActive.get(origin) ?? 0) + 1);
        originPeaks.set(origin, Math.max(originPeaks.get(origin) ?? 0, originActive.get(origin)));
        await new Promise(resolve => setTimeout(resolve, 20));
        active -= 1; originActive.set(origin, originActive.get(origin) - 1);
        const query = parsed.searchParams.get('q');
        const body = origin === 'https://html.duckduckgo.com' ? html(query) : `<html>Page from ${origin}</html>`;
        return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
      },
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    });
    const [first, duplicate, second] = await Promise.all([
      toolbox({ name: 'web_search', arguments: { query: 'alpha' } }, 'a'),
      toolbox({ name: 'web_search', arguments: { query: 'alpha' } }, 'b'),
      toolbox({ name: 'web_search', arguments: { query: 'beta' } }, 'c'),
    ]);
    assert.equal(fetches, 2);
    assert.equal(peak, 1);
    assert.equal([first.cache_hit, duplicate.cache_hit].filter(Boolean).length, 1);
    assert.equal(second.sources[0].source_id, 'web:https://example.com/beta');
    assert.equal(second.sources[0].text, 'Result beta\nEvidence beta');
    const crossSite = await Promise.all([
      toolbox({ name: 'web_fetch', arguments: { url: 'https://example.com/page' } }, 'a'),
      toolbox({ name: 'web_fetch', arguments: { url: 'https://example.org/page' } }, 'b'),
    ]);
    assert.deepEqual(crossSite.map(row => row.ok), [true, true]);
    assert.equal(peak, 2);
    assert.deepEqual(Object.fromEntries(originPeaks), { 'https://html.duckduckgo.com': 1, 'https://example.com': 1, 'https://example.org': 1 });
    assert.deepEqual(toolbox.getStats(), {
      calls: 5, ok: 5, failed: 0, network_requests: 4, cache_hits: 1,
      peak_web_concurrency: 2, serialized_origin_waits: 1, cache_entries: 4,
      max_total_calls: 48, web_concurrency: 2, per_origin_concurrency: 1,
      origin_count: 3,
      peak_origin_concurrency: { 'https://example.com': 1, 'https://example.org': 1, 'https://html.duckduckgo.com': 1 },
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('web search fails closed when a provider returns a human-verification challenge', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-web-challenge-'));
  try {
    const toolbox = createAgentToolbox({
      cwd: root,
      workspaceRoot: join(root, 'workspace'),
      capabilities: { web: true, files: false },
      fetchImpl: async () => new Response('<html><title>Human Verification</title><body>Captcha challenge: verify you are human.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    });
    const result = await toolbox({ name: 'web_search', arguments: { query: 'authority evidence' } }, 'researcher');
    assert.equal(result.ok, false);
    assert.match(result.error, /web_search_challenge_detected/);
    assert.equal('sources' in result, false);
    assert.equal(toolbox.getStats().ok, 0);
    assert.equal(toolbox.getStats().failed, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('dynamic room browses in parallel across iterative tool rounds and audits shared web sources', async () => {
  const req = normalizeRoomRequest({ protocol: 'yura.agent_room.v1', room_id: 'room-parallel-web', objective: '并行网页核验', system: 'mixed', write_policy: 'research_only', sources: [], limits: { max_rounds: 4, max_agent_chars: 3000, max_material_chars: 4000, max_tool_rounds_per_agent: 2, max_tool_calls_per_agent: 4 }, allocation: { mode: 'agent', max_agents: 2, concurrency: 2 }, capabilities: { web: true, files: false } });
  let active = 0;
  let peak = 0;
  const invokeAgent = async ({ role, messages }) => {
    if (role === 'coordinator') return { content: { plan: [{ agent_id: 'researcher', specialty: '网页研究', task: '搜索并抓取', tools: ['web_search', 'web_fetch'] }, { agent_id: 'verifier', specialty: '共享证据审计', task: '核验前序网页证据', depends_on: ['researcher'], tools: [] }] } };
    if (role === 'memory_reviewer') return { content: { memories: [] } };
    if (role === 'researcher') {
      const toolResults = JSON.parse(messages[1].content).tool_results;
      if (toolResults.length === 0) return { content: { status: 'unresolved', summary: '并行搜索', citations: [], challenges: [], unknowns: [], next_actions: [], tool_requests: [{ name: 'web_search', arguments: { query: 'alpha' } }, { name: 'web_search', arguments: { query: 'beta' } }] } };
      if (toolResults.length === 2) return { content: { status: 'unresolved', summary: '抓取原页', citations: [], challenges: [], unknowns: [], next_actions: [], tool_requests: [{ name: 'web_fetch', arguments: { url: 'https://example.com/page' } }] } };
    }
    return { content: { status: 'supported', summary: `${role} verified`, citations: [{ source_id: 'web:https://example.com/page', quote: '公开证据', locator: 'web' }], challenges: [], unknowns: [], next_actions: [] }, provider: 'mock', model: 'mock' };
  };
  const executeTool = async requestValue => {
    active += 1; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active -= 1;
    if (requestValue.name === 'web_fetch') return { ok: true, source_id: 'web:https://example.com/page', url: 'https://example.com/page', text: '这里有公开证据可供逐字核验。' };
    return { ok: true, source_id: `web-search:${requestValue.arguments.query}`, text: requestValue.arguments.query, sources: [] };
  };
  const report = await runResearchRoom({ request: req, materials: [], invokeAgent, executeTool });
  assert.equal(peak, 2);
  assert.equal(report.transcript[0].provenance.tool_results.length, 3);
  assert.equal(report.audit.verified_citation_count, 2);
  assert.equal(report.audit.ok, true);
assert.deepEqual(report.transcript.map(row => row.message_id), ['m-1-researcher', 'm-2-verifier']);
});

test('dynamic room repairs malformed model output after a tool round', async () => {
const req = normalizeRoomRequest({ protocol: 'yura.agent_room.v1', room_id: 'room-tool-repair', objective: '工具后修复', system: 'mixed', write_policy: 'research_only', sources: [], limits: { max_rounds: 4, max_agent_chars: 3000, max_material_chars: 4000, max_tool_rounds_per_agent: 2, max_tool_calls_per_agent: 4 }, allocation: { mode: 'agent', max_agents: 2, concurrency: 1 }, capabilities: { web: true, files: false } });
let researcherCalls = 0;
const events = [];
const invokeAgent = async ({ role, messages }) => {
if (role === 'coordinator') return { content: { plan: [{ agent_id: 'researcher', specialty: '网页研究', task: '搜索并抓取', tools: ['web_search'] }, { agent_id: 'verifier', specialty: '共享证据审计', task: '核验前序网页证据', depends_on: ['researcher'], tools: [] }] } };
if (role === 'memory_reviewer') return { content: { memories: [] } };
if (role === 'researcher') {
researcherCalls += 1;
if (researcherCalls === 1) return { content: { status: 'unresolved', summary: '先搜索', citations: [], challenges: [], unknowns: [], next_actions: [], tool_requests: [{ name: 'web_search', arguments: { query: 'evidence' } }] } };
if (researcherCalls === 2) return { content: { answer: '有证据但格式错误' } };
assert.match(messages.at(-1).content, /previous response was rejected/i);
return { content: { status: 'supported', summary: '已修复工具后输出', citations: [{ source: 'https://example.com/page', quote: '公开证据' }], challenges: [], unknowns: [], next_actions: [] }, provider: 'mock', model: 'mock' };
}
return { content: { status: 'supported', summary: '核验完成', citations: [{ source_url: 'https://example.com/page', quote: '公开证据' }], challenges: [], unknowns: [], next_actions: [] }, provider: 'mock', model: 'mock' };
};
const executeTool = async () => ({ ok: true, source_id: 'web:https://example.com/page', url: 'https://example.com/page', text: '这里有公开证据可供逐字核验。' });
const report = await runResearchRoom({ request: req, materials: [], invokeAgent, executeTool, onEvent: async event => events.push(event) });
assert.equal(report.transcript[0].payload.status, 'supported');
assert.equal(report.audit.ok, true);
assert.equal(report.audit.verified_citation_count, 2);
assert.equal(report.transcript[0].payload.citations[0].source_id, 'web:https://example.com/page');
assert.equal(report.transcript[1].payload.citations[0].source_id, 'web:https://example.com/page');
assert.ok(events.some(event => event.type === 'agent.schema_repaired' && event.after_tool_round === 1));
});

test('resumed room re-audits legacy URL citations without rerunning completed agents', async () => {
const req = normalizeRoomRequest({ protocol: 'yura.agent_room.v1', room_id: 'room-resume-citation', objective: '重审旧引用', system: 'mixed', write_policy: 'research_only', sources: [], limits: { max_rounds: 4, max_agent_chars: 3000, max_material_chars: 4000 }, allocation: { mode: 'agent', max_agents: 2, concurrency: 1 }, capabilities: { web: true, files: false } });
const checkpoint = {
room_id: req.room_id,
plan: [
{ agent_id: 'researcher', specialty: '资料', task: '已完成', depends_on: [], tools: ['web_fetch'] },
{ agent_id: 'auditor', specialty: '审计', task: '已完成', depends_on: ['researcher'], tools: [] },
],
completed: ['researcher', 'auditor'],
round: 2,
transcript: [{
message_id: 'm-1-researcher',
message_sha256: 'legacy-message-hash',
role: '资料',
agent_id: 'researcher',
in_reply_to: [],
payload: { status: 'supported', summary: '旧格式引用', citations: [{ source: 'https://example.com/page', quote: '公开证据' }], candidate_drafts: [], challenges: [], unknowns: [], next_actions: [], tool_requests: [], delegations: [] },
provenance: { tool_results: [{ result: { ok: true, url: 'https://example.com/page', text: '这里有公开证据可供逐字核验。' } }] },
}],
};
const report = await runResearchRoom({ request: req, materials: [], checkpoint, invokeAgent: async ({ role }) => role === 'memory_reviewer' ? { content: { memories: [] } } : assert.fail('completed agents must not rerun') });
assert.equal(report.audit.ok, true);
assert.equal(report.audit.verified_citation_count, 1);
});

test('agent-room provider changes models only for explicit capacity errors', async () => {
  process.env.AGENT_ROOM_TEST_KEY = 'temporary-test-key';
  const models = [];
  try {
    const invoke = createOpenAiCompatibleInvoker({ base_url: 'https://example.com/v1', model: 'gpt-5.6-terra', key_env: 'AGENT_ROOM_TEST_KEY', max_retries: 0 }, { completionImpl: async ({ model }) => {
      models.push(model);
      if (models.length === 1) throw new Error('Selected model is at capacity. Please try a different model.');
      return { content: '{}', usage: { total_tokens: 1 } };
    } });
    const result = await invoke({ role: 'researcher', messages: [] });
    assert.deepEqual(models, ['gpt-5.6-terra', 'gpt-5.6-luna']);
    assert.equal(result.requested_model, 'gpt-5.6-terra');
    assert.equal(result.model, 'gpt-5.6-luna');
    assert.deepEqual(result.capacity_fallbacks, [{ model: 'gpt-5.6-terra', error: 'model_at_capacity' }]);

    models.length = 0;
    const fail = createOpenAiCompatibleInvoker({ base_url: 'https://example.com/v1', model: 'gpt-5.6-terra', key_env: 'AGENT_ROOM_TEST_KEY' }, { completionImpl: async ({ model }) => { models.push(model); throw new Error('http 503: upstream unavailable'); } });
    await assert.rejects(() => fail({ role: 'researcher', messages: [] }), /upstream unavailable/u);
    assert.deepEqual(models, ['gpt-5.6-terra']);
  } finally { delete process.env.AGENT_ROOM_TEST_KEY; }
});

test('agent-room Responses adapter preserves arbitrary room messages and requests JSON safely', async () => {
  process.env.AGENT_ROOM_TEST_KEY = 'temporary-test-key';
  let requestBody;
  try {
    const invoke = createOpenAiCompatibleInvoker({ base_url: 'https://www.ainipy.com/api/desktop/v1', model: 'gpt-5.6-terra', key_env: 'AGENT_ROOM_TEST_KEY', api_mode: 'responses', reasoning_effort: 'medium', max_output_tokens: 4000 }, { fetchImpl: async (url, init) => {
      assert.equal(String(url), 'https://www.ainipy.com/api/desktop/v1/responses');
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"status":"supported"}' }] }], usage: { total_tokens: 9 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    } });
    const result = await invoke({ role: 'researcher', messages: [{ role: 'system', content: 'System boundary' }, { role: 'user', content: '{"task":"browse"}' }] });
    assert.match(requestBody.instructions, /System boundary/u);
    assert.match(requestBody.instructions, /exactly one valid JSON object/u);
    assert.deepEqual(requestBody.input, [{ role: 'user', content: '{"task":"browse"}' }]);
    assert.equal(requestBody.store, false);
    assert.equal(result.content, '{"status":"supported"}');
    assert.equal(result.model, 'gpt-5.6-terra');
  } finally { delete process.env.AGENT_ROOM_TEST_KEY; }
});

test('agent_tools is an in-process read-only kit channel', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-kit-bridge-'));
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'sample.mjs'), 'export const previousStateHash = 1;\n', 'utf8');
    const toolbox = createAgentToolbox({
      cwd: root,
      workspaceRoot: join(root, 'workspace'),
      capabilities: { web: false, files: false, agent_tools: true },
    });
    const blocked = await toolbox({ name: 'agent_tools', arguments: { command: 'index', path: 'src', out: 'artifacts/indexes/x.jsonl' } }, 'reader');
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /forbids write/u);
    const blockedOcr = await toolbox({ name: 'agent_tools', arguments: { command: 'ocr', path: 'library/scan.pdf', out: 'artifacts/ocr' } }, 'reader');
    assert.equal(blockedOcr.ok, false);
    assert.match(blockedOcr.error, /forbids OCR/u);
    const searched = await toolbox({ name: 'agent_tools', arguments: { command: 'search', query: 'previousStateHash', path: 'src', ext: 'mjs', max: 8 } }, 'reader');
    assert.equal(searched.ok, true);
    assert.equal(searched.source_id, 'agent-tools:search');
    assert.equal(searched.payload.totalMatches, 1);
    assert.match(searched.text, /previousStateHash/);
    const named = await toolbox({ name: 'search_files', arguments: { query: 'sample.mjs', path: 'src' } }, 'reader');
    assert.equal(named.ok, true);
    assert.deepEqual(named.payload.files, ['src/sample.mjs']);
    writeFileSync(join(root, 'src', 'hash.mjs'), 'export const leftoverHash = 2;\n', 'utf8');
    const lookup = await toolbox({ name: 'lookup', arguments: { query: 'previousStateHash', path: 'src', max: 8 } }, 'reader');
    assert.equal(lookup.ok, true);
    assert.match(lookup.text, /QUERY previousStateHash/);
    assert.match(lookup.text, /CONTENT/);
    assert.ok(lookup.payload.content.some((row) => row.path === 'src/sample.mjs'));
    assert.ok(lookup.payload.related.some((row) => row.path === 'src/hash.mjs'));
    const ocrRoom = createAgentToolbox({
      cwd: root,
      workspaceRoot: join(root, 'workspace'),
      capabilities: { web: false, files: false, agent_tools: true, ocr: true },
    });
    const ocrBlockedOut = await ocrRoom({ name: 'agent_tools', arguments: { command: 'ocr', path: 'library/scan.pdf', out: 'artifacts/indexes' } }, 'reader');
    assert.equal(ocrBlockedOut.ok, false);
    assert.match(ocrBlockedOut.error, /artifacts\/ocr/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('dynamic room can grant agent_tools without file writes', async () => {
  const req = normalizeRoomRequest({
    protocol: 'yura.agent_room.v1',
    room_id: 'room-kit',
    objective: '检索仓库材料',
    system: 'mixed',
    write_policy: 'research_only',
    sources: [{ source_id: 's1', path: 'data/sources/wikisource-mingli/source.txt', quote: '原文证据' }],
    limits: { max_rounds: 3, max_agent_chars: 3000, max_material_chars: 4000, max_tool_rounds_per_agent: 1, max_tool_calls_per_agent: 2 },
    allocation: { mode: 'agent', max_agents: 2, concurrency: 1 },
    capabilities: { web: false, files: false, agent_tools: true },
  });
  const materials = [{ source_id: 's1', path: 'data/sources/wikisource-mingli/source.txt', locator: 'line:1', source_sha256: 'hash', focus_text: '原文证据', context_text: '原文证据' }];
  const invokeAgent = async ({ role, messages }) => {
    if (role === 'coordinator') return { content: { plan: [{ agent_id: 'researcher', specialty: '检索', task: '用 agent tools 搜索', tools: ['agent_tools', 'write_file'] }, { agent_id: 'verifier', specialty: '核验', task: '核验', depends_on: ['researcher'], tools: [] }] } };
    if (role === 'memory_reviewer') return { content: { memories: [] } };
    if (role === 'researcher' && !JSON.parse(messages[1].content).tool_results.length) {
      return { content: { status: 'unresolved', summary: '先搜索', citations: [], challenges: [], unknowns: [], next_actions: [], tool_requests: [{ name: 'agent_tools', arguments: { command: 'search', query: '原文证据' } }] } };
    }
    return { content: { status: 'supported', summary: 'kit 通道可用', citations: [{ source_id: 's1', quote: '原文证据', locator: 'line:1' }], challenges: [], unknowns: [], next_actions: [] }, provider: 'mock', model: 'mock' };
  };
  const executeTool = async requestValue => ({ ok: true, source_id: 'agent-tools:search', command: requestValue.arguments.command, text: '原文证据', payload: { totalMatches: 1 } });
  const report = await runResearchRoom({ request: req, materials, invokeAgent, executeTool });
  assert.deepEqual(report.allocation.plan[0].tools, ['agent_tools']);
  assert.equal(report.transcript[0].provenance.tool_results[0].request.name, 'agent_tools');
  assert.equal(report.audit.ok, true);
});

test('live status folds room events into a current snapshot', () => {
  const status = snapshotFromEvents([
    { type: 'room.started', room_id: 'room-live', allocation: 'agent' },
    { type: 'room.plan', room_id: 'room-live', agents: [{ agent_id: 'researcher', specialty: '检索', tools: ['agent_tools'] }] },
    { type: 'agent.started', room_id: 'room-live', agent_id: 'researcher', role: '检索' },
    { type: 'tool.started', room_id: 'room-live', agent_id: 'researcher', tool: 'agent_tools', tool_round: 1 },
    { type: 'tool.completed', room_id: 'room-live', agent_id: 'researcher', tool: 'agent_tools', tool_round: 1, ok: true },
    { type: 'agent.message', room_id: 'room-live', agent_id: 'researcher', role: '检索', status: 'supported', summary: '完成', message_id: 'm-1' },
    { type: 'room.completed', room_id: 'room-live', decision: 'completed', audit_ok: true },
  ], createLiveStatus({ objective: '观察' }));
  assert.equal(status.state, 'completed');
  assert.equal(status.agents[0].status, 'done');
  assert.equal(status.tool_counts.completed, 1);
  assert.equal(status.active_agents.length, 0);
  assert.equal(status.recent_messages[0].summary, '完成');
});

test('agent room UI serves the current room snapshot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-room-ui-'));
  const roomDir = join(root, 'room-ui');
  mkdirSync(roomDir, { recursive: true });
  writeFileSync(join(roomDir, 'status.json'), `${JSON.stringify({
    protocol: 'yura.agent_room_status.v1',
    room_id: 'room-ui',
    objective: '实时查看',
    state: 'running',
    agents: [{ agent_id: 'researcher', status: 'running', specialty: '检索' }],
    recent_messages: [],
    recent_tools: [],
    tool_counts: { started: 1, completed: 0, failed: 0 },
  }, null, 2)}\n`, 'utf8');
  const ui = startRoomUi({ port: 0, runsDirectory: root });
  try {
    const info = await ui.listen();
    const page = await fetch(info.url);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Agent Room/);
    const status = await fetch(`${info.url}api/status`).then(row => row.json());
    assert.equal(status.room_id, 'room-ui');
    assert.equal(status.state, 'running');
    assert.equal(status.objective, '实时查看');
  } finally {
    await ui.close();
    rmSync(root, { recursive: true, force: true });
  }
});
