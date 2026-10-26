import { lookup } from 'node:dns/promises';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { sha256 } from './support/hash.mjs';
import { canonicalWorkspacePath } from './support/paths.mjs';
import { kitRequestFromObject, runKitCommand } from '../kit-commands.mjs';
import { formatLookup, formatSearchHits } from '../core.mjs';

const MAX_NET_BYTES = 1024 * 1024;
const MAX_FILE_CHARS = 120000;
const DEFAULT_WEB_TIMEOUT_MS = 20000;
const DEFAULT_SEARCH_RESULTS = 8;

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function privateAddress(value) {
  const ip = String(value).toLowerCase();
  return ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd') ||
    /^127\./u.test(ip) || /^10\./u.test(ip) || /^192\.168\./u.test(ip) ||
    /^169\.254\./u.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./u.test(ip);
}

async function publicHttps(raw, lookupImpl) {
  const url = new URL(String(raw));
  if (url.protocol !== 'https:') throw new TypeError('network tools require public HTTPS');
  if (url.username || url.password) throw new TypeError('URL credentials are forbidden');
  const rows = await lookupImpl(url.hostname, { all: true });
  if (!rows.length || rows.some(row => privateAddress(row.address))) throw new TypeError('private or loopback network target is forbidden');
  return url;
}

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/giu, '"').replace(/&#39;|&apos;/giu, "'")
    .replace(/&amp;/giu, '&').replace(/&lt;/giu, '<').replace(/&gt;/giu, '>')
    .replace(/&nbsp;/giu, ' ');
}

function stripHtml(value) {
  return decodeHtml(String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' '))
    .replace(/\s+/gu, ' ').trim();
}

