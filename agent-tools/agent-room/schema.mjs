const SYSTEMS = new Set([
  'bazi', 'liuyao', 'qimen', 'liuren', 'ziwei', 'fengshui', 'xingming',
  'xiangshu', 'calendar_selection', 'agricultural_omen', 'daoist', 'mixed',
]);

export const ROOM_PROTOCOL = 'yura.agent_room.v1';
export const REPORT_PROTOCOL = 'yura.agent_room_report.v1';
export const ROOM_ROLES = Object.freeze(['analyst_a', 'analyst_b', 'verifier', 'critic', 'moderator']);
export const TOOL_NAMES = Object.freeze(['web_search', 'web_fetch', 'read_file', 'write_file', 'create_file', 'agent_tools', 'lookup', 'search_files', 'search_content']);
export const MESSAGE_STATUSES = Object.freeze(['supported', 'mixed', 'unresolved', 'blocked']);

function safeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u.test(value);
}

export function validateRoomRequest(input) {
  const errors = [];
  if (input?.protocol !== ROOM_PROTOCOL) errors.push(`protocol must be ${ROOM_PROTOCOL}`);
  if (!safeId(input?.room_id)) errors.push('room_id must be a safe 1-80 character id');
  if (typeof input?.objective !== 'string' || !input.objective.trim() || input.objective.length > 4000) errors.push('objective must be 1-4000 characters');
  if (!SYSTEMS.has(input?.system)) errors.push(`system must be one of ${[...SYSTEMS].join('|')}`);
  if (input?.write_policy !== 'research_only') errors.push('write_policy must be research_only');
  const webOnly = input?.capabilities?.web === true;
  if (!Array.isArray(input?.sources) || input.sources.length > 8 || (!webOnly && input.sources.length < 1)) {
    errors.push(webOnly ? 'sources must contain 0-8 bounded source references' : 'sources must contain 1-8 bounded source references unless web capability is enabled');
  }
  for (const [index, source] of (input?.sources ?? []).entries()) {
    if (!safeId(source?.source_id)) errors.push(`sources[${index}].source_id is invalid`);
    if (typeof source?.path !== 'string' || !source.path.trim()) errors.push(`sources[${index}].path is required`);
    const hasQuote = typeof source?.quote === 'string' && source.quote.length > 0;
    const hasOffsets = Number.isInteger(source?.start) && Number.isInteger(source?.end) && source.start >= 0 && source.end > source.start;
    if (!hasQuote && !hasOffsets) errors.push(`sources[${index}] requires quote or start/end offsets`);
  }
  const limits = input?.limits ?? {};
  if (limits.max_rounds != null && (!Number.isInteger(limits.max_rounds) || limits.max_rounds < 1 || limits.max_rounds > 100)) errors.push('limits.max_rounds must be 1-100');
  if (limits.max_agent_chars != null && (!Number.isInteger(limits.max_agent_chars) || limits.max_agent_chars < 500 || limits.max_agent_chars > 8000)) errors.push('limits.max_agent_chars must be 500-8000');
  if (limits.max_material_chars != null && (!Number.isInteger(limits.max_material_chars) || limits.max_material_chars < 1000 || limits.max_material_chars > 40000)) errors.push('limits.max_material_chars must be 1000-40000');
  if (limits.max_tool_rounds_per_agent != null && (!Number.isInteger(limits.max_tool_rounds_per_agent) || limits.max_tool_rounds_per_agent < 1 || limits.max_tool_rounds_per_agent > 24)) errors.push('limits.max_tool_rounds_per_agent must be 1-24');
  if (limits.max_tool_calls_per_agent != null && (!Number.isInteger(limits.max_tool_calls_per_agent) || limits.max_tool_calls_per_agent < 1 || limits.max_tool_calls_per_agent > 64)) errors.push('limits.max_tool_calls_per_agent must be 1-64');
  if (limits.max_total_tool_calls != null && (!Number.isInteger(limits.max_total_tool_calls) || limits.max_total_tool_calls < 1 || limits.max_total_tool_calls > 512)) errors.push('limits.max_total_tool_calls must be 1-512');
  if (limits.web_concurrency != null && (!Number.isInteger(limits.web_concurrency) || limits.web_concurrency < 1 || limits.web_concurrency > 8)) errors.push('limits.web_concurrency must be 1-8');
  if (limits.web_result_chars != null && (!Number.isInteger(limits.web_result_chars) || limits.web_result_chars < 2000 || limits.web_result_chars > 50000)) errors.push('limits.web_result_chars must be 2000-50000');
  if (input?.provider?.api_key != null) errors.push('provider.api_key is forbidden; use provider.key_env');
  if (input?.agents != null && (typeof input.agents !== 'object' || Array.isArray(input.agents))) errors.push('agents must be a role-keyed object');
  for (const [role, provider] of Object.entries(input?.agents ?? {})) {
    if (!safeId(role)) errors.push(`invalid agent role: ${role}`);
    if (provider?.api_key != null) errors.push(`agents.${role}.api_key is forbidden; use key_env`);
    if (provider?.instances != null && (!Number.isInteger(provider.instances) || provider.instances < 1 || provider.instances > 6)) errors.push(`agents.${role}.instances must be 1-6`);
  }
  const configuredRoles = Object.keys(input?.agents ?? {});
  const totalInstances = (configuredRoles.length ? configuredRoles : ROOM_ROLES).reduce((sum, role) => sum + (input?.agents?.[role]?.instances ?? 1), 0);
  if (totalInstances > 16) errors.push('total agent instances must not exceed 16');
  if (input?.allocation != null && !['fixed', 'agent'].includes(input.allocation.mode)) errors.push('allocation.mode must be fixed or agent');
  if (input?.allocation?.max_agents != null && (!Number.isInteger(input.allocation.max_agents) || input.allocation.max_agents < 2 || input.allocation.max_agents > 16)) errors.push('allocation.max_agents must be 2-16');
  if (input?.allocation?.concurrency != null && (!Number.isInteger(input.allocation.concurrency) || input.allocation.concurrency < 1 || input.allocation.concurrency > 16)) errors.push('allocation.concurrency must be 1-16');
  if (input?.context?.target_chars != null && (!Number.isInteger(input.context.target_chars) || input.context.target_chars < 1000 || input.context.target_chars > 30000)) errors.push('context.target_chars must be 1000-30000');
  return errors;
}

