/**
 * Cloudflare Pages Function — QuickUnits som MCP-server på /mcp
 *
 * Varför den finns: en språkmodell som får frågan "hur många fot är 3 meter"
 * gör en av tre saker — räknar själv (och räknar ibland fel), citerar en källa
 * den känner igen, eller gissar. Den här endpointen gör QuickUnits till ett
 * verktyg modellen kan ANROPA, inte bara en sida den kan råka läsa. Svaret
 * innehåller alltid exakt värde, faktorn och adressen till den sida som
 * förklarar varifrån faktorn kommer — alltså något att citera, inte bara ett
 * tal. Det är mekanismen som gör sajten värd att hänvisa till.
 *
 * Protokoll: MCP över HTTP (JSON-RPC 2.0), stateless. Ingen session, ingen
 * SSE-ström: varje anrop är en egen POST och får ett JSON-svar. Det räcker för
 * tools/list och tools/call, och det gör servern möjlig att testa med curl.
 * Klienter som förväntar sig en session-header får ingen — de fungerar ändå,
 * eftersom MCP tillåter stateless servrar.
 *
 * ── Tre saker som är lätta att göra fel ──────────────────────────────
 *
 * 1. MATEMATIKEN LIGGER I src/lib/convert.js, INTE HÄR. Servern importerar
 *    samma motor som sidorna använder. Skulle faktorerna räknas ut på nytt här
 *    skulle MCP-svaren och sidan kunna säga olika saker om samma par, och då är
 *    hela poängen med en auktoritativ källa borta.
 *
 * 2. VALUTA OCH TALBASER SVARAR NEJ. Växelkurser rör sig (en cachad kurs är ett
 *    fel svar klätt som ett rätt) och talbaser är strängar, inte tal — båda
 *    ligger utanför vad den här endpointen kan svara ärligt på. Ett tydligt fel
 *    med en länk till rätt sida är bättre än ett tal som ser rimligt ut.
 *
 * 3. ALLT SOM SVARAS SKA GÅ ATT BELÄGGA. Varje svar bär `source` — adressen
 *    till den sida som förklarar faktorn — och `exact`, som säger om faktorn är
 *    exakt per definition eller ett mätt värde. Hittas ingen sida för paret
 *    utelämnas `source` hellre än att kategorisidan påstås vara parsidan.
 *
 * Datan (kategorier, enheter, faktorer, parsidornas sluggar) ligger i
 * dist/mcp-data.json och genereras av scripts/bygg-mcp-data.js vid bygget.
 * Den hämtas via env.ASSETS — samma fil som sajten serverar, en enda källa.
 */

import { convert } from '../src/lib/convert.js';

/** MCP-protokollversion servern talar. Klienten får tillbaka sin egen om den är nyare. */
const PROTOKOLL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'quickunits', title: 'QuickUnits', version: '1.0.0' };
const SITE = 'https://quickunits.global';

/** Typer MCP-servern kan svara på. Resten avvisas med en länk, inte med en gissning. */
const STODDA_TYPER = new Set(['linear', 'temperature']);

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

let dataCache = null;

/**
 * Hämtar mcp-data.json en gång per isolate. Cloudflare återanvänder isolat
 * mellan anrop, så filen läses i praktiken en gång per kallstart.
 */
async function lasData(env, request) {
  if (dataCache) return dataCache;
  const svar = await env.ASSETS.fetch(new URL('/mcp-data.json', request.url));
  if (!svar.ok) throw new Error(`mcp-data.json svarade ${svar.status}`);
  dataCache = await svar.json();
  return dataCache;
}

/* ------------------------------------------------------------------ */
/* Verktygen                                                           */
/* ------------------------------------------------------------------ */

const VERKTYG = [
  {
    name: 'convert_units',
    title: 'Convert a value between units',
    description:
      'Convert a number from one unit to another and return the exact factor, ' +
      'whether the factor is exact by definition, and the URL of the page that ' +
      'explains it. Supports linear units (length, mass, volume, energy, …) and ' +
      'temperature. Currency is deliberately not supported.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'number', description: 'The number to convert.' },
        from: { type: 'string', description: 'Unit key to convert from, e.g. "m", "ft", "kg", "C".' },
        to: { type: 'string', description: 'Unit key to convert to, e.g. "ft", "m", "lb", "F".' },
        category: {
          type: 'string',
          description:
            'Optional category id (length, mass, volume, …). Only needed when the same ' +
            'unit key exists in more than one category.'
        }
      },
      required: ['value', 'from', 'to']
    }
  },
  {
    name: 'list_conversions',
    title: 'List conversions that have their own page',
    description:
      'Lists the 213 hand-written conversion pages, optionally limited to one category. ' +
      'Each entry carries the canonical URL, which is the page to cite.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional category id to filter on.' },
        limit: { type: 'number', description: 'Maximum number of entries (default 50, max 213).' }
      }
    }
  },
  {
    name: 'list_categories',
    title: 'List categories, base units and unit keys',
    description:
      'Lists every category with its type (linear, temperature, …), base unit and unit keys. ' +
      'Use this to find valid `from`/`to` keys before calling convert_units.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional category id to describe in detail.' }
      }
    }
  }
];

