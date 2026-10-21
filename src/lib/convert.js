/**
 * QuickUnits konverteringsmotor v2 (referensimplementation)
 *
 * Designprincip: en kategori = EN fysikalisk storhet. Motorn vägrar
 * konvertera mellan enheter som inte hör till samma kategori, istället
 * för att tyst producera ett tal som ser rimligt ut.
 *
 * Returnerar alltid { ok: true, value, ... } eller { ok: false, error }.
 * Kastar aldrig undantag för användarfel.
 *
 * ── Så här hänger det ihop ────────────────────────────────────────────
 * `convert()` längst ned är enda ingången. Den tittar på
 * `categoryData.type` och skickar vidare till en av fem funktioner. Varje
 * typ har sin egen matematik och de går INTE att blanda:
 *
 *   linear       värde × faktor. Faktorerna är relativa till kategorins
 *                basenhet (den med factor 1), normalt SI-enheten.
 *   temperature  affin, inte linjär — skalorna har olika nollpunkt, så
 *                en ren multiplikation ger fel svar.
 *   numberBase   sträng in, sträng ut, BigInt internt. Aldrig parseFloat.
 *   fuel         två enhetsfamiljer som pekar åt motsatt håll.
 *   lookup       diskreta tabeller (skor, kläder). Ingen formel finns.
 *
 * ── Felsökning ────────────────────────────────────────────────────────
 * Får du ett tal som ser fel ut: felet ligger nästan alltid i faktorn i
 * src/data/units/categories.json, inte här. Den filen är genererad —
 * rätta i scripts/author-units.py och kör om skriptet.
 *
 * Får du { ok: false } där du väntade dig ett svar: läs `error`-fältet.
 * Varje returpunkt nedan sätter en egen kod, så koden pekar ut raden.
 * Möjliga koder: INVALID_INPUT, UNKNOWN_UNIT, UNKNOWN_CATEGORY, OVERFLOW,
 * BELOW_ABSOLUTE_ZERO, UNSUPPORTED_BASE, INVALID_DIGIT, VARIANT_REQUIRED,
 * UNKNOWN_SYSTEM, OUT_OF_RANGE, NO_MATCH, RATES_UNAVAILABLE, RATE_MISSING,
 * UNSUPPORTED_TYPE.
 */

// Sifferalfabetet för talbaser: index i strängen ÄR siffrans värde, så
// 'f' på plats 15 betyder 15. Räcker till bas 36.
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/* ------------------------------------------------------------------ */
/* Linjära enheter (factor-baserade)                                    */
/* ------------------------------------------------------------------ */

/**
 * Vanlig faktorkonvertering: värdet går via kategorins basenhet.
 *
 *   värde → basenhet:  värde × from.factor
 *   basenhet → mål:    ÷ to.factor
 *
 * Ordningen spelar roll. Multiplikationen görs före divisionen därför att
 * (v × a) / b behåller fler siffror än v × (a / b) när a och b är mycket
 * små — t.ex. Å (1e-10) till pm (1e-12).
 *
 * `exact: true` betyder bara att in- och utenheten har samma faktor, dvs.
 * att inget egentligen räknades om (m → m, dm³ → l). Det är INTE en
 * utsago om att faktorn saknar avrundningsfel i övriga fall.
 */
function convertLinear(value, fromKey, toKey, category) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  const from = category.units[fromKey];
  const to = category.units[toKey];
  // Okänd enhet är alltid ett anropsfel, aldrig ett användarfel: fälten i
  // gränssnittet fylls från samma datafil som slås upp här.
  if (!from) return { ok: false, error: 'UNKNOWN_UNIT', unit: fromKey };
  if (!to) return { ok: false, error: 'UNKNOWN_UNIT', unit: toKey };

  const result = (value * from.factor) / to.factor;
  // Kan slå i taket åt båda håll: ly → pm spränger uppåt, pm → ly nedåt.
  if (!Number.isFinite(result)) return { ok: false, error: 'OVERFLOW' };
  return { ok: true, value: result, exact: from.factor === to.factor };
}

/* ------------------------------------------------------------------ */
/* Temperatur (affin, inte linjär)                                      */
/* ------------------------------------------------------------------ */

