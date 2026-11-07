/**
 * dsh-relay-balance — Host half.
 *
 * One same-origin route, GET /dsh-relay-balance/balance, that reads a New API
 * relay's account ledger (spanagent.xyz by default) and returns a flat JSON
 * summary for the sidebar panel. The API key lives only in this Host process:
 * it is read from the plugin config (see README), sent to the relay as an
 * Authorization header, and never logged, never returned, never sent to the
 * browser (only a masked hint, sk-••••xxxx, is exposed).
 *
 * No @deepseek-ai/* imports anywhere in this file, on purpose: the plugin
 * declares no @deepseek-ai peer dependencies (that is exactly what broke
 * dsh-gateway-wallet on DSH 0.2.2-rc.1), so it only uses the `ctx` object
 * Cordis hands to apply() plus Node globals (fetch / URL / AbortController).
 * Config comes from the composition row (profile cordis.patch.yml, see
 * README); when the row carries no config, the defaults below apply.
 *
 * Relay parsing is copied from MuAllen/dsh-gateway-wallet (MIT):
 *   - units: GET /api/status -> quota_per_unit (default 500000 = $1)
 *   - key ledger: GET /api/usage/token/ -> total_granted / total_used /
 *     total_available / unlimited_quota / name / expires_at / model_limits
 *   - today: GET /api/log/self/stat -> /api/data/self -> /api/log/token
 *     (first working tier wins), same as gateway-wallet's readWindow.
 *   - account: GET /api/user/self -> quota / used_quota / request_count.
 *
 * Request discipline (the relay rate-limits bursts, and a burst used to make
 * the panel flap between working and HTTP 401): a successful balance result
 * is cached for 30s, concurrent route calls share one in-flight fetch, the
 * station's /api/status is cached for 10 minutes, and today's numbers come
 * from a single log walk (max 3 pages) shared by spend and tokens. A manual
 * refresh (`?fresh=1`) bypasses the 30s cache, so the button always reads
 * the relay live; the auto path stays on the cache to keep request volume
 * low (about one relay round-trip every 30s while the panel is open).
 * The panel may override the relay address and key per request with the
 * X-Relay-Base-URL / X-Relay-Key headers; the override applies to that
 * fetch only and the cache is keyed by the effective credentials. An
 * overridden key only changes which account is queried — the account
 * ledger always wins over one key's own figures, so other keys' usage
 * stays counted in.
 */

const ROUTE_PATH = '/dsh-relay-balance/balance'
const DEFAULT_BASE_URL = 'https://spanagent.xyz'
const DEFAULT_QUOTA_PER_UNIT = 500000
const TIMEOUT_MS = 15000
const LOG_PAGE_SIZE = 100
const LOG_MAX_PAGES = 3
/** Successful balance results are served from cache for this long. */
const RESULT_TTL_MS = 30_000
/** Station units (/api/status) change rarely; cache them longer. */
const UNITS_TTL_MS = 10 * 60_000

const DEFAULTS = {
  baseURL: DEFAULT_BASE_URL,
  apiKey: '',
  refreshSeconds: 30,
}

let unitsCache = null
let resultCache = null
let inflight = null

/**
 * No `Config` export here, on purpose (see the dsh-relaunch precedent).
 * Cordis 4.1.0's resolveConfig() calls `runtime.Config['~standard'].validate`
 * — Config must be a Standard Schema, and a plain object would throw
 * `TypeError: Cannot read properties of undefined (reading 'validate')`
 * when the plugin loads. A real schema would need the
 * `@deepseek-ai/schemastery` import, which this plugin deliberately avoids
 * (no @deepseek-ai peer dependencies). With no Config export, Cordis passes
 * the composition row's `config:` through unchanged, and apply() below
 * merges it over the defaults.
 */

/** Parse a finite number from a number or a numeric string. */
function num(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6
}

/** New API success: 2xx and no explicit success:false / code:false. */
function isNewApiOk(status, body) {
  if (status < 200 || status >= 300) return false
  if (body.success === false || body.code === false) return false
  return true
}

