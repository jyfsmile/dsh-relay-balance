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
 */

const ROUTE_PATH = '/dsh-relay-balance/balance'
const DEFAULT_BASE_URL = 'https://spanagent.xyz'
const DEFAULT_QUOTA_PER_UNIT = 500000
const TIMEOUT_MS = 15000
const LOG_PAGE_SIZE = 100
const LOG_MAX_PAGES = 5

const DEFAULTS = {
  baseURL: DEFAULT_BASE_URL,
  apiKey: '',
  refreshSeconds: 60,
}

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
  try {
    const { status, body } = await getJson(origin, '/api/status', undefined)
    const data = body.data ?? body
    if (!isNewApiOk(status, body)) return { quotaPerUnit: DEFAULT_QUOTA_PER_UNIT }
    const quotaPerUnit = num(data.quota_per_unit) ?? DEFAULT_QUOTA_PER_UNIT
    const pricePerUnit = num(data.price)
    const displayType = typeof data.quota_display_type === 'string' ? data.quota_display_type : undefined
    const displayCurrency = displayType === 'CNY' || displayType === 'USD' || displayType === '¥' || displayType === '人民币'
      ? (displayType === '¥' || displayType === '人民币' ? 'CNY' : displayType)
      : pricePerUnit !== undefined ? 'CNY' : 'USD'
    return {
      quotaPerUnit: quotaPerUnit > 0 ? quotaPerUnit : DEFAULT_QUOTA_PER_UNIT,
      ...(pricePerUnit !== undefined ? { pricePerUnit } : {}),
      displayCurrency,
    }
  } catch {
    return { quotaPerUnit: DEFAULT_QUOTA_PER_UNIT, displayCurrency: 'USD' }
  }
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
 * Today's spend window, first working tier wins (copied from
 * gateway-wallet's readWindow): /api/log/self/stat, then /api/data/self,
 * then the /api/log/token walk. Returns { money, requests } or null.
 * Token counts are NOT in the stat/aggregate tiers; use readTodayTokens
 * for those.
 */
async function readWindow(origin, apiKey, units, fromMs, toMs) {
  const from = Math.floor(fromMs / 1000)
  const to = Math.floor(toMs / 1000) + 60
  try {
    const { status, body } = await getJson(origin, '/api/log/self/stat', apiKey, {
      type: 2, start_timestamp: from, end_timestamp: to,
    })
    if (isNewApiOk(status, body)) {
      const data = body.data ?? {}
      const quota = num(data.quota)
      if (quota !== undefined) {
        const money = quotaToMoney(quota, units)
        if (money !== undefined) return { money, requests: num(data.count) }
      }
    }
  } catch { /* fall through to the next tier */ }
  try {
    const { status, body } = await getJson(origin, '/api/data/self', apiKey, {
      start_timestamp: from, end_timestamp: to, default_time: 'day',
    })
    if (isNewApiOk(status, body)) {
      const rows = Array.isArray(body.data) ? body.data : []
      let quota = 0
      let requests = 0
      for (const row of rows) {
        if (row === null || typeof row !== 'object') continue
        quota += num(row.quota) ?? 0
        requests += num(row.count) ?? 0
      }
      const money = quotaToMoney(quota, units)
      if (money !== undefined) return { money, requests: requests > 0 ? requests : undefined }
    }
  } catch { /* fall through to the next tier */ }
  const walked = await readLogWindow(origin, apiKey, fromMs, toMs).catch(() => null)
  if (walked === null) return null
  const money = quotaToMoney(walked.quota, units)
  if (money === undefined) return null
  return { money, requests: walked.requests }
}

/** Today's token total from the log walk (best-effort; null when incomplete). */
async function readTodayTokens(origin, apiKey, fromMs, toMs) {
  const walked = await readLogWindow(origin, apiKey, fromMs, toMs).catch(() => null)
  if (walked === null) return null
  return { tokens: walked.tokens, requests: walked.requests }
}

/**
 * Fetch everything the panel shows. Returns the flat JSON envelope the
 * panel consumes; on failure { ok: false, error } with error one of
 * 'no-key' | 'http:<status>' | 'network' | 'unparsed'.
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
  let usage = null
  let usageStatus = 0
  let usageAuthFailed = false
  try {
    const r = await getJson(origin, '/api/user/self', apiKey)
    selfStatus = r.status
    if (isNewApiOk(r.status, r.body)) self = r.body.data ?? {}
    // New API answers a bad key on /api/user/self with HTTP 200 + success:false.
    else if (r.status === 401 || r.body?.success === false) selfAuthFailed = true
  } catch {
    return { ok: false, error: 'network' }
  }
  try {
    let r = await getJson(origin, '/api/usage/token/', apiKey)
    if (!isNewApiOk(r.status, r.body)) {
      r = await getJson(origin, '/api/usage/token', apiKey)
    }
    usageStatus = r.status
    if (isNewApiOk(r.status, r.body)) usage = r.body.data ?? {}
    else if (r.status === 401 || r.body?.success === false) usageAuthFailed = true
  } catch {
    usage = null
  }

  if (self === null && usage === null) {
    if (selfAuthFailed || usageAuthFailed) return { ok: false, error: 'http:401' }
    const status = selfStatus !== 0 ? selfStatus : usageStatus
    return { ok: false, error: status !== 0 ? `http:${status}` : 'network' }
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

  const balanceQuota = quota ?? (available ?? (granted !== undefined && usedByKey !== undefined ? granted - usedByKey : undefined))
  const usedQuotaFinal = usedQuota ?? usedByKey
  const balance = unlimited ? undefined : quotaToMoney(balanceQuota, units)
  const used = quotaToMoney(usedQuotaFinal, units)
  if (balance === undefined && used === undefined && !unlimited) {
    return { ok: false, error: 'unparsed' }
  }

  const now = Date.now()
  const [today, tokens] = await Promise.all([
    readWindow(origin, apiKey, units, localDayStartMs(now), now).catch(() => null),
    readTodayTokens(origin, apiKey, localDayStartMs(now), now).catch(() => null),
  ])
  const todayUsd = today?.money?.usd ?? today?.money?.display
  const todayDisplay = today?.money?.display
  const requestsToday = today?.requests ?? tokens?.requests
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
    ...(tokens !== null && tokens !== undefined ? { tokensToday: tokens.tokens } : { tokensToday: null }),
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
          const result = await fetchBalance(cfg)
          send(200, { ...result, refreshSeconds: cfg.refreshSeconds })
        } catch (error) {
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