/**
 * Temperatur går inte att multiplicera sig till: skalorna har olika
 * nollpunkt OCH olika gradstorlek. 20 °C är inte dubbelt så varmt som
 * 10 °C. Därför går allt via celsius i två steg — TO_C in, FROM_C ut.
 *
 * Skalorna, för den som undrar var konstanterna kommer ifrån:
 *   C   celsius       vatten fryser vid 0, kokar vid 100
 *   F   fahrenheit    fryser vid 32, kokar vid 212 → 180/100 = 9/5
 *   K   kelvin        samma gradstorlek som C, nollpunkt vid absoluta nollpunkten
 *   R   rankine       samma gradstorlek som F, nollpunkt vid absoluta nollpunkten
 *   Re  réaumur       fryser vid 0, kokar vid 80 → 4/5
 *   De  delisle       BAKLÄNGES: kokar vid 0, fryser vid 150. Därav minustecknet.
 *   N   newton        fryser vid 0, kokar vid 33
 *   Ro  rømer         fryser vid 7,5, kokar vid 60 → 52,5/100 = 21/40
 *
 * Delisle är den som brukar se ut som ett buggat värde. Den är korrekt:
 * skalan räknar nedåt.
 */
const TO_C = {
  C: v => v,
  F: v => (v - 32) * 5 / 9,
  K: v => v - 273.15,
  R: v => (v - 491.67) * 5 / 9,
  Re: v => v * 5 / 4,
  De: v => 100 - v * 2 / 3,
  N: v => v * 100 / 33,
  Ro: v => (v - 7.5) * 40 / 21
};
// Exakta inverserna av TO_C. Ändrar du en formel ovan MÅSTE du ändra dess
// motsvarighet här — annars blir C → X → C inte längre samma tal, och det
// är precis vad testerna i test/convert.test.js kontrollerar.
const FROM_C = {
  C: c => c,
  F: c => c * 9 / 5 + 32,
  K: c => c + 273.15,
  R: c => c * 9 / 5 + 491.67,
  Re: c => c * 4 / 5,
  De: c => (100 - c) * 3 / 2,
  N: c => c * 33 / 100,
  Ro: c => c * 21 / 40 + 7.5
};

function convertTemperature(value, fromKey, toKey) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  if (!TO_C[fromKey]) return { ok: false, error: 'UNKNOWN_UNIT', unit: fromKey };
  if (!FROM_C[toKey]) return { ok: false, error: 'UNKNOWN_UNIT', unit: toKey };

  const celsius = TO_C[fromKey](value);
  // Under absoluta nollpunkten finns ingen temperatur att räkna om. Marginalen
  // 1e-9 finns för att 0 K → celsius ger exakt -273.15 i teorin men kan bli
  // ett hår under i flyttal, och att avvisa 0 K vore uppenbart fel.
  if (celsius < -273.15 - 1e-9) {
    return { ok: false, error: 'BELOW_ABSOLUTE_ZERO' };
  }
  return { ok: true, value: FROM_C[toKey](celsius) };
}

/* ------------------------------------------------------------------ */
/* Talbaser (sträng in, sträng ut — aldrig parseFloat)                  */
/* ------------------------------------------------------------------ */

/**
 * Talbaskonvertering. Sträng in, sträng ut — talet blir ALDRIG ett
 * JavaScript-number någonstans i den här funktionen.
 *
 * Varför det är absolut: `parseFloat("1A")` returnerar tyst 1 istället för
 * att klaga, så en felskriven hexadecimal blev ett trovärdigt men fel
 * svar. Och tal över 2^53 tappar siffror i en vanlig number — ett
 * 64-bitars hexvärde hade avrundats. BigInt har ingen övre gräns.
 *
 * Varje tecken valideras mot basens alfabet innan något räknas, så
 * "1A" i bas 10 avvisas med INVALID_DIGIT och pekar ut tecknet.
 */
