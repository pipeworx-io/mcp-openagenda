interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * OpenAgenda MCP.
 *
 * Events from the OpenAgenda network (openagenda.com) — thousands of public
 * "agendas" (calendars) published by cities, cultural venues, tourism boards
 * and organisations, mostly across France plus some international. Events live
 * inside individual agendas (there is no global cross-agenda search), so this
 * pack is two-step: `search_agendas` to discover an agenda, then `events` to
 * query its events. Requires a free key: the gateway fronts a platform key
 * (PLATFORM_OPENAGENDA_KEY) and callers may pass their own via `_apiKey`.
 */


const BASE = 'https://api.openagenda.com/v2';
const UA = 'pipeworx-mcp-openagenda/1.0 (+https://pipeworx.io)';
const LANGS = ['en', 'fr'];

const tools: McpToolExport['tools'] = [
  {
    name: 'search_agendas',
    description:
      'Find OpenAgenda agendas (event calendars) by keyword — e.g. a city, venue, festival or organisation name. Returns agenda uid + slug + title. Pass the uid to the events tool. Most agendas are French.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text, e.g. "Nantes", "festival jazz", "musée".' },
        official_only: { type: 'boolean', description: 'If true, only official (verified) agendas.' },
        size: { type: 'number', description: 'How many agendas to return (1-20, default 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'events',
    description:
      'List events from one OpenAgenda agenda (get its uid from search_agendas). Defaults to upcoming events. Optionally filter by keyword and date window. Returns title, dates, venue, coordinates and keywords (English where available, else French).',
    inputSchema: {
      type: 'object',
      properties: {
        agenda_uid: { type: 'string', description: 'Agenda uid from search_agendas, e.g. "6008621".' },
        query: { type: 'string', description: 'Keyword filter over the agenda’s events.' },
        from: { type: 'string', description: 'Earliest event date YYYY-MM-DD (default: today, upcoming only).' },
        to: { type: 'string', description: 'Latest event date YYYY-MM-DD.' },
        size: { type: 'number', description: 'Max events to return (1-50, default 20).' },
      },
      required: ['agenda_uid'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const key = keyOf(args);
  switch (name) {
    case 'search_agendas':
      return searchAgendas(key, args);
    case 'events':
      return getEvents(key, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function searchAgendas(key: string, args: Record<string, unknown>): Promise<unknown> {
  const query = String(args.query ?? '').trim();
  if (!query) throw new Error('Pass a `query` to search agendas.');
  const qs = new URLSearchParams({ key, search: query, size: String(clamp(numArg(args.size, 10), 1, 20)) });
  if (args.official_only === true) qs.set('official', '1');
  const data = (await oaGet(`/agendas?${qs.toString()}`)) as { total?: number; agendas?: OaAgenda[] };
  return {
    total_matching: data.total ?? 0,
    count: data.agendas?.length ?? 0,
    agendas: (data.agendas ?? []).map((a) => ({
      uid: a.uid,
      slug: a.slug,
      title: a.title,
      description: typeof a.description === 'string' ? a.description : loc(a.description),
      official: !!a.official,
      url: a.slug ? `https://openagenda.com/${a.slug}` : undefined,
    })),
  };
}

async function getEvents(key: string, args: Record<string, unknown>): Promise<unknown> {
  const uid = String(args.agenda_uid ?? '').trim();
  if (!/^\d+$/.test(uid)) throw new Error('Pass a numeric `agenda_uid` (from search_agendas).');
  const qs = new URLSearchParams({ key, size: String(clamp(numArg(args.size, 20), 1, 50)) });
  const from = dateArg(args.from);
  const to = dateArg(args.to);
  if (from) qs.set('timings[gte]', from);
  else qs.append('relative[]', 'upcoming');
  if (to) qs.set('timings[lte]', `${to}T23:59:59`);
  if (typeof args.query === 'string' && args.query.trim()) qs.set('search', args.query.trim());

  const data = (await oaGet(`/agendas/${uid}/events?${qs.toString()}`)) as { total?: number; events?: OaEvent[] };
  return {
    source: 'openagenda.com',
    agenda_uid: uid,
    total_matching: data.total ?? 0,
    count: data.events?.length ?? 0,
    events: (data.events ?? []).map(normalize),
  };
}

interface LangMap { [lang: string]: string | string[] }
interface OaAgenda { uid?: number; slug?: string; title?: string; description?: string | LangMap; official?: boolean }
interface OaTiming { begin?: string; end?: string }
interface OaLocation { name?: string; address?: string; city?: string; postalCode?: string; latitude?: number; longitude?: number; countryCode?: string }
interface OaEvent {
  uid?: number;
  slug?: string;
  title?: LangMap;
  description?: LangMap;
  dateRange?: LangMap;
  firstTiming?: OaTiming;
  nextTiming?: OaTiming;
  lastTiming?: OaTiming;
  location?: OaLocation;
  keywords?: LangMap;
  onlineAccessLink?: string | null;
  attendanceMode?: number;
  originAgenda?: { slug?: string };
}

function normalize(e: OaEvent): Record<string, unknown> {
  const t = e.nextTiming || e.firstTiming;
  const loc0 = e.location;
  const agSlug = e.originAgenda?.slug;
  return {
    id: e.uid,
    title: loc(e.title),
    when: loc(e.dateRange) || undefined,
    start: t?.begin || undefined,
    end: t?.end || undefined,
    summary: clean(loc(e.description))?.slice(0, 500) || undefined,
    venue: loc0
      ? {
          name: loc0.name,
          address: [loc0.address, loc0.postalCode, loc0.city].filter((p) => p && String(p).trim()).join(', ') || undefined,
          city: loc0.city,
          latitude: loc0.latitude,
          longitude: loc0.longitude,
        }
      : undefined,
    keywords: locArr(e.keywords),
    online_link: e.onlineAccessLink || undefined,
    url: agSlug && e.slug ? `https://openagenda.com/${agSlug}/events/${e.slug}` : undefined,
  };
}

/** Pick a localized string, preferring English then French then any. */
function loc(m?: string | LangMap): string {
  if (!m) return '';
  if (typeof m === 'string') return m;
  for (const l of LANGS) if (typeof m[l] === 'string') return m[l] as string;
  const v = Object.values(m).find((x) => typeof x === 'string');
  return (v as string) || '';
}
function locArr(m?: LangMap): string[] {
  if (!m) return [];
  for (const l of LANGS) if (Array.isArray(m[l])) return (m[l] as string[]).slice(0, 12);
  const v = Object.values(m).find((x) => Array.isArray(x));
  return Array.isArray(v) ? (v as string[]).slice(0, 12) : [];
}
function clean(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function oaGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || body.success === false) {
    const msg = (body.error as string) || (body.message as string) || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403 || /key/i.test(msg)) {
      throw new Error(`OpenAgenda: ${msg}. The platform key may be unset — pass your own free key via _apiKey (openagenda.com account).`);
    }
    throw new Error(`OpenAgenda: ${msg}`);
  }
  return body;
}

function keyOf(args: Record<string, unknown>): string {
  const k = args._apiKey;
  if (typeof k !== 'string' || !k.trim()) {
    throw new Error('OpenAgenda requires an API key. The gateway normally fronts a platform key; otherwise pass _apiKey (free key from an openagenda.com account).');
  }
  delete args._apiKey;
  return k.trim();
}
function dateArg(v: unknown): string {
  if (typeof v !== 'string') return '';
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
function numArg(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : dflt;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