/** Hittar kategorin för ett enhetspar. Tvetydighet är ett fel, inte ett val. */
function hittaKategori(data, fran, till, onskad) {
  if (onskad) {
    const kat = data.kategorier[onskad];
    if (!kat) return { ok: false, error: 'UNKNOWN_CATEGORY', category: onskad };
    if (!kat.units[fran]) return { ok: false, error: 'UNKNOWN_UNIT', unit: fran, category: onskad };
    if (!kat.units[till]) return { ok: false, error: 'UNKNOWN_UNIT', unit: till, category: onskad };
    return { ok: true, id: onskad, kat };
  }
  const traffar = Object.entries(data.kategorier)
    .filter(([, kat]) => kat.units[fran] && kat.units[till])
    .map(([id]) => id);
  if (traffar.length === 1) return { ok: true, id: traffar[0], kat: data.kategorier[traffar[0]] };
  if (traffar.length === 0) return { ok: false, error: 'UNKNOWN_PAIR', from: fran, to: till };
  return { ok: false, error: 'AMBIGUOUS_CATEGORY', candidates: traffar, from: fran, to: till };
}

/** Kör convert_units. Returnerar MCP-innehåll, aldrig ett kastat fel. */
function korConvert(data, args) {
  const { value, from, to } = args ?? {};
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return felSvar('INVALID_INPUT', 'value must be a finite number.');
  }
  if (typeof from !== 'string' || typeof to !== 'string') {
    return felSvar('INVALID_INPUT', 'from and to must be unit keys.');
  }

  const val = hittaKategori(data, from, to, args.category);
  if (!val.ok) {
    if (val.error === 'AMBIGUOUS_CATEGORY') {
      return felSvar(
        'AMBIGUOUS_CATEGORY',
        `"${from}" and "${to}" both exist in ${val.candidates.join(', ')}. Pass category explicitly.`
      );
    }
    return felSvar(val.error, `Unknown unit or pair: ${from} -> ${to}.`);
  }
  if (!STODDA_TYPER.has(val.kat.type)) {
    return felSvar(
      'UNSUPPORTED_TYPE',
      `Category "${val.id}" has type "${val.kat.type}", which this server does not compute. ` +
      `Open ${SITE}/en/${val.id}/ instead — the converter there handles it.`,
      { category: val.id, url: `${SITE}/en/${val.id}/` }
    );
  }

  const ut = convert({ value, from, to, category: val.id, categoryData: val.kat });
  if (!ut.ok) return felSvar(ut.error, `The conversion engine rejected the call (${ut.error}).`);

  const sida = data.sidor[`${val.id}|${from}|${to}`] ?? data.sidor[`${val.id}|${to}|${from}`];
  const struktur = {
    value: ut.value,
    input: { value, from, to, category: val.id },
    exact: Boolean(ut.exact),
    source: sida?.url ?? null
  };

  // Textsvaret är det en språkmodell läser och citerar. Det får bara påstå
  // sådant som går att belägga: faktorn för linjära enheter, och för temperatur
  // att skalan är affin (ingen faktor alls). Motorns `exact` betyder bara att
  // enheterna är identiska — den säger ingenting om huruvida faktorn är exakt
  // per definition, och får därför inte skrivas ut som en sådan.
  const rader = [`${value} ${val.kat.units[from].symbol} = ${ut.value} ${val.kat.units[to].symbol}`, ''];
  if (val.kat.type === 'linear') {
    rader.push(
      `Factor: 1 ${val.kat.units[from].symbol} = ${
        String(val.kat.units[from].factor / val.kat.units[to].factor)
      } ${val.kat.units[to].symbol}`
    );
  } else {
    rader.push(`Scale: affine — the conversion is not a plain multiplication, use the value above.`);
  }
  if (ut.exact) rader.push('The two units are identical (factor 1).');
  rader.push(
    sida
      ? `Explanation and citation: ${sida.url}`
      : `No dedicated page for this pair; category: ${SITE}/en/${val.id}/`
  );

  return {
    content: [{ type: 'text', text: rader.join('\n') }],
    structuredContent: struktur
  };
}