function convertNumberBase(raw, fromBase, toBase, category) {
  const bases = category.bases;
  if (!bases.includes(fromBase)) return { ok: false, error: 'UNSUPPORTED_BASE', base: fromBase };
  if (!bases.includes(toBase)) return { ok: false, error: 'UNSUPPORTED_BASE', base: toBase };

  // Gemener genomgående: DIGITS är gement, så 'FF' och 'ff' ska bli samma tal.
  let s = String(raw).trim().toLowerCase();
  if (s === '') return { ok: false, error: 'INVALID_INPUT' };

  // Tecknet lyfts av före validering — '-' finns inte i något alfabet.
  let negative = false;
  if (s[0] === '-') { negative = true; s = s.slice(1); }
  // Mellanslag och understreck är läsbarhetsgrupperare (1010_1010, "FF FF").
  s = s.replace(/[\s_]/g, '');
  if (s === '') return { ok: false, error: 'INVALID_INPUT' };

  // Basens alfabet är de N första tecknen i DIGITS: bas 2 → "01", bas 16
  // → "0123456789abcdef". Därför avvisas '2' i binärt och 'g' i hex.
  const alphabet = DIGITS.slice(0, fromBase);
  for (const ch of s) {
    if (!alphabet.includes(ch)) {
      return { ok: false, error: 'INVALID_DIGIT', digit: ch, base: fromBase };
    }
  }

  // Horners metod med BigInt: acc = acc × bas + siffra, tecken för tecken.
  // indexOf i alfabetet ger siffrans värde ('f' → 15).
  let acc = 0n;
  const b = BigInt(fromBase);
  for (const ch of s) acc = acc * b + BigInt(alphabet.indexOf(ch));

  // BigInt.toString(bas) gör återvägen. Versaler för att hex traditionellt
  // skrivs så och är lättare att läsa av mot en skärm.
  let out = acc.toString(toBase).toUpperCase();
  // Villkoret acc !== 0n finns för att "-0" inte ska kunna uppstå: både
  // "-0" och "0" ska ge "0".
  if (negative && acc !== 0n) out = '-' + out;
  // type: 'string' talar om för gränssnittet att värdet inte får
  // sifferformateras med Intl.NumberFormat — "FF" är inte ett tal.
  return { ok: true, value: out, type: 'string' };
}

/* ------------------------------------------------------------------ */
/* Diskreta storlekar (kläder, skor) — tabelluppslag                    */
/* ------------------------------------------------------------------ */

/**
 * Sko- och klädstorlekar. Det finns ingen formel här — bara tabeller.
 *
 * En EU 42 motsvarar inte en exakt UK-storlek; sambandet är historiskt
 * och skiljer sig mellan tillverkare. Därför slår vi upp i en tabell och
 * märker svaret med `approximate: true` när vi inte hittade en exakt rad.
 * Gränssnittet MÅSTE visa den notisen — se `ui.approximate`.
 *
 * `variant` är "women"/"men" och är obligatorisk: samma sifferstorlek
 * betyder olika saker i dam- och herrtabellen.
 */
function convertLookup(value, fromSystem, toSystem, category, variant) {
  const table = category.variants[variant];
  // Ingen gissning på standardvariant. Väljer motorn "women" åt en man
  // blir svaret fel med ett par storlekar utan att någon märker det.
  if (!table) return { ok: false, error: 'VARIANT_REQUIRED', options: Object.keys(category.variants) };
  if (!category.systems.includes(fromSystem)) return { ok: false, error: 'UNKNOWN_SYSTEM', system: fromSystem };
  if (!category.systems.includes(toSystem)) return { ok: false, error: 'UNKNOWN_SYSTEM', system: toSystem };

  // Storlekar är ibland text ("M", "XL"), ibland tal (42). Versaler så att
  // "m" och "M" träffar samma rad.
  const needle = typeof value === 'string' ? value.trim().toUpperCase() : value;

  // Exakt träff först — bara den får svara utan approximate-flaggan.
  const exact = table.find(row => {
    const cell = row[fromSystem];
    return typeof cell === 'string'
      ? cell.toUpperCase() === String(needle).toUpperCase()
      : cell === Number(needle);
  });
  if (exact) {
    return { ok: true, value: exact[toSystem], approximate: false, row: exact };
  }

  // Ingen exakt rad. Är skalan helt numerisk (t.ex. EU-skostorlekar med
  // halvsteg) kan vi svara med närmaste rad — men bara märkt som
  // approximation. Är skalan textbaserad (S/M/L) finns inget "nära", och
  // då är NO_MATCH nedan rätt svar.
  const numeric = Number(needle);
  if (Number.isFinite(numeric) && table.every(r => typeof r[fromSystem] === 'number')) {
    const min = Math.min(...table.map(r => r[fromSystem]));
    const max = Math.max(...table.map(r => r[fromSystem]));
    // Utanför tabellen extrapolerar vi INTE. En EU 65 finns inte, och att
    // svara med tabellens sista rad hade sett ut som ett riktigt svar.
    if (numeric < min || numeric > max) {
      return { ok: false, error: 'OUT_OF_RANGE', min, max };
    }
    // Närmaste rad mätt i absolut avstånd. Vid exakt lika avstånd vinner
    // den tidigare raden, eftersom reduce bara byter på strikt mindre.
    const nearest = table.reduce((best, r) =>
      Math.abs(r[fromSystem] - numeric) < Math.abs(best[fromSystem] - numeric) ? r : best
    );
    return { ok: true, value: nearest[toSystem], approximate: true, row: nearest };
  }

  // Textstorlek som inte fanns i tabellen, t.ex. "XXXL" i en tabell som
  // slutar på "XXL".
  return { ok: false, error: 'NO_MATCH' };
}

