# quickunits

[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/robomupp/quickunits-mcp)

Exact unit conversion in the terminal — and a stdio bridge that puts the
[QuickUnits](https://quickunits.global) MCP server in front of any MCP client
that can only start a local process.

Every answer comes with the **factor** behind it and the URL of the page that
documents that factor. A number without provenance is a guess with good
handwriting.

## CLI

```bash
npx quickunits 3 m to ft
# 3 m = 9.84251968503937 ft
#
# Faktor: 1 m = 3.280839895013123 ft
# Förklaring och källa: https://quickunits.global/en/length/meters-to-feet/

npx quickunits 100 C to F --lang=de     # labels in German, same number
npx quickunits 5 km in miles --json     # machine-readable
npx quickunits --list length            # every length pair with its page URL
npx quickunits --categories             # 43 categories
npx quickunits 70 kg to lb --timeout=20
```

`--lang` takes a BCP-47 tag (`sv`, `sv-SE`, `de`, `zh-TW`, …). Only the labels and
the explanation are translated — the number, the unit symbols and the URL are
identical in every language, so a bad translation can never produce a wrong
answer. Unknown tags fall back to English rather than guessing.

## MCP over stdio

Clients that only launch local processes (Claude Desktop, Cursor and others)
cannot talk to a remote URL. This package is the adapter:

```json
{
  "mcpServers": {
    "quickunits": {
      "command": "npx",
      "args": ["-y", "quickunits-mcp"]
    }
  }
}
```

Same three tools, same server, no logic in the middle:

| Tool | Input | Returns |
|---|---|---|
| `convert_units` | `value`, `from`, `to`, optional `category`, `lang` | value, factor, exactness, source URL |
| `list_conversions` | optional `category`, `limit` | 213 pairs with the URL of each page |
| `list_categories` | — | 43 categories |

The bridge moves messages and nothing else. All conversion happens on
`https://quickunits.global/mcp`, which reads the same `convert.js` the pages are
built from — if the two disagreed the citation would be worthless.

## What it refuses

Currency and number bases return an error with a link instead of a number. A
cached exchange rate is a wrong answer dressed as a right one, and a wrong answer
with a citation is worse than no answer. Unknown units are rejected rather than
guessed.

## Requirements

Node 18 or newer (uses the built-in `fetch` and `AbortSignal.timeout`). No
dependencies. No API key. No account. The CLI needs a network connection — the
factors live on the server, not in this package, so they can never go stale here.

## Licence

MIT. The unit definitions are public standards; the page URLs are the point.
