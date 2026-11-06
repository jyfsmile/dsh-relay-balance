# dsh-relay-balance

A DeepSeek Harness (DSH) desktop plugin that adds a **Relay Balance** entry
(中转余额) to the left sidebar. It shows, live, the balance of the model
relay you use through DSH:

- remaining balance (big, in $)
- total used, spent today
- request counts (today / total)
- token counts (today; a total is not exposed by New API, so it shows —)
- key name, expiry, allowed models, last-updated time

The rail icon shows a **red dot when the balance drops below $1**.

## Supported relay

Any relay built on the **New API** architecture. The default base URL is
`https://spanagent.xyz` (Span Agent). Balance is read from
`GET {base}/api/user/self` and `GET {base}/api/usage/token/`; today's spend
from `GET /api/log/self/stat` (falling back to `/api/data/self`, then
`/api/log/token`). Quota is converted at **500000 = $1** (read from the
station's `/api/status` when available).

## Install

**In-app (recommended):** Plugins → Add Plugin → paste

```
github:jyfsmile/dsh-relay-balance
```

**Or from the desktop CLI:**

```sh
dsh plugin --profile desktop add github:jyfsmile/dsh-relay-balance
```

Then **fully quit DSH (including the tray icon) and restart it**. The sidebar
entry appears at the bottom of the left rail, between the built-in panels.

## Settings (API key)

The API key is **not** entered in the DSH UI. It lives in the plugin's
config row in your desktop profile's patch file:

```
%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml
```

Add (or replace) the plugin row with a `config:` block:

```yaml
- insert:
    - id: dsh-relay-balance
      name: 'dsh-relay-balance'
      config:
        baseURL: 'https://spanagent.xyz'
        apiKey: 'sk-your-key-here'
        refreshSeconds: 60
```

- `baseURL` — the relay's base URL (default `https://spanagent.xyz`).
- `apiKey` — your relay API key. It is sent to the relay only, as an
  `Authorization: Bearer` header, from the Host process. It is never logged,
  never returned to the browser, and never leaves your machine except to the
  relay itself.
- `refreshSeconds` — auto-refresh interval for the panel, default 60,
  minimum 10.

After editing, **fully quit DSH (tray included) and restart**. The panel
shows "No API key configured" until a key is set.

## Version note

Works on **DSH >= 0.1.7-rc.2, including 0.2.2-rc.1**. The plugin declares
**no `@deepseek-ai/*` peer dependencies at all, on purpose**: that is exactly
what made `dsh-gateway-wallet` report "version not supported" on 0.2.2-rc.1
(its peer cap was `<0.2.0-0`). This plugin only uses the `ctx` object Cordis
hands it plus Node globals, so nothing can version-lock it.

## How it works

- **Host** (`index.js`): one same-origin route, `GET
  /dsh-relay-balance/balance`, loopback-only, GET-only. It reads the relay
  with the configured key and returns a flat JSON summary. No key is ever in
  the response (only a masked hint like `sk-••••abcd`).
- **Client** (`client.js`): the sidebar rail entry + panel. It only fetches
  the same-origin route — never the relay, never the key. Auto-refresh every
  60s (configurable), manual refresh button, empty state when no key is set.

## Limitations

- **Total token count** is not exposed by New API, so the panel shows — for
  it. Today's tokens come from the `/api/log/token` walk (up to 5 pages × 100
  entries); if a day has more than 500 requests, today's tokens fall back to
  — rather than showing a wrong number.
- Config changes need a **full DSH restart** (tray included) to take effect.
- The plugin has no build step and no dependencies — plain JS, MIT licensed.
