#!/usr/bin/env node
/**
 * Stdio-brygga till QuickUnits MCP-server.
 *
 * Klienter som bara kan starta lokala processer (Claude Desktop, Cursor och
 * många andra) kan inte prata med en server som ligger på en URL. Den här
 * bryggan läser JSON-RPC på stdin och skickar vidare till
 * https://quickunits.global/mcp, så samma verktyg blir tillgängliga utan att
 * något installeras lokalt förutom det här paketet.
 *
 * Den är medvetet dum: den tolkar ingenting, den flyttar meddelanden. All
 * logik ligger på servern, vilket är hela poängen — annars kan bryggan och
 * servern svara olika på samma fråga.
 */
import { skicka } from '../lib/client.js';

let buffert = '';
let nästaId = 1;
let pågående = 0; // anrop som väntar på servern
let slut = false;

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffert += chunk;
  let nyrad;
  while ((nyrad = buffert.indexOf('\n')) !== -1) {
    const rad = buffert.slice(0, nyrad).trim();
    buffert = buffert.slice(nyrad + 1);
    if (rad) hantera(rad);
  }
});

async function hantera(rad) {
  let meddelande;
  try {
    meddelande = JSON.parse(rad);
  } catch {
    svara({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }

  // Notiser (t.ex. notifications/initialized) har inget id och ska inte
  // besvaras — att svara på dem bryter mot protokollet och får en del
  // klienter att sluta lyssna.
  if (meddelande.id === undefined) return;

  const id = meddelande.id ?? nästaId++;
  pågående++;
  try {
    const resultat = await skicka(meddelande, { id });
    svara({ jsonrpc: '2.0', id, result: resultat });
  } catch (fel) {
    svara({ jsonrpc: '2.0', id, error: { code: -32000, message: fel.message } });
  } finally {
    pågående--;
    if (slut && pågående === 0) process.exit(0);
  }
}

function svara(meddelande) {
  process.stdout.write(JSON.stringify(meddelande) + '\n');
}

process.stdin.on('end', () => {
  // Stäng inte förrän servern svarat — annars tappas svaret på sista frågan,
  // vilket ser ut som att verktyget är trasigt.
  slut = true;
  if (pågående === 0) process.exit(0);
});