/**
 * Only a real HTTP 401/403 means "the key is rejected". A 200 with
 * success:false (or a 429) is a transient relay/rate-limit problem, and
 * must never be reported as a bad key.
 */
function isAuthFailure(status) {
  return status === 401 || status === 403
}

function epochMs(value) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  return value > 1e12 ? value : value * 1e3
}

function localDayStartMs(now = Date.now()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function maskKey(apiKey) {
  const last4 = apiKey.slice(-4)
  if (apiKey.startsWith('sk-')) return `sk-••••${last4}`
  return `••••${last4}`
}

function quotaToMoney(quota, units) {
  if (quota === undefined) return undefined
  const usd = units.quotaPerUnit > 0 ? round6(quota / units.quotaPerUnit) : undefined
  const display = usd !== undefined && units.pricePerUnit !== undefined
    ? round6(usd * units.pricePerUnit)
    : undefined
  return {
    quota,
    ...(usd !== undefined ? { usd } : {}),
    ...(display !== undefined ? { display } : {}),
    ...(units.displayCurrency !== undefined ? { currency: units.displayCurrency } : {}),
  }
}

function parseModelLimits(data) {
  if (data.model_limits_enabled !== true) return undefined
  const raw = data.model_limits
  if (typeof raw === 'string' && raw.trim() !== '') {
    const names = raw.split(/[,，]/).map((part) => part.trim()).filter((part) => part !== '')
    return names.length > 0 ? names : undefined
  }
  if (Array.isArray(raw)) {
    const names = raw.filter((item) => typeof item === 'string' && item !== '')
    return names.length > 0 ? names : undefined
  }
  if (raw !== null && typeof raw === 'object') {
    const names = Object.entries(raw)
      .filter(([, allowed]) => allowed === true || allowed === 1 || allowed === 'true')
      .map(([name]) => name)
    return names.length > 0 ? names : undefined
  }
  return undefined
}

/** GET JSON with a timeout. Never throws on a bad body (returns {}). */
async function getJson(origin, path, apiKey, params = {}) {
  const url = new URL(path, origin)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const headers = { accept: 'application/json' }
    if (apiKey !== undefined) headers.authorization = `Bearer ${apiKey}`
    const response = await fetch(url, { headers, signal: controller.signal })
    const body = await response.json().catch(() => ({}))
    return { status: response.status, body }
  } finally {
    clearTimeout(timer)
  }
}

/** Quota units for this station: GET /api/status (no key). Falls back to 500000 = $1. */
async function readUnits(origin) {
  const now = Date.now()
  if (unitsCache !== null && unitsCache.origin === origin && now - unitsCache.at < UNITS_TTL_MS) {
    return unitsCache.units
  }
  let units
  try {
    const { status, body } = await getJson(origin, '/api/status', undefined)
    const data = body.data ?? body
    if (!isNewApiOk(status, body)) {
      units = { quotaPerUnit: DEFAULT_QUOTA_PER_UNIT }
    } else {
      const quotaPerUnit = num(data.quota_per_unit) ?? DEFAULT_QUOTA_PER_UNIT
      const pricePerUnit = num(data.price)
      const displayType = typeof data.quota_display_type === 'string' ? data.quota_display_type : undefined
      const displayCurrency = displayType === 'CNY' || displayType === 'USD' || displayType === '¥' || displayType === '人民币'
        ? (displayType === '¥' || displayType === '人民币' ? 'CNY' : displayType)
        : pricePerUnit !== undefined ? 'CNY' : 'USD'
      units = {
        quotaPerUnit: quotaPerUnit > 0 ? quotaPerUnit : DEFAULT_QUOTA_PER_UNIT,
        ...(pricePerUnit !== undefined ? { pricePerUnit } : {}),
        displayCurrency,
      }
    }
  } catch {
    units = { quotaPerUnit: DEFAULT_QUOTA_PER_UNIT, displayCurrency: 'USD' }
  }
  unitsCache = { origin, at: now, units }
  return units
}