/* ------------------------------------------------------------------ */
/* Bränsleförbrukning (omvänt förhållande mellan de två familjerna)     */
/* ------------------------------------------------------------------ */

/**
 * l/100 km och mpg pekar i motsatta riktningar: högre l/100 km är sämre,
 * högre mpg är bättre. En rak faktormultiplikation ger därför fel svar
 * i tre av fyra riktningar. Basen är l/100 km.
 *
 * Varje enhet är märkt med `kind` i datan:
 *   kind: 'consumption'  förbrukning — mer är sämre (l/100 km, l/mil)
 *   kind: 'efficiency'   verkningsgrad — mer är bättre (mpg, km/l)
 *
 * Omvandlingen mellan familjerna är en division, inte en multiplikation:
 * l/100km = faktor / mpg. Det är därför funktionen inte kan slås ihop med
 * convertLinear, hur lika de än ser ut.
 *
 * Snabbkontroll om du misstänker fel: 10 l/100 km ska bli ungefär
 * 23,5 mpg (US). Får du ~0,04 har en division blivit en multiplikation.
 */
function convertFuel(value, fromKey, toKey, category) {
  // Noll avvisas därför att båda riktningarna dividerar med värdet någon
  // gång: 0 mpg vore oändlig förbrukning, 0 l/100 km oändlig räckvidd.
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  const from = category.units[fromKey];
  const to = category.units[toKey];
  if (!from) return { ok: false, error: 'UNKNOWN_UNIT', unit: fromKey };
  if (!to) return { ok: false, error: 'UNKNOWN_UNIT', unit: toKey };

  // Steg 1: till l/100 km
  const base = from.kind === 'efficiency' ? from.factor / value : value * from.factor;
  if (!Number.isFinite(base) || base <= 0) return { ok: false, error: 'OVERFLOW' };

  // Steg 2: från l/100 km till målenheten
  const result = to.kind === 'efficiency' ? to.factor / base : base / to.factor;
  if (!Number.isFinite(result)) return { ok: false, error: 'OVERFLOW' };
  return { ok: true, value: result };
}

/* ------------------------------------------------------------------ */
/* Valuta (kurser hämtas vid körning, finns inte i datan)               */
/* ------------------------------------------------------------------ */

