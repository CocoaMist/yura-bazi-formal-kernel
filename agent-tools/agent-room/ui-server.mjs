#!/usr/bin/env node
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createLiveStatus, LIVE_STATUS_PROTOCOL } from './live-status.mjs';

const root = resolve(import.meta.dirname, '../..');
const defaultRunsRoot = resolve(root, 'artifacts/agent-room-runs');
const defaultPage = resolve(import.meta.dirname, 'ui/index.html');
export const DEFAULT_UI_PORT = 3780;

function safeRoomId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u.test(value);
}

function runDirFrom(base, roomId) {
  if (!safeRoomId(roomId)) throw new TypeError('invalid room id');
  const directory = resolve(base, roomId);
  const rel = relative(base, directory).replaceAll('\\', '/');
  if (rel.startsWith('../') || rel.includes('/')) throw new TypeError('invalid room id');
  return directory;
}

export function listRoomsFrom(base) {
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && safeRoomId(entry.name))
    .map(entry => {
      const directory = join(base, entry.name);
      const statusPath = join(directory, 'status.json');
      const eventsPath = join(directory, 'events.jsonl');
      const status = existsSync(statusPath) ? JSON.parse(readFileSync(statusPath, 'utf8')) : null;
      const updated = existsSync(statusPath)
        ? statSync(statusPath).mtimeMs
        : existsSync(eventsPath) ? statSync(eventsPath).mtimeMs : statSync(directory).mtimeMs;
      return {
        room_id: entry.name,
        state: status?.state ?? (existsSync(eventsPath) ? 'unknown' : 'idle'),
        objective: status?.objective ?? null,
        decision: status?.decision ?? null,
        updated_at: status?.updated_at ?? null,
        updated_ms: updated,
      };
    })
    .sort((left, right) => right.updated_ms - left.updated_ms || (left.room_id < right.room_id ? -1 : 1));
}

function publicRooms(base) {
  return listRoomsFrom(base).map(({ updated_ms, ...row }) => row);
}

function readStatusFrom(base, roomId) {
  const directory = runDirFrom(base, roomId);
  const path = join(directory, 'status.json');
  if (existsSync(path)) {
    const status = JSON.parse(readFileSync(path, 'utf8'));
    if (status?.protocol === LIVE_STATUS_PROTOCOL) return status;
  }
  return createLiveStatus({ room_id: roomId, state: existsSync(join(directory, 'events.jsonl')) ? 'unknown' : 'idle' });
}

async function readEventsFrom(base, roomId, { after = 0, limit = 200 } = {}) {
  const path = join(runDirFrom(base, roomId), 'events.jsonl');
  if (!existsSync(path)) return [];
  const events = [];
  let index = 0;
  const reader = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line.trim()) continue;
    index += 1;
    if (index <= after) continue;
    events.push(JSON.parse(line));
    if (events.length >= limit) break;
  }
  return events;
}

function json(response, value, status = 200) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

export function startRoomUi({
  host = '127.0.0.1',
  port = DEFAULT_UI_PORT,
  runsDirectory = defaultRunsRoot,
  pageFile = defaultPage,
} = {}) {
  const clients = new Set();
  const currentRoomId = requested => requested || listRoomsFrom(runsDirectory)[0]?.room_id || null;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${host}:${port}`);
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const body = readFileSync(pageFile);
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': body.length,
        });
        response.end(body);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/rooms') {
        return json(response, { rooms: publicRooms(runsDirectory), current: currentRoomId(url.searchParams.get('room')) });
      }
      if (request.method === 'GET' && url.pathname === '/api/status') {
        const roomId = currentRoomId(url.searchParams.get('room'));
        if (!roomId) return json(response, { ...createLiveStatus(), rooms: [] });
        return json(response, { ...readStatusFrom(runsDirectory, roomId), rooms: publicRooms(runsDirectory).slice(0, 12) });
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        const roomId = currentRoomId(url.searchParams.get('room'));
        if (!roomId) return json(response, { events: [] });
        const after = Number.parseInt(url.searchParams.get('after') ?? '0', 10) || 0;
        const events = await readEventsFrom(runsDirectory, roomId, { after, limit: 200 });
        return json(response, { room_id: roomId, after, events });
      }
      if (request.method === 'GET' && url.pathname === '/api/stream') {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        response.write(':\n\n');
        const client = { response };
        clients.add(client);
        request.on('close', () => clients.delete(client));
        return;
      }
      json(response, { error: 'not_found' }, 404);
    } catch (error) {
      json(response, { error: String(error.message ?? error).slice(0, 300) }, 400);
    }
  });

  function broadcast(payload) {
    const body = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) {
      try { client.response.write(body); } catch { clients.delete(client); }
    }
  }

  let watcher = null;
  try {
    if (existsSync(runsDirectory)) {
      watcher = watch(runsDirectory, { recursive: true }, (_event, filename) => {
        const name = String(filename ?? '').replaceAll('\\', '/');
        if (!name.endsWith('status.json') && !name.endsWith('events.jsonl')) return;
        const current = currentRoomId(null);
        if (!current) {
          broadcast({ type: 'rooms', rooms: publicRooms(runsDirectory) });
          return;
        }
        try {
          broadcast({ type: 'status', status: { ...readStatusFrom(runsDirectory, current), rooms: publicRooms(runsDirectory).slice(0, 12) } });
        } catch {
          broadcast({ type: 'rooms', rooms: publicRooms(runsDirectory) });
        }
      });
    }
  } catch {
    watcher = null;
  }

  return {
    server,
    async close() {
      watcher?.close();
      for (const client of clients) client.response.end();
      await new Promise(resolveClose => server.close(resolveClose));
    },
    listen() {
      return new Promise(resolveListen => {
        server.listen(port, host, () => {
          const address = server.address();
          resolveListen({ host, port: address.port, url: `http://${host}:${address.port}/` });
        });
      });
    },
  };
}

const launchedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (launchedDirectly) {
  const portFlag = process.argv.indexOf('--port');
  const port = portFlag >= 0 ? Number.parseInt(process.argv[portFlag + 1], 10) : DEFAULT_UI_PORT;
  const ui = startRoomUi({ port });
  const info = await ui.listen();
  process.stdout.write(`Agent Room UI ${info.url}\nWatching ${relative(root, defaultRunsRoot).replaceAll('\\', '/')}\n`);
}
