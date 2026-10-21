# QuickUnits MCP server

An MCP server that converts units and tells you *why* the answer is the answer —
the exact value, the factor, and the URL of the page that documents that factor.

**Endpoint:** `https://quickunits.global/mcp`
**Registry:** `io.github.Robomupp/quickunits`
**Site:** https://quickunits.global

## Why this exists

Language models are good at arithmetic and bad at knowing which definition they
used. Ask for metres in feet and you get a plausible number with no provenance.
This server returns the number *and* the citation, so the model can point at a
source instead of guessing.

Same engine as the website: `src/lib/convert.js` is the file the pages use. If the
server and the page disagreed, the citation would be worthless.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `convert_units` | `value`, `from`, `to`, optional `category` | value, factor, exactness, source URL |
| `list_conversions` | optional `category`, `limit` | pairs with the URL of each page |
| `list_categories` | — | 43 categories with slug and page URL |

## Transport

Stateless JSON-RPC 2.0 over HTTP — one POST per call, no session header, no SSE.
A `GET` on the endpoint returns a plain description of the tools, so a client can
discover the server without speaking JSON-RPC first.

```bash
curl -s -X POST https://quickunits.global/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"convert_units",
                 "arguments":{"value":3,"from":"m","to":"ft"}}}'
```

```json
3 m = 9.84251968503937 ft
Factor: 1 m = 3.280839895013123 ft
Explanation and citation: https://quickunits.global/en/length/meters-to-feet/
```

## What it refuses

Currency and number bases answer with an error and a link to the page instead of
a number. A cached exchange rate is a wrong answer dressed as a right one, and a
wrong answer with a citation is worse than no answer.

Unknown units are rejected rather than guessed.

## Data

`data/mcp-data.json` (48 kB) holds the category structure, the base unit, the
symbol and factor of every unit, and the slug of every pair page. It is generated
from the same source files the site is built from and served as a static asset —
the function fetches it through `env.ASSETS`, so the server reads exactly the file
the site publishes.

The prose descriptions, the translations and the keyword work live in the site
repository and are deliberately not part of this one.

## Running it

This is a Cloudflare Pages Function (`functions/mcp.js`) that reads the data
through `env.ASSETS`. To run it elsewhere, point the asset fetch at
`data/mcp-data.json` and keep the two source files unchanged.

## Licence

MIT. The unit definitions are public standards; the page URLs are the point.