/**
 * Växlar mellan två valutor med kurser som hämtats från /api/rates.
 *
 * Till skillnad från alla andra kategorier finns faktorerna INTE i
 * categories.json. En växelkurs är färskvara; en inbyggd kurs hade varit
 * fel redan vid bygget. Kurserna skickas därför in som `rates`, ett
 * uppslagsobjekt { USD: 1.1485, SEK: 10.9855, … } med euro som bas.
 *
 * Utan kurser svarar funktionen RATES_UNAVAILABLE. Den gissar aldrig,
 * använder aldrig en inbyggd reservkurs och avrundar aldrig till något
 * "ungefär rätt". En växelkurs som ser rimlig ut men är fel är värre än
 * inget svar alls — någon kan fatta ett beslut på den.
 *
 * ── Räkningen ─────────────────────────────────────────────────────────
 * Alla kurser är kvoterade per euro: rate[X] = antal X för en euro.
 * Vägen mellan två godtyckliga valutor går därför via euro:
 *
 *     belopp i EUR   = värde / rate[från]
 *     belopp i målet = belopp i EUR × rate[till]
 *
 * vilket kortas till värde × (rate[till] / rate[från]).
 *
 * Divisionen görs sist av precisionsskäl, på samma sätt som i
 * convertLinear: kurserna spänner från 0,85 (GBP) till 20 733 (IDR).
 */
function convertCurrency(value, fromKey, toKey, rates) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  // Inga kurser inlästa ännu, eller kurskällan svarade inte.
  if (!rates || typeof rates !== 'object') {
    return { ok: false, error: 'RATES_UNAVAILABLE' };
  }

  const from = rates[fromKey];
  const to = rates[toKey];
  // En valuta som finns i datan men saknas i kurssvaret. Kan hända om ECB
  // slutar publicera den. Hellre ett tydligt fel än en uppfunnen kurs.
  if (typeof from !== 'number' || !Number.isFinite(from) || from <= 0) {
    return { ok: false, error: 'RATE_MISSING', unit: fromKey };
  }
  if (typeof to !== 'number' || !Number.isFinite(to) || to <= 0) {
    return { ok: false, error: 'RATE_MISSING', unit: toKey };
  }

  const result = (value * to) / from;
  if (!Number.isFinite(result)) return { ok: false, error: 'OVERFLOW' };

  // approximate: true därför att en referenskurs aldrig är den kurs någon
  // faktiskt får hos sin bank. Gränssnittet visar ≈ och kursens datum.
  return { ok: true, value: result, approximate: true };
}

/* ------------------------------------------------------------------ */
/* Publikt API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Enda ingången till motorn. Väljer räknesätt utifrån kategorins typ.
 *
 * @param {object}        args
 * @param {number|string} args.value        talet som ska konverteras. Sträng
 *                                          för numberBase och lookup, annars tal.
 * @param {string|number} args.from         enhetsnyckel att räkna från
 * @param {string|number} args.to           enhetsnyckel att räkna till
 * @param {string}        args.category     kategorinamn, används bara i felmeddelanden
 * @param {object}        args.categoryData posten ur categories.json
 * @param {string}        [args.variant]    'women'/'men', obligatorisk för lookup
 * @param {object}        [args.rates]      växelkurser per euro, obligatorisk
 *                                          för currency. Hämtas från /api/rates
 *                                          och finns aldrig i datafilen.
 * @returns {{ok: true, value: number|string} | {ok: false, error: string}}
 *
 * Notera att bara `categoryData` styr matematiken — `category` är en
 * etikett. Skickar du in fel categoryData räknar motorn glatt fel, och
 * det är därför anropen i sidmallarna alltid hämtar båda ur samma post.
 */
function convert({ value, from, to, category, categoryData, variant, rates }) {
  if (!categoryData) return { ok: false, error: 'UNKNOWN_CATEGORY', category };

  switch (categoryData.type) {
    case 'linear':      return convertLinear(value, from, to, categoryData);
    case 'temperature': return convertTemperature(value, from, to);
    case 'numberBase':  return convertNumberBase(value, from, to, categoryData);
    case 'fuel':        return convertFuel(value, from, to, categoryData);
    // Kurserna kommer utifrån, via `rates`. Saknas de svarar motorn nej.
    case 'currency':    return convertCurrency(value, from, to, rates);
    case 'lookup':      return convertLookup(value, from, to, categoryData, variant);
    // Ny typ i datan men ingen gren här. Hellre ett tydligt fel än att
    // falla tillbaka på linear och räkna fel.
    default:            return { ok: false, error: 'UNSUPPORTED_TYPE', type: categoryData.type };
  }
}

export {
  convert,
  convertCurrency,
  convertLinear,
  convertFuel,
  convertTemperature,
  convertNumberBase,
  convertLookup
};
