export const LIVE_STATUS_PROTOCOL = 'yura.agent_room_status.v1';

function agentRow(row = {}) {
  return {
    agent_id: row.agent_id ?? null,
    specialty: row.specialty ?? row.role ?? null,
    depends_on: Array.isArray(row.depends_on) ? [...row.depends_on] : [],
    tools: Array.isArray(row.tools) ? [...row.tools] : [],
    status: row.status ?? 'pending',
    summary: row.summary ?? null,
    message_status: row.message_status ?? null,
  };
}

export function createLiveStatus(seed = {}) {
  return {
    protocol: LIVE_STATUS_PROTOCOL,
    room_id: seed.room_id ?? null,
    objective: seed.objective ?? null,
    state: seed.state ?? 'idle',
    decision: seed.decision ?? null,
    audit_ok: seed.audit_ok ?? null,
    updated_at: seed.updated_at ?? null,
    allocation: seed.allocation ?? null,
    capabilities: seed.capabilities ?? null,
    rounds: 0,
    events_count: 0,
    last_event: null,
    active_agents: [],
    agents: [],
    recent_messages: [],
    recent_tools: [],
    tool_counts: { started: 0, completed: 0, failed: 0 },
    context_compressions: 0,
    memory: { accepted: 0, rejected: 0 },
  };
}

function upsertAgent(status, patch) {
  const existing = status.agents.find(row => row.agent_id === patch.agent_id);
  if (existing) Object.assign(existing, patch);
  else status.agents.push(agentRow(patch));
}

export function applyEvent(status, event = {}) {
  status.events_count += 1;
  status.last_event = event;
  status.updated_at = event.at ?? new Date().toISOString();
  if (event.room_id) status.room_id = event.room_id;
  const type = event.type;
  if (type === 'room.started') {
    status.state = event.resumed ? 'resumed' : 'planning';
    status.allocation = event.allocation ?? status.allocation;
  } else if (type === 'room.plan') {
    status.state = 'running';
    status.agents = (event.agents ?? []).map(row => agentRow({ ...row, status: 'pending' }));
  } else if (type === 'agent.started') {
    status.state = status.state === 'idle' ? 'running' : status.state;
    if (!status.active_agents.includes(event.agent_id)) status.active_agents.push(event.agent_id);
    upsertAgent(status, { agent_id: event.agent_id, specialty: event.role, status: 'running' });
  } else if (type === 'agent.allocated') {
    upsertAgent(status, { agent_id: event.agent_id, specialty: event.specialty, status: 'pending' });
  } else if (type === 'agent.message') {
    status.active_agents = status.active_agents.filter(id => id !== event.agent_id);
    upsertAgent(status, {
      agent_id: event.agent_id,
      specialty: event.role,
      status: 'done',
      summary: event.summary ?? null,
      message_status: event.status ?? null,
    });
    status.recent_messages.unshift({
      at: status.updated_at,
      agent_id: event.agent_id,
      message_id: event.message_id,
      status: event.status,
      summary: event.summary,
    });
    status.recent_messages = status.recent_messages.slice(0, 24);
  } else if (type === 'tool.started') {
    status.tool_counts.started += 1;
    status.recent_tools.unshift({ at: status.updated_at, agent_id: event.agent_id, tool: event.tool, ok: null, round: event.tool_round });
    status.recent_tools = status.recent_tools.slice(0, 24);
  } else if (type === 'tool.completed') {
    status.tool_counts.completed += 1;
    if (event.ok === false) status.tool_counts.failed += 1;
    const latest = status.recent_tools.find(row => row.agent_id === event.agent_id && row.tool === event.tool && row.ok == null);
    if (latest) latest.ok = event.ok === true;
  } else if (type === 'context.compressed') {
    status.context_compressions += 1;
  } else if (type === 'memory.reviewed') {
    status.memory = { accepted: event.accepted ?? 0, rejected: event.rejected ?? 0 };
  } else if (type === 'room.completed') {
    status.state = event.decision === 'blocked' ? 'blocked' : 'completed';
    status.decision = event.decision ?? null;
    status.audit_ok = event.audit_ok ?? null;
    status.active_agents = [];
  }
  return status;
}

export function snapshotFromEvents(events, seed = {}) {
  const status = createLiveStatus(seed);
  for (const event of events) applyEvent(status, event);
  return status;
}
