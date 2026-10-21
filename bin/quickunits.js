#!/usr/bin/env node
/**
 * quickunits — enhetsomvandling i terminalen.
 *
 *   quickunits 3 m to ft
 *   quickunits 100 C to F --lang=sv
 *   quickunits 5 km in miles --json
 *   quickunits --list length
 *
 * Svaret kommer från samma server som sidorna byggs ur, så faktorn är alltid
 * den som står på quickunits.global — inte en kopia som kan ha glidit isär.
 */
import { anropaVerktyg, svarsText } from '../lib/client.js';

const args = process.argv.slice(2);

function hjalp() {
  console.log(`quickunits — exact unit conversion

  quickunits <värde> <från> to <till>   t.ex. quickunits 3 m to ft
  quickunits <värde> <från> in <till>   samma sak
  quickunits --list [kategori]          alla par, eller paren i en kategori
  quickunits --categories               alla kategorier

Flaggor:
  --lang=sv      språk på etiketter och förklaring (24 språk, standard en)
  --json         rå JSON i stället för text
  --timeout=15   sekunder innan anropet avbryts
`);
}

function flagga(namn, standard) {
  const träff = args.find(a => a.startsWith(`--${namn}=`));
  return träff ? träff.split('=')[1] : standard;
}

async function main() {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    hjalp();
    process.exit(args.length ? 0 : 1);
  }

  const timeout = Number(flagga('timeout', '15')) * 1000;
  const signal = AbortSignal.timeout(Number.isFinite(timeout) ? timeout : 15000);
  const lang = flagga('lang', 'en');
  const json = args.includes('--json');

  try {
    if (args[0] === '--categories') {
      const r = await anropaVerktyg('list_categories', {}, { signal });
      console.log(json ? JSON.stringify(r.structuredContent ?? svarsText(r), null, 2) : svarsText(r));
      return;
    }

    if (args[0] === '--list') {
      const kat = args[1];
      const r = await anropaVerktyg('list_conversions', kat ? { category: kat } : {}, { signal });
      console.log(json ? JSON.stringify(r.structuredContent ?? svarsText(r), null, 2) : svarsText(r));
      return;
    }

    // Formen "<värde> <från> to|in <till>" — bindordet krävs, annars blir
    // "3 m ft" tvetydigt och ett gissat svar är värre än ett nekande.
    const utanFlaggor = args.filter(a => !a.startsWith('--'));
    if (utanFlaggor.length !== 4 || !/^(to|in|till|i)$/i.test(utanFlaggor[2])) {
      console.error('Förstod inte. Använd: quickunits 3 m to ft   (se --help)');
      process.exit(2);
    }

    const [varde, fran, , till] = utanFlaggor;
    const tal = Number(String(varde).replace(',', '.'));
    if (!Number.isFinite(tal)) {
      console.error(`"${varde}" är inget tal.`);
      process.exit(2);
    }

    const r = await anropaVerktyg('convert_units', { value: tal, from: fran, to: till, lang }, { signal });
    if (json) {
      console.log(JSON.stringify(r.structuredContent ?? { text: svarsText(r) }, null, 2));
    } else {
      console.log(svarsText(r));
    }
  } catch (fel) {
    if (fel.name === 'TimeoutError' || fel.name === 'AbortError') {
      console.error('Servern svarade inte i tid. Försök igen, eller öka --timeout.');
    } else {
      console.error('Fel: ' + fel.message);
    }
    process.exit(1);
  }
}

main();