/**
 * Walk one window of /api/log/token (paged). Returns null when the walk did
 * not finish inside LOG_MAX_PAGES (numbers would under-count, so no number
 * is reported at all). Otherwise { quota, requests, tokens }.
 */
async function readLogWindow(origin, apiKey, fromMs, toMs) {
  let quota = 0
  let requests = 0
  let tokens = 0
  for (let page = 1; page <= LOG_MAX_PAGES; page++) {
    const { status, body } = await getJson(origin, '/api/log/token', apiKey, {
      p: page,
      page_size: LOG_PAGE_SIZE,
      type: 2,
      start_timestamp: Math.floor(fromMs / 1000),
      end_timestamp: Math.floor(toMs / 1000),
    })
    if (!isNewApiOk(status, body)) return null
    const payload = body.data
    const items = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : []
    for (const item of items) {
      if (item === null || typeof item !== 'object') continue
      quota += num(item.quota) ?? 0
      requests += 1
      const promptTokens = num(item.prompt_tokens) ?? 0
      const completionTokens = num(item.completion_tokens) ?? 0
      const pairSum = promptTokens + completionTokens
      tokens += pairSum > 0 ? pairSum : (num(item.total_tokens) ?? 0)
    }
    if (items.length < LOG_PAGE_SIZE) return { quota, requests, tokens }
    if (page === LOG_MAX_PAGES) return null
  }
  return null
}

/**
 * Today's spend + tokens. First working tier wins for spend
 * (/api/log/self/stat, then /api/data/self, then the log walk), and a single
 * log walk supplies the token count — the walk runs once and its result is
 * shared, never twice in parallel. Returns { money, requests, tokens } with
 * undefined/null where a figure could not be read.
 */
async function readToday(origin, apiKey, units, fromMs, toMs) {
  const from = Math.floor(fromMs / 1000)
  const to = Math.floor(toMs / 1000) + 60
  let money
  let requests
  try {
    const { status, body } = await getJson(origin, '/api/log/self/stat', apiKey, {
      type: 2, start_timestamp: from, end_timestamp: to,
    })
    if (isNewApiOk(status, body)) {
      const data = body.data ?? {}
      const quota = num(data.quota)
      if (quota !== undefined) {
        money = quotaToMoney(quota, units)
        requests = num(data.count)
      }
    }
  } catch { /* fall through to the next tier */ }
  if (money === undefined) {
    try {
      const { status, body } = await getJson(origin, '/api/data/self', apiKey, {
        start_timestamp: from, end_timestamp: to, default_time: 'day',
      })
      if (isNewApiOk(status, body)) {
        const rows = Array.isArray(body.data) ? body.data : []
        let quota = 0
        let count = 0
        for (const row of rows) {
          if (row === null || typeof row !== 'object') continue
          quota += num(row.quota) ?? 0
          count += num(row.count) ?? 0
        }
        const m = quotaToMoney(quota, units)
        if (m !== undefined) {
          money = m
          requests = count > 0 ? count : undefined
        }
      }
    } catch { /* fall through to the log walk */ }
  }
  const walked = await readLogWindow(origin, apiKey, fromMs, toMs).catch(() => null)
  let tokens
  if (walked !== null) {
    tokens = walked.tokens
    if (money === undefined) {
      const m = quotaToMoney(walked.quota, units)
      if (m !== undefined) {
        money = m
        requests = walked.requests
      }
    }
    if (requests === undefined) requests = walked.requests
  }
  return { money, requests, tokens }
}

/**
 * Fetch everything the panel shows. Returns the flat JSON envelope the
 * panel consumes; on failure { ok: false, error } with error one of
 * 'no-key' | 'http:401' | 'rate-limited' | 'relay' | 'network' | 'unparsed'
 * ('relay' carries the relay's own message in `detail` when there is one).
 */
