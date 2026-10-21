/**
 * Klient mot QuickUnits MCP-server på https://quickunits.global/mcp.
 *
 * Varför ett paket som anropar servern i stället för att räkna själv: om
 * faktorerna låg i paketet skulle de sluta stämma den dag sajten rättar en
 * faktor, och då skulle npm-paketet ge ett trovärdigt men gammalt svar. Nu
 * finns faktorerna på ett ställe, och det stället är det som sidorna byggs ur.
 *
 * Servern är stateless streamable-http. Den svarar antingen med JSON eller med
 * ett SSE-block beroende på vilken Accept-header den får — båda hanteras här,
 * eftersom en klient som bara klarar det ena faller tyst.
 */

const SLUTPUNKT = 'https://quickunits.global/mcp';
const PROTOKOLL = '2025-06-18';

/** Plocka ut JSON-RPC-svaret ur antingen ren JSON eller ett SSE-block. */
function tolkaSvar(text) {
  const trimmad = text.trim();
  if (!trimmad) return null;
  if (trimmad.startsWith('{') || trimmad.startsWith('[')) return JSON.parse(trimmad);
  // SSE: rader som "data: {...}", avslutade med tom rad
  for (const rad of trimmad.split(/\r?\n/)) {
    const m = rad.match(/^data:\s*(.+)$/);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {
        // flera data-rader hör ihop; samla ihop nedan
      }
    }
  }
  const samlade = trimmad
    .split(/\r?\n/)
    .filter(r => r.startsWith('data:'))
    .map(r => r.replace(/^data:\s*/, ''))
    .join('');
  return samlade ? JSON.parse(samlade) : null;
}

/**
 * Skicka ett JSON-RPC-meddelande till servern.
 * `signal` låter anroparen avbryta (CLI:n sätter timeout).
 */
async function skicka(meddelande, { signal, id = 1 } = {}) {
  const kropp = { jsonrpc: '2.0', id, ...meddelande };
  const svar = await fetch(SLUTPUNKT, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOKOLL
    },
    body: JSON.stringify(kropp)
  });
  const text = await svar.text();
  if (!svar.ok) {
    throw new Error(`HTTP ${svar.status} från ${SLUTPUNKT}: ${text.slice(0, 200)}`);
  }
  const data = tolkaSvar(text);
  if (!data) throw new Error('Tomt svar från servern');
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result;
}

/** initiera → tools/call. Servern är stateless, så handskakningen är en formalitet. */
async function anropaVerktyg(namn, args, opts = {}) {
  await skicka(
    {
      method: 'initialize',
      params: {
        protocolVersion: PROTOKOLL,
        capabilities: {},
        clientInfo: { name: 'quickunits-cli', version: '1.1.0' }
      }
    },
    opts
  );
  return skicka({ method: 'tools/call', params: { name: namn, arguments: args } }, opts);
}

/** Textinnehållet ur ett tools/call-svar. */
function svarsText(resultat) {
  if (!resultat) return '';
  if (Array.isArray(resultat.content)) {
    return resultat.content
      .filter(d => d.type === 'text')
      .map(d => d.text)
      .join('\n');
  }
  return typeof resultat === 'string' ? resultat : JSON.stringify(resultat);
}

export { SLUTPUNKT, PROTOKOLL, skicka, anropaVerktyg, svarsText, tolkaSvar };