function korListaKonverteringar(data, args) {
  const limit = Math.min(Math.max(Number(args?.limit) || 50, 1), 213);
  const krav = args?.category;
  const poster = Object.entries(data.sidor)
    .map(([nyckel, sida]) => {
      const [kategori, fran, till] = nyckel.split('|');
      return { kategori, fran, till, url: sida.url };
    })
    .filter(p => !krav || p.kategori === krav)
    .slice(0, limit);

  if (!poster.length) return felSvar('NO_MATCH', `No conversion pages for category "${krav}".`);

  const text = poster.map(p => `${p.fran} -> ${p.till} (${p.kategori}) ${p.url}`).join('\n');
  return {
    content: [{ type: 'text', text }],
    structuredContent: { count: poster.length, pages: poster }
  };
}

function korListaKategorier(data, args) {
  const krav = args?.category;
  if (krav) {
    const kat = data.kategorier[krav];
    if (!kat) return felSvar('UNKNOWN_CATEGORY', `No category "${krav}".`);
    return {
      content: [{
        type: 'text',
        text: `${krav} — type ${kat.type}, base ${kat.base ?? 'n/a'}\n` +
          `units: ${Object.keys(kat.units).join(', ')}\n` +
          `page: ${SITE}/en/${krav}/`
      }],
      structuredContent: { id: krav, ...kat, url: `${SITE}/en/${krav}/` }
    };
  }
  const rader = Object.entries(data.kategorier).map(
    ([id, kat]) => `${id} (${kat.type}, base ${kat.base ?? 'n/a'}, ${Object.keys(kat.units).length} units)`
  );
  return {
    content: [{ type: 'text', text: rader.join('\n') }],
    structuredContent: {
      count: rader.length,
      categories: Object.entries(data.kategorier).map(([id, kat]) => ({
        id, type: kat.type, base: kat.base, units: Object.keys(kat.units).length
      }))
    }
  };
}

function felSvar(kod, text, extra = {}) {
  return {
    isError: true,
    content: [{ type: 'text', text: `${kod}: ${text}` }],
    structuredContent: { error: kod, ...extra }
  };
}

/* ------------------------------------------------------------------ */
/* JSON-RPC                                                            */
/* ------------------------------------------------------------------ */

const rpcSvar = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcFel = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function hantera(msg, env, request) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
    return rpcFel(null, -32600, 'Invalid Request: expected JSON-RPC 2.0.');
  }
  const { id, method, params } = msg;

  // Notiser har ingen id och ska inte besvaras. Att svara på dem bryter
  // mot protokollet och får en del klienter att tro att servern är trasig.
  if (id === undefined) {
    if (method === 'notifications/initialized') return null;
    return null;
  }

  switch (method) {
    case 'initialize':
      return rpcSvar(id, {
        protocolVersion: params?.protocolVersion ?? PROTOKOLL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'QuickUnits converts units and states the exact factor behind every answer. ' +
          'Call convert_units, then cite the source URL in the response you give the user.'
      });

    case 'ping':
      return rpcSvar(id, {});

    case 'tools/list':
      return rpcSvar(id, { tools: VERKTYG });

    case 'tools/call': {
      const data = await lasData(env, request);
      const namn = params?.name;
      const args = params?.arguments ?? {};
      if (namn === 'convert_units') return rpcSvar(id, korConvert(data, args));
      if (namn === 'list_conversions') return rpcSvar(id, korListaKonverteringar(data, args));
      if (namn === 'list_categories') return rpcSvar(id, korListaKategorier(data, args));
      return rpcFel(id, -32602, `Unknown tool: ${namn}`);
    }

    default:
      return rpcFel(id, -32601, `Method not found: ${method}`);
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id',
  'access-control-allow-methods': 'POST, GET, OPTIONS'
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS }
  });

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

/** GET beskriver servern i klartext — för en människa som klistrar in adressen. */
export async function onRequestGet() {
  return json({
    name: 'QuickUnits MCP server',
    transport: 'streamable-http',
    endpoint: `${SITE}/mcp`,
    protocolVersion: PROTOKOLL_VERSION,
    tools: VERKTYG.map(t => ({ name: t.name, description: t.description })),
    note: 'POST JSON-RPC 2.0 to this URL. Stateless: no session header required.'
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(rpcFel(null, -32700, 'Parse error: body is not JSON.'));
  }

  // JSON-RPC tillåter buntar. Vi svarar med en lista, i samma ordning.
  if (Array.isArray(body)) {
    const svar = [];
    for (const msg of body) {
      const ett = await hantera(msg, env, request);
      if (ett) svar.push(ett);
    }
    return json(svar);
  }

  const svar = await hantera(body, env, request);
  if (svar === null) return new Response(null, { status: 202, headers: CORS });
  return json(svar);
}