async function fetchBalance(cfg) {
  const origin = cfg.baseURL
  const apiKey = cfg.apiKey
  if (apiKey === '') return { ok: false, error: 'no-key' }

  let units
  try {
    units = await readUnits(origin)
  } catch {
    units = { quotaPerUnit: DEFAULT_QUOTA_PER_UNIT, displayCurrency: 'USD' }
  }

  let self = null
  let selfStatus = 0
  let selfAuthFailed = false
  let selfRelayMessage
  let usage = null
  let usageStatus = 0
  let usageAuthFailed = false
  let usageRelayMessage
  try {
    const r = await getJson(origin, '/api/user/self', apiKey)
    selfStatus = r.status
    if (isNewApiOk(r.status, r.body)) {
      const data = r.body.data ?? r.body
      // Only accept the payload when it actually carries user fields; a 200
      // with an empty body (some stations answer API-key calls with a login
      // page) must not masquerade as data.
      if (data !== null && typeof data === 'object' && !Array.isArray(data)
        && (num(data.quota) !== undefined || num(data.used_quota) !== undefined
          || num(data.request_count) !== undefined || typeof data.username === 'string')) {
        self = data
      }
    }
    // New API answers a bad key on /api/user/self with HTTP 200 + success:false,
    // but a 200 + success:false can also be a transient relay problem — only
    // a real HTTP 401/403 means the key itself was rejected.
    else if (isAuthFailure(r.status)) selfAuthFailed = true
    else if (typeof r.body?.message === 'string' && r.body.message !== '') selfRelayMessage = r.body.message
  } catch {
    return { ok: false, error: 'network' }
  }
  try {
    const r = await getJson(origin, '/api/usage/token/', apiKey)
    usageStatus = r.status
    if (isNewApiOk(r.status, r.body)) {
      const data = r.body.data ?? r.body
      if (data !== null && typeof data === 'object' && !Array.isArray(data)
        && (num(data.total_granted) !== undefined || num(data.total_used) !== undefined
          || num(data.total_available) !== undefined || data.unlimited_quota === true
          || typeof data.name === 'string' || num(data.expires_at) !== undefined)) {
        usage = data
      }
    }
    else if (isAuthFailure(r.status)) usageAuthFailed = true
    else if (typeof r.body?.message === 'string' && r.body.message !== '') usageRelayMessage = r.body.message
  } catch {
    usage = null
  }

  if (self === null && usage === null) {
    if (selfAuthFailed || usageAuthFailed) return { ok: false, error: 'http:401' }
    const status = selfStatus !== 0 ? selfStatus : usageStatus
    if (status === 429) return { ok: false, error: 'rate-limited' }
    const detail = selfRelayMessage ?? usageRelayMessage
    return { ok: false, error: 'relay', ...(detail !== undefined ? { detail } : {}), ...(status !== 0 ? { status } : {}) }
  }

  // Primary numbers come from /api/user/self; the per-key ledger is the
  // fallback (and the source of key name / expiry / model limits).
  const quota = self !== null ? num(self.quota) : undefined
  const usedQuota = self !== null ? num(self.used_quota) : undefined
  const requestCount = self !== null ? num(self.request_count) : undefined
  const username = self !== null && typeof self.username === 'string' ? self.username : undefined

  const granted = usage !== null ? num(usage.total_granted) : undefined
  const usedByKey = usage !== null ? num(usage.total_used) : undefined
  const available = usage !== null ? num(usage.total_available) : undefined
  const unlimited = usage !== null ? usage.unlimited_quota === true : false
  const keyName = usage !== null && typeof usage.name === 'string' && usage.name !== '' ? usage.name : undefined
  const expiresRaw = usage !== null ? num(usage.expires_at) : undefined
  const expiresAt = epochMs(expiresRaw)
  const neverExpires = expiresRaw === 0 || expiresRaw === -1
  const modelLimits = usage !== null ? parseModelLimits(usage) : undefined

  // The account ledger (/api/user/self) always wins: the panel shows the
  // account's remaining balance and total used, not one key's own figures.
  // The per-key ledger is only the fallback when the account ledger is
  // unavailable, so other keys' usage is counted in.
  const balanceQuota = quota ?? (available ?? (granted !== undefined && usedByKey !== undefined ? granted - usedByKey : undefined))
  const usedQuotaFinal = usedQuota ?? usedByKey
  // An unlimited key still draws from a finite account balance: show the
  // account balance whenever /api/user/self provides one. Only when there is
  // genuinely no number does the panel fall back to "unlimited".
  const balance = quotaToMoney(balanceQuota, units)
  const used = quotaToMoney(usedQuotaFinal, units)
  if (balance === undefined && used === undefined && !unlimited) {
    return { ok: false, error: 'unparsed' }
  }

  const now = Date.now()
  const today = await readToday(origin, apiKey, units, localDayStartMs(now), now).catch(() => ({ money: undefined, requests: undefined, tokens: undefined }))
  const todayUsd = today.money?.usd ?? today.money?.display
  const todayDisplay = today.money?.display
  const requestsToday = today.requests ?? undefined
  // Display currency comes from the station (/api/status); for spanagent it
  // is CNY with price 1, so the display number equals the USD number and
  // only the symbol differs (¥ vs $).
  const currency = balance?.currency ?? used?.currency ?? units.displayCurrency ?? 'USD'

  return {
    ok: true,
    fetchedAt: now,
    baseURL: origin,
    currency,
    ...(username !== undefined ? { username } : {}),
    ...(keyName !== undefined ? { keyName } : {}),
    keyHint: maskKey(apiKey),
    ...(balance !== undefined ? { balanceUsd: balance.usd ?? balance.display, balanceQuota: balance.quota, ...(balance.display !== undefined ? { balanceDisplay: balance.display } : {}) } : {}),
    ...(used !== undefined ? { usedUsd: used.usd ?? used.display, usedQuota: used.quota, ...(used.display !== undefined ? { usedDisplay: used.display } : {}) } : {}),
    ...(todayUsd !== undefined ? { todayUsd, ...(todayDisplay !== undefined ? { todayDisplay } : {}) } : {}),
    ...(requestCount !== undefined ? { requestCount } : {}),
    ...(requestsToday !== undefined ? { requestsToday } : {}),
    ...(requestCount !== undefined ? { requestsTotal: requestCount } : {}),
    ...(today.tokens !== undefined ? { tokensToday: today.tokens } : { tokensToday: null }),
    tokensTotal: null,
    unlimited,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(neverExpires ? { neverExpires: true } : {}),
    ...(modelLimits !== undefined ? { modelLimits } : {}),
    refreshSeconds: cfg.refreshSeconds,
  }
}