async function fetchPublicText(raw, {
  fetchImpl,
  lookupImpl,
  timeoutMs = DEFAULT_WEB_TIMEOUT_MS,
  maxChars = 18000,
  rawHtml = false,
} = {}) {
  const url = await publicHttps(raw, lookupImpl);
  const response = await fetchImpl(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'YuraAgentRoom/1.0 research-only' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
  if (contentType && !/text|json|xml|xhtml/u.test(contentType)) throw new Error(`unsupported network content type: ${contentType.slice(0, 80)}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_NET_BYTES) throw new Error('network response exceeds 1 MiB');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_NET_BYTES) throw new Error('network response exceeds 1 MiB');
  const decoded = new TextDecoder().decode(bytes);
  const text = rawHtml ? decoded : stripHtml(decoded);
  return { url: url.href, text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

function duckDuckGoTarget(raw) {
  try {
    const url = new URL(decodeHtml(raw), 'https://html.duckduckgo.com');
    const redirected = url.searchParams.get('uddg');
    const target = redirected ? new URL(redirected) : url;
    if (target.protocol !== 'https:' || target.username || target.password) return null;
    return target.href;
  } catch { return null; }
}

function parseDuckDuckGo(html, maxResults = DEFAULT_SEARCH_RESULTS) {
  const anchors = [...String(html).matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)];
  const results = [];
  for (let index = 0; index < anchors.length && results.length < maxResults; index += 1) {
    const match = anchors[index];
    const url = duckDuckGoTarget(match[1]);
    if (!url) continue;
    const nextAt = anchors[index + 1]?.index ?? html.length;
    const tail = html.slice((match.index ?? 0) + match[0].length, nextAt);
    const snippetMatch = tail.match(/<(?:a|div)[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/iu);
    const title = stripHtml(match[2]).slice(0, 500);
    const snippet = stripHtml(snippetMatch?.[1] ?? '').slice(0, 1200);
    const sourceId = `web:${url}`;
    results.push(Object.freeze({ source_id: sourceId, url, title, snippet, text: `${title}\n${snippet}`.trim() }));
  }
  return results;
}

function createLimiter(concurrency, { onActive = () => {}, onQueued = () => {} } = {}) {
  let active = 0;
  const queue = [];
  const release = () => {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  };
  return async task => {
    if (active >= concurrency) {
      onQueued();
      await new Promise(resolveQueued => queue.push(resolveQueued));
    }
    active += 1;
    onActive(active);
    try { return await task(); } finally { release(); }
  };
}

function resolveReadPath(cwd, workspaceRoot, raw) {
  const input = String(raw ?? '').trim().replaceAll('\\', '/');
  const normalized = input.replace(/^\/+/, '');
  const canonicalInput = canonicalWorkspacePath(normalized);
  const knownResearchPath = /^(?:library\/book\/(?:wikisource-mingli|ctext-mingli|purchased-20260831)|data\/sources\/(?:wikisource-mingli|ctext-mingli|purchased-20260831)|research-tests\/deceased-persons\/analysis\/generated)(?:\/.*)?$/u.test(canonicalInput)
    ? canonicalInput
    : normalized;
  const candidate = resolve(cwd, knownResearchPath);
  const readRoots = [
    workspaceRoot,
    resolve(cwd, 'docs'),
    resolve(cwd, 'library/book/wikisource-mingli'),
    resolve(cwd, 'library/book/ctext-mingli'),
    resolve(cwd, 'library/book/purchased-20260831'),
    resolve(cwd, 'data/sources/wikisource-mingli'),
    resolve(cwd, 'data/sources/ctext-mingli'),
    resolve(cwd, 'data/sources/purchased-20260831'),
    resolve(cwd, 'research-tests/deceased-persons/analysis/generated'),
  ];
  if (!readRoots.some(root => inside(root, candidate))) throw new TypeError('read_file is limited to the run workspace and read-only research roots');
  return candidate;
}

function resolveWritePath(workspaceRoot, raw) {
  const candidate = resolve(workspaceRoot, String(raw ?? ''));
  if (!inside(workspaceRoot, candidate)) throw new TypeError('file writes must stay inside the run workspace');
  return candidate;
}

export function createAgentToolbox({
  cwd,
  workspaceRoot,
  capabilities,
  onAudit = async () => {},
  fetchImpl = globalThis.fetch,
  lookupImpl = lookup,
  webConcurrency = 4,
  webResultChars = 18000,
  maxTotalCalls = 48,
  maxSearchResults = DEFAULT_SEARCH_RESULTS,
} = {}) {
  if (typeof fetchImpl !== 'function' || typeof lookupImpl !== 'function') throw new TypeError('web toolbox requires fetch and DNS lookup implementations');
  if (!Number.isInteger(webConcurrency) || webConcurrency < 1 || webConcurrency > 8) throw new TypeError('webConcurrency must be 1-8');
  if (!Number.isInteger(maxTotalCalls) || maxTotalCalls < 1 || maxTotalCalls > 512) throw new TypeError('maxTotalCalls must be 1-512');
  mkdirSync(workspaceRoot, { recursive: true });
  const stats = { calls: 0, ok: 0, failed: 0, network_requests: 0, cache_hits: 0, peak_web_concurrency: 0, serialized_origin_waits: 0 };
  const cache = new Map();
  const originLimiters = new Map();
  const originPeaks = new Map();
  const withWebSlot = createLimiter(webConcurrency, { onActive: active => { stats.peak_web_concurrency = Math.max(stats.peak_web_concurrency, active); } });

  function withOriginSlot(rawUrl, operation) {
    const origin = new URL(rawUrl).origin;
    if (!originLimiters.has(origin)) {
      originLimiters.set(origin, createLimiter(1, {
        onActive: active => originPeaks.set(origin, Math.max(originPeaks.get(origin) ?? 0, active)),
        onQueued: () => { stats.serialized_origin_waits += 1; },
      }));
    }
    return originLimiters.get(origin)(operation);
  }

  async function cachedNetwork(key, rawUrl, operation) {
    let promise = cache.get(key);
    const cacheHit = Boolean(promise);
    if (!promise) {
      stats.network_requests += 1;
      promise = withOriginSlot(rawUrl, () => withWebSlot(operation));
      cache.set(key, promise);
      promise.catch(() => cache.delete(key));
    } else stats.cache_hits += 1;
    return { value: await promise, cacheHit };
  }

  const executeTool = async function executeTool(request, agentId) {
    const name = String(request?.name ?? '');
    const args = request?.arguments && typeof request.arguments === 'object' ? request.arguments : {};
    const audit = { tool: name, agent_id: agentId, arguments_sha256: sha256(JSON.stringify(args)), ok: false };
    stats.calls += 1;
    try {
      if (stats.calls > maxTotalCalls) throw new TypeError(`room tool-call budget exceeded (${maxTotalCalls})`);
      let result;
      let cacheHit = false;
      if (name === 'web_search') {
        if (!capabilities.web) throw new TypeError('web capability is disabled');
        const query = String(args.query ?? '').trim().slice(0, 300);
        if (!query) throw new TypeError('web_search requires query');
        const key = `web_search:${query.toLocaleLowerCase('en-US')}`;
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const cached = await cachedNetwork(key, searchUrl, async () => {
          const page = await fetchPublicText(searchUrl, { fetchImpl, lookupImpl, maxChars: Math.min(MAX_FILE_CHARS, webResultChars * 4), rawHtml: true });
          const sources = parseDuckDuckGo(page.text, maxSearchResults);
          if (!sources.length) {
            const pageText = stripHtml(page.text);
            if (/(?:human verification|captcha|challenge|verify you are human|bot detection|anomaly)/iu.test(pageText)) {
              throw new TypeError('web_search_challenge_detected');
            }
            throw new TypeError('web_search_no_results');
          }
          const text = sources.map((row, index) => `${index + 1}. ${row.title}\n${row.url}\n${row.snippet}`).join('\n\n').slice(0, webResultChars);
          return { query, source_id: `web-search:${sha256(query).slice(0, 16)}`, text, sources, truncated: page.truncated || text.length >= webResultChars };
        });
        result = cached.value; cacheHit = cached.cacheHit;
      } else if (name === 'web_fetch') {
        if (!capabilities.web) throw new TypeError('web capability is disabled');
        const requestedUrl = String(args.url ?? '').trim();
        const parsedUrl = new URL(requestedUrl);
        if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) throw new TypeError('network tools require public HTTPS without URL credentials');
        const canonicalUrl = parsedUrl.href;
        const cached = await cachedNetwork(`web_fetch:${canonicalUrl}`, canonicalUrl, async () => {
          const page = await fetchPublicText(canonicalUrl, { fetchImpl, lookupImpl, maxChars: webResultChars });
          return { source_id: `web:${page.url}`, url: page.url, text: page.text, truncated: page.truncated };
        });
        result = cached.value; cacheHit = cached.cacheHit;
      } else if (name === 'read_file') {
        if (!capabilities.files) throw new TypeError('file capability is disabled');
        const path = resolveReadPath(cwd, workspaceRoot, args.path);
        result = { source_id: relative(cwd, path).replaceAll('\\', '/'), path: relative(cwd, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8').slice(0, MAX_FILE_CHARS) };
      } else if (name === 'write_file' || name === 'create_file') {
        if (!capabilities.files) throw new TypeError('file capability is disabled');
        const path = resolveWritePath(workspaceRoot, args.path);
        const content = String(args.content ?? '').slice(0, MAX_FILE_CHARS);
        if (!content) throw new TypeError(`${name} requires content`);
        if (name === 'create_file' && existsSync(path)) throw new TypeError('create_file target already exists');
        mkdirSync(dirname(path), { recursive: true });
        if (existsSync(path)) renameSync(path, `${path}.bak-${Date.now()}`);
        writeFileSync(path, content, 'utf8');
        result = { source_id: relative(workspaceRoot, path).replaceAll('\\', '/'), path: relative(workspaceRoot, path).replaceAll('\\', '/'), chars: content.length, sha256: sha256(content) };
      } else if (name === 'agent_tools') {
        if (!capabilities.agent_tools) throw new TypeError('agent_tools capability is disabled');
        const kit = kitRequestFromObject(args);
        if (!kit.command) throw new TypeError('agent_tools requires command');
        const executed = await runKitCommand({ ...kit, root: cwd, allowWrites: false, allowOcr: capabilities.ocr === true });
        const encoded = JSON.stringify(executed.payload);
        const truncated = encoded.length > MAX_FILE_CHARS;
        result = {
          source_id: `agent-tools:${kit.command}`,
          command: kit.command,
          text: encoded.slice(0, MAX_FILE_CHARS),
          truncated,
          exit_code: executed.exitCode,
          ...(truncated ? {} : { payload: executed.payload }),
        };
      } else if (name === 'search_files' || name === 'search_content' || name === 'lookup') {
        if (!capabilities.agent_tools) throw new TypeError('agent_tools capability is disabled');
        const command = name === 'search_files' ? 'find' : name === 'search_content' ? 'search-content' : 'lookup';
        const kit = kitRequestFromObject({
          command,
          query: args.query ?? args.q,
          path: args.path,
          ext: args.ext,
          max: args.max ?? 40,
          context: args.context ?? 2,
          name: args.name,
          regex: args.regex === true,
          case: args.case === true,
          glob: args.glob === true,
          'related-max': args['related-max'] ?? args.related_max ?? args.max ?? 16,
          ignore: args.ignore,
        });
        const executed = await runKitCommand({ ...kit, root: cwd, allowWrites: false, allowOcr: capabilities.ocr === true });
        const textLines = command === 'find'
          ? [...executed.payload.files, `# shown=${executed.payload.files.length} total=${executed.payload.total}`]
          : command === 'lookup'
            ? formatLookup(executed.payload)
            : formatSearchHits(executed.payload);
        const text = textLines.join('\n').slice(0, MAX_FILE_CHARS);
        result = {
          source_id: `agent-tools:${command}`,
          command,
          text,
          truncated: textLines.join('\n').length > MAX_FILE_CHARS,
          exit_code: executed.exitCode,
          payload: executed.payload,
        };
      } else throw new TypeError(`unsupported tool: ${name}`);
      stats.ok += 1;
      audit.ok = true; audit.cache_hit = cacheHit; audit.result_sha256 = sha256(JSON.stringify(result)); await onAudit(audit);
      return { ok: true, cache_hit: cacheHit, ...result };
    } catch (error) {
      stats.failed += 1;
      audit.error = String(error.message ?? error).slice(0, 300); await onAudit(audit);
      return { ok: false, error: audit.error };
    }
  };
  executeTool.getStats = () => Object.freeze({
    ...stats,
    cache_entries: cache.size,
    max_total_calls: maxTotalCalls,
    web_concurrency: webConcurrency,
    per_origin_concurrency: 1,
    origin_count: originLimiters.size,
    peak_origin_concurrency: Object.fromEntries([...originPeaks].sort(([left], [right]) => left.localeCompare(right))),
  });
  return executeTool;
}