export function normalizeRoomRequest(input) {
  const errors = validateRoomRequest(input);
  if (errors.length) throw new TypeError(`invalid agent-room request: ${errors.join('; ')}`);
  return Object.freeze({
    ...input,
    objective: input.objective.trim(),
    limits: Object.freeze({
      max_rounds: input.limits?.max_rounds ?? 1,
      max_agent_chars: input.limits?.max_agent_chars ?? 3000,
      max_material_chars: input.limits?.max_material_chars ?? 20000,
      timeout_ms: Math.min(Math.max(input.limits?.timeout_ms ?? 180000, 10000), 900000),
      max_tool_rounds_per_agent: input.limits?.max_tool_rounds_per_agent ?? 2,
      max_tool_calls_per_agent: input.limits?.max_tool_calls_per_agent ?? 8,
      max_total_tool_calls: input.limits?.max_total_tool_calls ?? 48,
      web_concurrency: input.limits?.web_concurrency ?? 4,
      web_result_chars: input.limits?.web_result_chars ?? 18000,
    }),
    allocation: Object.freeze({ mode: input.allocation?.mode ?? 'fixed', max_agents: input.allocation?.max_agents ?? 8, concurrency: input.allocation?.concurrency ?? 3 }),
    context: Object.freeze({ mode: 'smart', target_chars: input.context?.target_chars ?? 12000, preserve_recent: input.context?.preserve_recent ?? 6 }),
    capabilities: Object.freeze({
      web: input.capabilities?.web === true,
      files: input.capabilities?.files === true,
      agent_tools: input.capabilities?.agent_tools === true || input.capabilities?.ocr === true,
      ocr: input.capabilities?.ocr === true,
      workspace_only: true,
      audit: true,
    }),
    memory_review: 'ai',
  });
}

export function validateAgentPayload(payload) {
  const errors = [];
  if (!MESSAGE_STATUSES.includes(payload?.status)) errors.push(`status must be ${MESSAGE_STATUSES.join('|')}`);
  if (typeof payload?.summary !== 'string' || !payload.summary.trim()) errors.push('summary is required');
  if (payload?.citations != null && !Array.isArray(payload.citations)) errors.push('citations must be an array');
  if (payload?.challenges != null && !Array.isArray(payload.challenges)) errors.push('challenges must be an array');
  if (payload?.unknowns != null && !Array.isArray(payload.unknowns)) errors.push('unknowns must be an array');
  return errors;
}
