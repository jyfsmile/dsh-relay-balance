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
        refreshSeconds: 30
```

- `baseURL` — the relay's base URL (default `https://spanagent.xyz`).
- `apiKey` — your relay API key. It is sent to the relay only, as an
  `Authorization: Bearer` header, from the Host process. It is never logged,
  never returned to the browser, and never leaves your machine except to the
  relay itself.
- `refreshSeconds` — auto-refresh interval for the panel, default 30,
  minimum 10.

After editing, **fully quit DSH (tray included) and restart**. The panel
shows "No API key configured" until a key is set.

## Manual remaining balance

The relay API only reports **this key's** numbers (its remaining balance and
its total used) — it never exposes the account's balance. So the panel lets
you enter the account's **current remaining balance** as shown on the relay
dashboard, in the same currency the panel shows (¥ on spanagent). Save it
and the panel shows that number minus what this key uses after you save it:
"manual remaining − used since saving". As this key is used, the remaining
balance drops. Re-enter the number after a top-up, or when you switch keys
(the saved baseline belongs to the key it was saved for; if the key changes,
the panel says so and falls back to the key's own remaining until you
re-enter it). Clear it to go back to the balance the relay reports for this
key.

The manual remaining is stored in the panel's local storage — no config edit,
no restart. It has to be re-entered on another machine or after clearing
browser data. The rail icon's low-balance red dot still follows the balance
the relay reports.

Note the limit: only this key's usage after you save is subtracted. If other
keys on the same account are used, or the account is topped up, the shown
number drifts — re-enter the dashboard balance to re-sync.

## Enter the relay address and key in the panel

The panel lets you enter a relay address and API key directly — no config
edit, no restart. Save it and the panel reads that key's data: the remaining
balance and total used shown are **that key's own numbers**, not the
account's — the relay API does not expose the account balance through a key.
To see the account's remaining balance, enter it in the manual remaining
balance section above. Leave both fields empty and clear to go back to the
key from the config.

The address and key are stored in the panel's local storage and sent only
to the Host on your own machine. They have to be re-entered on another
machine or after clearing browser data.

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
  30s (configurable); the manual refresh button always reads the relay live
  (it bypasses the Host's 30s cache), and the footer shows the reading's age
  in seconds, so you can see the number is live. Empty state when no key is set.
  An address and key entered in the panel travel to the Host in request
  headers (`X-Relay-Base-URL` / `X-Relay-Key`) and apply to that fetch only;
  they are never written to the config file.

## Limitations

- **Total token count** is not exposed by New API, so the panel shows — for
  it. Today's tokens come from the `/api/log/token` walk (up to 5 pages × 100
  entries); if a day has more than 500 requests, today's tokens fall back to
  — rather than showing a wrong number.
- Config changes need a **full DSH restart** (tray included) to take effect.
- The plugin has no build step and no dependencies — plain JS, MIT licensed.