function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address === '') return false
  const bare = address.startsWith('::ffff:') ? address.slice(7) : address
  if (bare === '::1' || bare === 'localhost') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)
}

function hostNameOf(header) {
  if (typeof header !== 'string' || header === '') return ''
  if (header.startsWith('[')) return header.slice(1, header.indexOf(']'))
  const colon = header.lastIndexOf(':')
  return colon === -1 ? header : header.slice(0, colon)
}

/**
 * Register the balance route for this plugin's lifetime.
 * @param {object} ctx - the Cordis plugin context.
 * @param {object} cfg - merged config (defaults + composition-row override).
 */
export function apply(ctx, config = {}) {
  const cfg = {
    ...DEFAULTS,
    ...(config !== null && typeof config === 'object' ? config : {}),
  }
  if (typeof cfg.baseURL !== 'string' || cfg.baseURL === '') cfg.baseURL = DEFAULTS.baseURL
  cfg.baseURL = cfg.baseURL.replace(/\/+$/, '')
  if (typeof cfg.apiKey !== 'string') cfg.apiKey = ''
  cfg.apiKey = cfg.apiKey.trim()
  // Strip surrounding quotes if the key was pasted with them ("sk-..." /
  // 'sk-...'): the relay would reject the quotes as part of the key.
  if (cfg.apiKey.length >= 2) {
    const first = cfg.apiKey[0]
    const last = cfg.apiKey[cfg.apiKey.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      cfg.apiKey = cfg.apiKey.slice(1, -1).trim()
    }
  }
  if (!Number.isFinite(cfg.refreshSeconds)) cfg.refreshSeconds = DEFAULTS.refreshSeconds
  cfg.refreshSeconds = Math.min(Math.max(Math.trunc(cfg.refreshSeconds), 10), 3600)

  const disposers = []

  const register = (server) => {
    if (server === undefined || server === null) return
    const stop = server.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (req, res) => {
        const send = (status, body) => {
          res.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify(body))
        }
        // Same-origin panel only: loopback callers, GET only.
        if (req.method !== 'GET') {
          send(405, { ok: false, error: 'method-not-allowed' })
          return
        }
        const peerOk = isLoopbackAddress(req.socket?.remoteAddress)
        const hostOk = isLoopbackAddress(hostNameOf(req.headers.host))
        if (!peerOk || !hostOk) {
          send(403, { ok: false, error: 'forbidden' })
          return
        }
        try {
          // Serve a fresh successful result from cache, and share one
          // in-flight fetch between concurrent callers (panel + rail icon).
          // `?fresh=1` (the panel's manual refresh button) skips the cache
          // read, so the button always returns a live relay read.
          let fresh = false
          try {
            fresh = new URL(req.url, 'http://127.0.0.1').searchParams.get('fresh') === '1'
          } catch { fresh = false }
          // Panel override: the panel may supply its own relay address and
          // key in headers (same-origin, loopback-only route). The override
          // applies to this fetch only; the cache is keyed by the effective
          // credentials so two keys never share a result.
          const overrideBase = typeof req.headers['x-relay-base-url'] === 'string' ? req.headers['x-relay-base-url'].trim() : ''
          let overrideKey = typeof req.headers['x-relay-key'] === 'string' ? req.headers['x-relay-key'].trim() : ''
          // Strip surrounding quotes if the key was pasted with them
          // ("sk-..." / 'sk-...'): the relay would reject the quotes as part
          // of the key.
          if (overrideKey.length >= 2) {
            const first = overrideKey[0]
            const last = overrideKey[overrideKey.length - 1]
            if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
              overrideKey = overrideKey.slice(1, -1).trim()
            }
          }
          let effBase = cfg.baseURL
          if (overrideBase !== '') {
            try {
              const parsed = new URL(overrideBase)
              if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                effBase = overrideBase.replace(/\/+$/, '')
              }
            } catch { /* keep the configured baseURL */ }
          }
          const effKey = overrideKey !== '' ? overrideKey : cfg.apiKey
          const effCfg = { ...cfg, baseURL: effBase, apiKey: effKey }
          const cacheKey = `${effBase}\n${effKey}`
          const now = Date.now()
          if (!fresh && resultCache !== null && resultCache.key === cacheKey && now - resultCache.at < RESULT_TTL_MS) {
            send(200, { ...resultCache.body, refreshSeconds: cfg.refreshSeconds })
            return
          }
          if (inflight === null || inflight.key !== cacheKey) {
            inflight = { key: cacheKey, promise: fetchBalance(effCfg).catch(() => ({ ok: false, error: 'network' })) }
          }
          const result = await inflight.promise
          if (inflight.key === cacheKey) inflight = null
          if (result.ok === true) resultCache = { key: cacheKey, at: Date.now(), body: result }
          send(200, { ...result, refreshSeconds: cfg.refreshSeconds })
        } catch (error) {
          inflight = null
          send(200, { ok: false, error: 'network', refreshSeconds: cfg.refreshSeconds })
        }
      },
    })
    if (typeof stop === 'function') disposers.push(stop)
  }

  // `webServer` is optional: a composition without it simply has no route,
  // and the plugin stays inert instead of throwing.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (inner) => {
      const server = inner.webServer
      if (server === undefined || server === null) {
        console.warn('dsh-relay-balance: this composition has no webServer; the route stays unmounted')
        return
      }
      try {
        register(server)
      } catch (error) {
        console.error('dsh-relay-balance: registering the balance route failed', error)
      }
      return () => {
        for (const dispose of disposers.splice(0)) {
          try { dispose() } catch (error) { console.error('dsh-relay-balance: route disposal failed', error) }
        }
      }
    })
  }
}

export const name = 'dsh-relay-balance'
