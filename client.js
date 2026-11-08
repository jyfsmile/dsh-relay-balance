/**
 * dsh-relay-balance — Client half.
 *
 * One rail entry in the left sidebar ("中转余额" / "Relay Balance") and the
 * panel behind it, showing a New API relay's remaining balance, spend and
 * token usage. The panel never talks to the relay and never sees the API key:
 * it only GETs the same-origin route this package's Host half registers
 * (/dsh-relay-balance/balance). The key lives only in the Host process.
 *
 * Layout facts this file depends on (verified against dsh-relaunch, which
 * ships the same two seats on this DSH lineage):
 *   - `sidebar.panellist` entries carry `id`, `order` and `label`, and draw
 *     their own glyph as the component passed to register() (there is no icon
 *     field in the registration). `label` may be a thunk, which is what lets
 *     it follow a language switch without re-registering.
 *   - `main` is keyed by that same id, and its props come from the seat's
 *     `inject` thunk.
 *
 * The rail icon polls the same route on its own (every 60s) so it can show
 * the red low-balance dot (< $1) without the panel being open.
 *
 * Styling: a single injected <style> tag (rb_ classes, DSW design tokens),
 * the same approach MuAllen/dsh-gateway-wallet uses — one stylesheet, no
 * inline-style soup, hover states and data-attributes instead of per-element
 * style objects. The layout follows that panel too: a header with a small
 * icon refresh button, an identity line, a three-column stat row, row
 * sections with hairline dividers, and settings cards at the bottom. The
 * usage bar borrows feibi-mochi/deepseek-harness-control-center's plan bar
 * (thin track, fill colour shifts as the key's used share grows).
 *
 * All visible text goes through the `locale` service. The catalogue is
 * registered here (and also shipped as locale/*.json for the plugin listing);
 * when `locale` is absent the English column is used directly, so the panel
 * never renders a bare key.
 */
window.__ModuleLoader__.load({
  id: 'dsh-relay-balance',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /** Panel identity. The rail entry and the main panel must agree. */
    const PANEL_ID = 'relay-balance'
    /** Host route registered by this package's Host half. */
    const ROUTE = '/dsh-relay-balance/balance'
    /** One-click update routes registered by the Host half. */
    const UPDATE_CHECK_ROUTE = '/dsh-relay-balance/update/check'
    const UPDATE_APPLY_ROUTE = '/dsh-relay-balance/update/apply'
    /** Locale namespace owned by this plugin. */
    const NS = 'dsh-relay-balance'
    /** Below this balance (USD) the rail icon shows a red dot. */
    const LOW_BALANCE_USD = 1
    /** Style tag id for the injected panel stylesheet. */
    const STYLE_ID = 'dsh-relay-balance/panel.css'

    /** The panel stylesheet, injected once into <head>. */
    const CSS = [
      '.rb_root{display:flex;flex-direction:column;gap:14px;padding:16px}',
      '.rb_header{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.rb_title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.rb_iconBtn{cursor:pointer;width:26px;height:26px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;padding:0;display:inline-flex}',
      '.rb_iconBtn:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.rb_iconBtn:disabled{opacity:.5;cursor:default}',
      '.rb_note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.rb_data[data-loading]{opacity:.45}',
      '.rb_who{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.rb_whoName{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.rb_stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}',
      '.rb_stat{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;min-width:0}',
      '.rb_statValue{font-size:16px;line-height:22px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.rb_stat[data-low] .rb_statValue{color:var(--dsw-alias-state-warn-primary)}',
      '.rb_statLabel{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin-top:2px}',
      '.rb_bar{height:5px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.14));margin-top:10px}',
      '.rb_barFill{height:100%;border-radius:inherit;background:var(--dsw-alias-brand-primary,#4aa3ff);transition:width .18s ease}',
      '.rb_barFill.warn{background:var(--dsw-alias-state-warning-primary,#b7791f)}',
      '.rb_barFill.critical{background:var(--dsw-alias-state-error-primary,#e5534b)}',
      '.rb_barNote{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin-top:4px}',
      '.rb_noteLine{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin-top:8px}',
      '.rb_noteLine.warn{color:var(--dsw-alias-state-warn-primary)}',
      '.rb_section{margin-top:14px}',
      '.rb_sectionTitle{font-size:11px;line-height:16px;font-weight:500;color:var(--dsw-alias-label-tertiary);margin:0 0 6px}',
      '.rb_rows{display:flex;flex-direction:column}',
      '.rb_row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:18px}',
      '.rb_row:last-child{border-bottom:0}',
      '.rb_rowName{color:var(--dsw-alias-label-tertiary)}',
      '.rb_rowValue{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;text-align:right}',
      '.rb_rowValueWrap{white-space:normal;max-width:68%;word-break:break-all}',
      '.rb_setCard{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}',
      '.rb_mt{margin-top:14px}',
      '.rb_setTitle{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.rb_fieldRow{display:flex;gap:8px;align-items:center}',
      '.rb_input{min-width:0;padding:6px 10px;font-size:13px;border-radius:8px;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,0.25));background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary);outline:none}',
      '.rb_inputGrow{flex:1}',
      '.rb_inputBlock{width:100%;box-sizing:border-box}',
      '.rb_btn{padding:6px 12px;font-size:12px;font-weight:500;border-radius:999px;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,0.25));background:var(--dsw-alias-button-elevated-fill,rgba(128,128,128,0.08));color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}',
      '.rb_hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.rb_warnLine{font-size:12px;color:var(--dsw-alias-state-error-primary,#d33)}',
      '.rb_errorCard{border:1px solid var(--dsw-alias-state-error-primary,rgba(211,51,51,0.4));background:var(--dsw-alias-state-error-bg,rgba(211,51,51,0.06));border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}',
      '.rb_errorText{font-size:13px;line-height:1.6;color:var(--dsw-alias-state-error-primary,#d33)}',
      '.rb_emptyTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.rb_footer{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))}',
    ].join('')

    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-relay-balance'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /**
     * Every string the panel and the rail entry can show.
     * Keyed by the two locales the client ships. The English column doubles
     * as the fallback used when the locale service is unavailable.
     */
    const TEXTS = {
      en: {
        'rail.label': 'Relay Balance',
        'panel.title': 'Relay Balance',
        'panel.balance': 'Balance',
        'panel.used': "This key's total used",
        'panel.today': 'Spent today',
        'panel.requestsToday': 'Requests today',
        'panel.requestsTotal': 'Total requests',
        'panel.tokensToday': 'Tokens today',
        'panel.tokensTotal': 'Total tokens',
        'panel.updated': 'Updated',
        'panel.refresh': 'Refresh',
        'panel.refreshing': 'Refreshing…',
        'panel.loading': 'Loading…',
        'panel.retry': 'Retry',
        'panel.emptyTitle': 'No API key configured',
        'panel.emptyBody': 'Add your relay API key to this plugin’s config (profile cordis.patch.yml, config.apiKey), then restart DSH.',
        'panel.errorGeneric': 'Could not read the balance: {error}',
        'panel.errorHttp': 'Relay returned HTTP {status}. Check the API key.',
        'panel.errorNetwork': 'Cannot reach the relay. Check the network / base URL.',
        'panel.errorRateLimited': 'Too many requests — the relay asked us to slow down. Wait a moment and retry.',
        'panel.errorRelay': 'The relay had a temporary problem: {error}',
        'panel.errorNoKey': 'No API key configured.',
        'panel.lowBalance': 'Balance is low (under $1).',
        'panel.manualActive': 'Manual remaining {base} − used since saving {used}',
        'panel.manualClear': 'Clear',
        'panel.manualHeroNote': 'Manual balance — this key’s usage since saving is subtracted',
        'panel.manualHint': 'Enter the account’s current remaining balance as shown on the relay dashboard (same currency as the panel). The panel subtracts what this key uses after you save it. Re-enter it after a top-up or when you switch keys.',
        'panel.manualKeyChanged': 'The key changed, so the saved manual balance no longer applies. Enter the account’s current remaining balance again.',
        'panel.manualPlaceholder': 'e.g. 3.99',
        'panel.manualSave': 'Save',
        'panel.manualTitle': 'Manual remaining balance',
        'panel.manualWaiting': 'Saved {base}. Usage will be subtracted once the next reading arrives.',
        'panel.overrideActive': 'Using the key entered here',
        'panel.overrideApiKey': 'API Key',
        'panel.overrideBaseURL': 'API address',
        'panel.overrideClear': 'Clear',
        'panel.overrideHint': 'Check another relay address or key here without editing the config file. The panel then shows that key’s remaining balance and total used. Leave both fields empty to use the config.',
        'panel.overrideSave': 'Save',
        'panel.overrideTitle': 'Relay connection',
        'panel.unlimited': 'Unlimited quota',
        'panel.unlimitedNote': 'This key has no quota limit',
        'panel.usageSection': 'Usage',
        'panel.tokenSection': 'Token',
        'panel.usedPercent': 'This key used {pct}%',
        'panel.perMillion': 'Avg per 1M tokens',
        'panel.subRequestsTotal': 'Total {n} requests',
        'panel.subRequestsToday': '{n} requests today',
        'panel.subPerMillion': '{money} per 1M tokens',
        'panel.expires': 'Expires',
        'panel.neverExpires': 'Never expires',
        'panel.models': 'Models',
        'panel.justNow': 'just now',
        'panel.secondsAgo': '{n}s ago',
        'panel.minutesAgo': '{n} min ago',
        'panel.hoursAgo': '{n} h ago',
        'panel.notAvailable': '—',
        'panel.updateTitle': 'Plugin update',
        'panel.updateCurrent': 'Current version {version}',
        'panel.updateLatest': 'Latest version {version}',
        'panel.updateCheck': 'Check for updates',
        'panel.updateChecking': 'Checking for updates…',
        'panel.updateUpToDate': 'You are on the latest version.',
        'panel.updateAvailable': 'New version {version} available',
        'panel.updateTo': 'Update to {version}',
        'panel.updateDownloading': 'Downloading the new version…',
        'panel.updateDone': 'Updated to {version}. Restart DSH to use it. Your API key and settings are untouched.',
        'panel.updateError': 'Update failed: {error}',
      },
      zh: {
        'rail.label': '中转余额',
        'panel.title': '中转余额',
        'panel.balance': '剩余额度',
        'panel.used': '此 Key 累计已用',
        'panel.today': '今日实扣',
        'panel.requestsToday': '今日请求',
        'panel.requestsTotal': '累计请求',
        'panel.tokensToday': '今日 token',
        'panel.tokensTotal': '累计 token',
        'panel.updated': '更新于',
        'panel.refresh': '刷新',
        'panel.refreshing': '刷新中…',
        'panel.loading': '加载中…',
        'panel.retry': '重试',
        'panel.emptyTitle': '还没有填 API Key',
        'panel.emptyBody': '在 profile 的 cordis.patch.yml 里给本插件加 config.apiKey（见 README），然后重启 DSH。',
        'panel.errorGeneric': '读不到余额：{error}',
        'panel.errorHttp': '中转站返回 HTTP {status}，检查一下 API Key 是否正确。',
        'panel.errorNetwork': '连不上中转站，检查网络 / base URL。',
        'panel.errorRateLimited': '请求太频繁了，中转站让慢一点，等一下再试。',
        'panel.errorRelay': '中转站暂时出了点问题：{error}',
        'panel.errorNoKey': '还没有填 API Key。',
        'panel.lowBalance': '余额偏低（低于 $1）。',
        'panel.manualActive': '手动剩余额度 {base} − 自填写后已用 {used}',
        'panel.manualClear': '清除',
        'panel.manualHeroNote': '手动剩余额度，按此 Key 填写后的用量扣减',
        'panel.manualHint': '填中转站后台显示的账号当前剩余额度（和面板同一个币种）。保存后，面板按此 Key 之后的使用量自动扣减。充值或换 Key 后请重新填写。',
        'panel.manualKeyChanged': 'Key 已更换，之前填的手动剩余额度已失效，请重新填写账号当前剩余额度。',
        'panel.manualPlaceholder': '例如 3.99',
        'panel.manualSave': '保存',
        'panel.manualTitle': '手动剩余额度',
        'panel.manualWaiting': '已填 {base}，下次读到用量后开始扣减。',
        'panel.overrideActive': '正在使用这里填的 Key',
        'panel.overrideApiKey': 'API Key',
        'panel.overrideBaseURL': 'API 地址',
        'panel.overrideClear': '清除',
        'panel.overrideHint': '在这里填另一个中转站地址 / Key 来查看，不用改配置文件。填了之后面板显示该 Key 的剩余额度与累计已用。两项都留空就用配置里的。',
        'panel.overrideSave': '保存',
        'panel.overrideTitle': '中转站连接',
        'panel.unlimited': '额度不限',
        'panel.unlimitedNote': '此 Key 额度不限',
        'panel.usageSection': '用量',
        'panel.tokenSection': '令牌',
        'panel.usedPercent': '此 Key 已用 {pct}%',
        'panel.perMillion': '每百万 token 均价',
        'panel.subRequestsTotal': '累计 {n} 次请求',
        'panel.subRequestsToday': '今日 {n} 次请求',
        'panel.subPerMillion': '每百万 token {money}',
        'panel.expires': '到期',
        'panel.neverExpires': '永不过期',
        'panel.models': '可用模型',
        'panel.justNow': '刚刚',
        'panel.secondsAgo': '{n} 秒前',
        'panel.minutesAgo': '{n} 分钟前',
        'panel.hoursAgo': '{n} 小时前',
        'panel.notAvailable': '—',
        'panel.updateTitle': '插件更新',
        'panel.updateCurrent': '当前版本 {version}',
        'panel.updateLatest': '最新版本 {version}',
        'panel.updateCheck': '检查更新',
        'panel.updateChecking': '正在检查更新…',
        'panel.updateUpToDate': '已是最新版本。',
        'panel.updateAvailable': '发现新版 {version}',
        'panel.updateTo': '更新到 {version}',
        'panel.updateDownloading': '正在下载新版…',
        'panel.updateDone': '已更新到 {version}，重启 DSH 后生效。API Key 与设置不受影响。',
        'panel.updateError': '更新失败：{error}',
      },
    }

    /**
     * Resolve one key, with the English column as the fallback.
     * `{name}` placeholders are replaced from `vars`.
     */
    function text(translate, key, vars) {
      let value
      if (typeof translate === 'function') {
        const translated = translate(key)
        // The service returns the key itself when nothing is registered.
        if (typeof translated === 'string' && translated !== key) value = translated
      }
      if (value === undefined) value = TEXTS.en[key] ?? key
      if (vars !== undefined) {
        for (const [name, replacement] of Object.entries(vars)) {
          value = value.split(`{${name}}`).join(String(replacement))
        }
      }
      return value
    }

    /** $ with 4 decimals under $1, 2 above (same as dsh-gateway-wallet). ¥ for CNY stations. */
    function fmtMoney(value, currency) {
      if (value === undefined || value === null) return '—'
      const n = Number(value)
      if (!Number.isFinite(n)) return '—'
      const symbol = currency === 'CNY' ? '¥' : '$'
      return n < 1 ? `${symbol}${n.toFixed(4)}` : `${symbol}${n.toFixed(2)}`
    }

    function fmtNum(value) {
      if (value === undefined || value === null) return '—'
      const n = Number(value)
      if (!Number.isFinite(n)) return '—'
      return n.toLocaleString()
    }

    function fmtAgo(ms, translate) {
      if (ms === null || ms === undefined) return text(translate, 'panel.notAvailable')
      const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000))
      // Seconds, not "just now": the footer is how the user sees the number
      // is live, so show the real age of the reading.
      if (seconds < 60) return text(translate, 'panel.secondsAgo', { n: seconds })
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return text(translate, 'panel.minutesAgo', { n: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return text(translate, 'panel.hoursAgo', { n: hours })
      return new Date(ms).toLocaleString()
    }

    function fmtDate(ms) {
      if (ms === undefined || ms === null) return '—'
      return new Date(ms).toLocaleDateString()
    }

    /**
     * The manually entered account remaining balance, in the panel's local
     * storage. The relay API only reports this key's numbers, never the
     * account's, so the account balance has to come from the user (the relay
     * dashboard). Shape: { remaining, baseUsed, keySuffix, savedAt }.
     * `remaining` is the account balance the user entered; `baseUsed` is
     * this key's used value at the moment it was saved, so later readings
     * subtract only what the key used after the save; `keySuffix` records
     * which key the baseline belongs to.
     */
    const MANUAL_REMAINING_KEY = 'dsh-relay-balance:manualRemaining'
    /** Legacy "manual total topped up" value; no longer used, removed on read. */
    const MANUAL_BASE_KEY = 'dsh-relay-balance:manualBase'

    function readManualRemaining() {
      try {
        window.localStorage.removeItem(MANUAL_BASE_KEY)
        const raw = window.localStorage.getItem(MANUAL_REMAINING_KEY)
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return null
        const remaining = Number(parsed.remaining)
        if (!Number.isFinite(remaining) || remaining < 0) return null
        const baseUsed = parsed.baseUsed === null || parsed.baseUsed === undefined ? null : Number(parsed.baseUsed)
        return {
          remaining,
          baseUsed: Number.isFinite(baseUsed) && baseUsed >= 0 ? baseUsed : null,
          keySuffix: typeof parsed.keySuffix === 'string' ? parsed.keySuffix : null,
          savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : null,
        }
      } catch {
        return null
      }
    }

    function writeManualRemaining(value) {
      try {
        if (value === null) window.localStorage.removeItem(MANUAL_REMAINING_KEY)
        else window.localStorage.setItem(MANUAL_REMAINING_KEY, JSON.stringify(value))
      } catch {
        // Storage may be unavailable; the panel simply falls back to the relay balance.
      }
    }

    /** What this key has used since the manual remaining was saved (currency), or null if unknown. */
    function manualUsedDelta(manual, usedValue) {
      if (manual === null || usedValue === undefined || usedValue === null) return null
      if (manual.baseUsed === null || manual.baseUsed === undefined) return 0
      return Math.max(0, usedValue - manual.baseUsed)
    }

    /** Remaining balance implied by the manual anchor, or null when no manual balance is set. */
    function manualComputedRemaining(manual, usedValue) {
      if (manual === null) return null
      const delta = manualUsedDelta(manual, usedValue)
      if (delta === null) return manual.remaining
      return manual.remaining - delta
    }

    /** True when the key in use is no longer the one the manual balance was saved for. */
    function manualKeyChanged(manual, keyHint) {
      return manual !== null && manual.keySuffix !== null && manual.keySuffix !== undefined
        && keyHint !== undefined && keyHint !== null && manual.keySuffix !== keyHint
    }

    /** The panel-entered relay address / key, also in local storage. */
    const OVERRIDE_KEY = 'dsh-relay-balance:override'

    function readOverride() {
      try {
        const raw = window.localStorage.getItem(OVERRIDE_KEY)
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return null
        const baseURL = typeof parsed.baseURL === 'string' ? parsed.baseURL.trim() : ''
        const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : ''
        if (baseURL === '' && apiKey === '') return null
        return { baseURL, apiKey }
      } catch {
        return null
      }
    }

    function writeOverride(value) {
      try {
        if (value === null) window.localStorage.removeItem(OVERRIDE_KEY)
        else window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(value))
      } catch {
        // Storage may be unavailable; the panel simply uses the config key.
      }
    }

    /** Headers carrying the panel-entered relay address / key, if any. */
    function overrideHeaders() {
      const ov = readOverride()
      if (ov === null) return {}
      const headers = {}
      if (ov.baseURL !== '') headers['X-Relay-Base-URL'] = ov.baseURL
      if (ov.apiKey !== '') headers['X-Relay-Key'] = ov.apiKey
      return headers
    }

    /**
     * The wallet glyph for the rail. Polls the same route on its own so the
     * red low-balance dot is visible even when the panel is closed.
     * @param {{size: number, active: boolean}} props - owner props.
     */
    function BalanceIcon({ size, active }) {
      const [low, setLow] = React.useState(false)
      React.useEffect(() => {
        let alive = true
        const check = async () => {
          try {
            const response = await fetch(ROUTE, { headers: overrideHeaders() })
            const data = await response.json().catch(() => ({}))
            if (alive && data && data.ok === true && typeof data.balanceUsd === 'number') {
              setLow(data.balanceUsd < LOW_BALANCE_USD)
            }
          } catch {
            // The dot simply stays off when the route is unreachable.
          }
        }
        check()
        const timer = setInterval(check, 60000)
        return () => { alive = false; clearInterval(timer) }
      }, [])
      return h(
        'span',
        { style: { position: 'relative', display: 'inline-block', width: size, height: size } },
        h(
          'svg',
          {
            viewBox: '0 0 24 24',
            width: size,
            height: size,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
            style: { display: 'block', opacity: active ? 1 : 0.85 },
          },
          h('path', { d: 'M20 7H5a2 2 0 0 1 0-4h13v4' }),
          h('path', { d: 'M20 7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5' }),
          h('circle', { cx: 17, cy: 14, r: 1.4, fill: 'currentColor', stroke: 'none' }),
        ),
        low
          ? h('span', {
              style: {
                position: 'absolute',
                top: -2,
                right: -2,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--dsw-alias-state-error-primary, #d33)',
                border: '1px solid var(--dsw-alias-bg-base, #fff)',
              },
            })
          : null,
      )
    }

    /**
     * The panel behind the rail entry.
     * @param {{translate?: (key: string) => string}} props - seat props.
     */
    function BalancePanel({ translate }) {
      ensureCss()
      const [data, setData] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [updatedAt, setUpdatedAt] = React.useState(null)
      const [refreshSeconds, setRefreshSeconds] = React.useState(30)
      const [manualRemaining, setManualRemaining] = React.useState(() => readManualRemaining())
      const [manualInput, setManualInput] = React.useState(() => {
        const initial = readManualRemaining()
        return initial === null ? '' : String(initial.remaining)
      })
      const [override, setOverride] = React.useState(() => readOverride())
      const [overrideBaseInput, setOverrideBaseInput] = React.useState(() => readOverride()?.baseURL ?? '')
      const [overrideKeyInput, setOverrideKeyInput] = React.useState(() => readOverride()?.apiKey ?? '')

      // fresh=true asks the Host for a live relay read, bypassing its 30s
      // cache (the manual refresh / retry buttons). The auto path calls
      // load() with no argument and stays on the cache.
      const load = React.useCallback(async (fresh = false) => {
        setLoading(true)
        try {
          const response = await fetch(fresh ? `${ROUTE}?fresh=1` : ROUTE, { headers: overrideHeaders() })
          const body = await response.json().catch(() => ({}))
          if (body && body.ok === true) {
            setData(body)
            setError(null)
            setDetail(null)
            // Use the Host's fetch time, so a cached result shows its real age.
            setUpdatedAt(typeof body.fetchedAt === 'number' ? body.fetchedAt : Date.now())
            if (typeof body.refreshSeconds === 'number' && body.refreshSeconds >= 10) {
              setRefreshSeconds(body.refreshSeconds)
            }
            // If a manual remaining was saved before any reading arrived, its
            // baseline is still empty: anchor it to this first reading's used
            // value (and the key it came from) so the delta starts at zero.
            const usedValue = body.usedDisplay ?? body.usedUsd
            if (typeof usedValue === 'number') {
              const manual = readManualRemaining()
              if (manual !== null && (manual.baseUsed === null || manual.baseUsed === undefined)) {
                const anchored = {
                  ...manual,
                  baseUsed: usedValue,
                  keySuffix: manual.keySuffix ?? (typeof body.keyHint === 'string' ? body.keyHint : null),
                }
                writeManualRemaining(anchored)
                setManualRemaining(anchored)
              }
            }
          } else {
            setData(null)
            setError(body && typeof body.error === 'string' ? body.error : 'unknown')
            setDetail(body && typeof body.detail === 'string' ? body.detail : null)
          }
        } catch {
          setData(null)
          setError('network')
          setDetail(null)
        } finally {
          setLoading(false)
        }
      }, [])

      const saveOverride = () => {
        const baseURL = overrideBaseInput.trim()
        let apiKey = overrideKeyInput.trim()
        // Strip surrounding quotes if the key was pasted with them
        // ("sk-..." / 'sk-...'): the relay would reject the quotes as part
        // of the key. (The config path does the same in the Host.)
        if (apiKey.length >= 2) {
          const first = apiKey[0]
          const last = apiKey[apiKey.length - 1]
          if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            apiKey = apiKey.slice(1, -1).trim()
          }
        }
        if (baseURL !== '' && !/^https?:\/\//i.test(baseURL)) return
        const next = baseURL === '' && apiKey === '' ? null : { baseURL, apiKey }
        setOverride(next)
        writeOverride(next)
        load(true)
      }

      const clearOverride = () => {
        setOverride(null)
        setOverrideBaseInput('')
        setOverrideKeyInput('')
        writeOverride(null)
        load(true)
      }

      // One-click update: the Host compares the installed version with the
      // repo's main branch and, on apply, downloads the new files. The new
      // code takes effect on the next DSH start (the desktop profile does
      // not hot-reload plugin code); the panel says so after a successful
      // download instead of pretending the update is already live.
      const [updateInfo, setUpdateInfo] = React.useState(null)
      const [updateBusy, setUpdateBusy] = React.useState(false)
      const [updatePhase, setUpdatePhase] = React.useState('idle')
      const [updateError, setUpdateError] = React.useState(null)

      const checkUpdate = React.useCallback(async () => {
        setUpdateBusy(true)
        setUpdatePhase('checking')
        setUpdateError(null)
        try {
          const response = await fetch(UPDATE_CHECK_ROUTE)
          const body = await response.json().catch(() => ({}))
          if (body && body.ok === true) {
            setUpdateInfo({ current: body.current, latest: body.latest, updateAvailable: body.updateAvailable === true })
            setUpdatePhase(body.updateAvailable === true ? 'available' : 'up-to-date')
          } else {
            setUpdateError(body && typeof body.error === 'string' ? body.error : 'unknown')
            setUpdatePhase('error')
          }
        } catch {
          setUpdateError('network')
          setUpdatePhase('error')
        } finally {
          setUpdateBusy(false)
        }
      }, [])

      const applyUpdate = React.useCallback(async () => {
        setUpdateBusy(true)
        setUpdatePhase('downloading')
        setUpdateError(null)
        try {
          const response = await fetch(UPDATE_APPLY_ROUTE, { method: 'POST' })
          const body = await response.json().catch(() => ({}))
          if (body && body.ok === true && body.updated === true) {
            setUpdateInfo((prev) => (prev === null ? prev : { ...prev, current: body.version, latest: body.version, updateAvailable: false }))
            setUpdatePhase('done')
          } else if (body && body.ok === true) {
            setUpdatePhase('up-to-date')
          } else {
            setUpdateError(body && typeof body.error === 'string' ? body.error : 'unknown')
            setUpdatePhase('error')
          }
        } catch {
          setUpdateError('network')
          setUpdatePhase('error')
        } finally {
          setUpdateBusy(false)
        }
      }, [])

      // Check once when the panel opens, so an available update is visible
      // without an extra tap. The Host caches the GitHub answer for 5 min.
      React.useEffect(() => { checkUpdate() }, [checkUpdate])

      // Auto-refresh, cleaned up on unmount; the interval follows the
      // refreshSeconds the Host route reports (default 30s).
      React.useEffect(() => {
        load()
        const timer = setInterval(load, refreshSeconds * 1000)
        return () => clearInterval(timer)
      }, [load, refreshSeconds])

      const refreshButton = h(
        'button',
        {
          type: 'button',
          disabled: loading,
          onClick: () => load(true),
          className: 'rb_iconBtn',
          title: text(translate, 'panel.refresh'),
          'aria-label': text(translate, 'panel.refresh'),
        },
        h(
          'svg',
          {
            viewBox: '0 0 24 24',
            width: 14,
            height: 14,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
            style: { display: 'block' },
          },
          h('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
          h('path', { d: 'M21 3v6h-6' }),
        ),
      )

      const header = h(
        'div',
        { className: 'rb_header' },
        h('div', { className: 'rb_title' }, text(translate, 'panel.title')),
        refreshButton,
      )

      const footer = updatedAt === null
        ? null
        : h('div', { className: 'rb_footer' },
            `${text(translate, 'panel.updated')} ${fmtAgo(updatedAt, translate)}`)

      // Panel-entered relay address / key: saved in local storage and sent
      // to the Host as headers, so another key can be checked without
      // editing the config file or restarting DSH. This section lives at
      // panel level (not inside the data branch) so the address and key can
      // still be entered or corrected when the panel is showing an error or
      // the "no API key" empty state.
      const overrideSection = h(
        'div',
        { className: 'rb_setCard' },
        h('span', { className: 'rb_setTitle' }, text(translate, 'panel.overrideTitle')),
        h('input', {
          type: 'url',
          inputMode: 'url',
          value: overrideBaseInput,
          placeholder: 'https://spanagent.xyz',
          onChange: (event) => setOverrideBaseInput(event.target.value),
          className: 'rb_input rb_inputBlock',
        }),
        h('input', {
          type: 'password',
          value: overrideKeyInput,
          placeholder: 'sk-...',
          autoComplete: 'off',
          onChange: (event) => setOverrideKeyInput(event.target.value),
          className: 'rb_input rb_inputBlock',
        }),
        h(
          'div',
          { className: 'rb_fieldRow' },
          h('button', { type: 'button', onClick: saveOverride, className: 'rb_btn' },
            text(translate, 'panel.overrideSave')),
          override !== null
            ? h('button', { type: 'button', onClick: clearOverride, className: 'rb_btn' },
                text(translate, 'panel.overrideClear'))
            : null,
        ),
        h('div', { className: 'rb_hint' }, text(translate, 'panel.overrideHint')),
        override !== null
          ? h('div', { className: 'rb_hint' }, text(translate, 'panel.overrideActive'))
          : null,
      )

      // Plugin update card: shows the installed version, checks GitHub on
      // open, and offers a one-tap download when a newer version is out.
      // It lives at panel level so it is visible even when the balance
      // itself is in an error or empty state.
      const updateSection = h(
        'div',
        { className: 'rb_setCard' },
        h('span', { className: 'rb_setTitle' }, text(translate, 'panel.updateTitle')),
        updateInfo !== null
          ? h('div', { className: 'rb_hint' },
              text(translate, 'panel.updateCurrent', { version: updateInfo.current }))
          : null,
        updatePhase === 'checking'
          ? h('div', { className: 'rb_hint' }, text(translate, 'panel.updateChecking'))
          : updatePhase === 'available' && updateInfo !== null
            ? h('div', { className: 'rb_hint' },
                text(translate, 'panel.updateAvailable', { version: updateInfo.latest }))
            : updatePhase === 'up-to-date'
              ? h('div', { className: 'rb_hint' }, text(translate, 'panel.updateUpToDate'))
              : updatePhase === 'downloading'
                ? h('div', { className: 'rb_hint' }, text(translate, 'panel.updateDownloading'))
                : updatePhase === 'done' && updateInfo !== null
                  ? h('div', { className: 'rb_hint' },
                      text(translate, 'panel.updateDone', { version: updateInfo.current }))
                  : updatePhase === 'error'
                    ? h('div', { className: 'rb_hint' },
                        text(translate, 'panel.updateError', { error: updateError ?? 'unknown' }))
                    : null,
        h(
          'div',
          { className: 'rb_fieldRow' },
          updatePhase === 'available' && updateInfo !== null
            ? h('button', { type: 'button', onClick: applyUpdate, disabled: updateBusy, className: 'rb_btn' },
                text(translate, 'panel.updateTo', { version: updateInfo.latest }))
            : null,
          h('button', { type: 'button', onClick: checkUpdate, disabled: updateBusy, className: 'rb_btn' },
            text(translate, 'panel.updateCheck')),
        ),
      )

      const body = (() => {
        if (loading && data === null && error === null) {
          return h('div', { className: 'rb_note' }, text(translate, 'panel.loading'))
        }
        if (error === 'no-key') {
          return h(
            'div',
            { className: 'rb_setCard' },
            h('div', { className: 'rb_emptyTitle' }, text(translate, 'panel.emptyTitle')),
            h('div', { className: 'rb_hint' }, text(translate, 'panel.emptyBody')),
          )
        }
        if (error !== null) {
          const message = error === 'network'
            ? text(translate, 'panel.errorNetwork')
            : error === 'rate-limited'
              ? text(translate, 'panel.errorRateLimited')
              : error === 'relay'
                ? text(translate, 'panel.errorRelay', { error: detail ?? 'unknown' })
                : error.startsWith('http:')
                  ? text(translate, 'panel.errorHttp', { status: error.slice(5) })
                  : text(translate, 'panel.errorGeneric', { error })
          return h(
            'div',
            { className: 'rb_errorCard' },
            h('div', { className: 'rb_errorText' }, message),
            h('button',
              { type: 'button', onClick: () => load(true), className: 'rb_btn', style: { alignSelf: 'flex-start' } },
              text(translate, 'panel.retry')),
          )
        }
        if (data === null) return null

        // Manual remaining balance: the account's current remaining, entered
        // by hand, minus what this key has used since it was saved. The relay
        // API only reports this key's numbers, so the account balance itself
        // has to come from the user (the relay dashboard). Falls back to the
        // key's own remaining when no manual balance is set or the key
        // changed since it was saved.
        const usedValue = data.usedDisplay ?? data.usedUsd
        const manualValid = manualRemaining !== null && !manualKeyChanged(manualRemaining, data.keyHint)
        const manualComputed = manualValid ? manualComputedRemaining(manualRemaining, usedValue) : null
        const displayBalance = manualComputed !== null
          ? manualComputed
          : (data.balanceDisplay ?? data.balanceUsd)
        const isLow = typeof displayBalance === 'number' && displayBalance < LOW_BALANCE_USD
        const hasBalance = displayBalance !== undefined && displayBalance !== null
        const balanceText = hasBalance
          ? fmtMoney(displayBalance, data.currency)
          : data.unlimited === true
            ? text(translate, 'panel.unlimited')
            : '—'
        const todayText = fmtMoney(data.todayDisplay ?? data.todayUsd, data.currency)
        const usedText = fmtMoney(usedValue, data.currency)

        // Usage bar: this key's used share of its own total (remaining +
        // used), from the relay's numbers. Hidden for unlimited keys or
        // when either number is missing.
        const relayBalance = data.balanceDisplay ?? data.balanceUsd
        const barTotal = (typeof relayBalance === 'number' && typeof usedValue === 'number')
          ? relayBalance + usedValue
          : undefined
        const barFraction = barTotal !== undefined && barTotal > 0 ? usedValue / barTotal : undefined
        const barFillClass = barFraction === undefined
          ? 'rb_barFill'
          : barFraction >= 0.9
            ? 'rb_barFill critical'
            : barFraction >= 0.7
              ? 'rb_barFill warn'
              : 'rb_barFill'

        const who = [data.username, data.keyName].filter((part) => part !== undefined).join(' · ')
        const perMillion = typeof data.todayUsd === 'number' && typeof data.tokensToday === 'number' && data.tokensToday > 0
          ? data.todayUsd / data.tokensToday * 1e6
          : undefined
        const usageRows = []
        if (typeof data.requestsToday === 'number') {
          usageRows.push([text(translate, 'panel.requestsToday'), fmtNum(data.requestsToday)])
        }
        if (typeof data.tokensToday === 'number') {
          usageRows.push([text(translate, 'panel.tokensToday'), fmtNum(data.tokensToday)])
        }
        if (typeof data.requestsTotal === 'number') {
          usageRows.push([text(translate, 'panel.requestsTotal'), fmtNum(data.requestsTotal)])
        }
        if (perMillion !== undefined) {
          usageRows.push([text(translate, 'panel.perMillion'), fmtMoney(perMillion, data.currency)])
        }
        const tokenRows = []
        if (data.neverExpires === true) {
          tokenRows.push([text(translate, 'panel.expires'), text(translate, 'panel.neverExpires')])
        } else if (data.expiresAt !== undefined) {
          tokenRows.push([text(translate, 'panel.expires'), fmtDate(data.expiresAt)])
        }
        if (Array.isArray(data.modelLimits) && data.modelLimits.length > 0) {
          tokenRows.push([text(translate, 'panel.models'), data.modelLimits.join(' · ')])
        }

        // Manual remaining balance: the account's current remaining, entered
        // by hand. Saving records this key's used value as the baseline, so
        // later readings subtract only what the key used after the save.
        const saveManualRemaining = () => {
          if (manualInput.trim() === '') return
          const n = Number(manualInput)
          if (!Number.isFinite(n) || n < 0) return
          const next = {
            remaining: n,
            baseUsed: typeof usedValue === 'number' ? usedValue : null,
            keySuffix: typeof data.keyHint === 'string' ? data.keyHint : null,
            savedAt: Date.now(),
          }
          setManualRemaining(next)
          writeManualRemaining(next)
        }

        const clearManualRemaining = () => {
          setManualRemaining(null)
          setManualInput('')
          writeManualRemaining(null)
        }

        const manualDelta = manualValid ? manualUsedDelta(manualRemaining, usedValue) : null
        const manualSection = h(
          'div',
          { className: 'rb_setCard rb_mt' },
          h('span', { className: 'rb_setTitle' }, text(translate, 'panel.manualTitle')),
          h(
            'div',
            { className: 'rb_fieldRow' },
            h('input', {
              type: 'number',
              inputMode: 'decimal',
              min: '0',
              step: 'any',
              value: manualInput,
              placeholder: text(translate, 'panel.manualPlaceholder'),
              onChange: (event) => setManualInput(event.target.value),
              className: 'rb_input rb_inputGrow',
            }),
            h('button', { type: 'button', onClick: saveManualRemaining, className: 'rb_btn' },
              text(translate, 'panel.manualSave')),
            manualRemaining !== null
              ? h('button', { type: 'button', onClick: clearManualRemaining, className: 'rb_btn' },
                  text(translate, 'panel.manualClear'))
              : null,
          ),
          h('div', { className: 'rb_hint' }, text(translate, 'panel.manualHint')),
          manualRemaining !== null && !manualValid
            ? h('div', { className: 'rb_warnLine' }, text(translate, 'panel.manualKeyChanged'))
            : manualDelta !== null
              ? h('div', { className: 'rb_hint' },
                  text(translate, 'panel.manualActive', {
                    base: fmtMoney(manualRemaining.remaining, data.currency),
                    used: fmtMoney(manualDelta, data.currency),
                  }))
              : manualRemaining !== null
                ? h('div', { className: 'rb_hint' },
                    text(translate, 'panel.manualWaiting', {
                      base: fmtMoney(manualRemaining.remaining, data.currency),
                    }))
                : null,
        )

        return h(
          'div',
          { className: 'rb_data', ...(loading ? { 'data-loading': '' } : {}) },
          who !== ''
            ? h('div', { className: 'rb_who' }, who)
            : null,
          data.keyHint !== undefined
            ? h('div', { className: 'rb_whoName' }, data.keyHint)
            : null,
          h(
            'div',
            { className: 'rb_stats' },
            h('div', { className: 'rb_stat', ...(isLow ? { 'data-low': '' } : {}) },
              h('div', { className: 'rb_statValue' }, balanceText),
              h('div', { className: 'rb_statLabel' }, text(translate, 'panel.balance'))),
            h('div', { className: 'rb_stat' },
              h('div', { className: 'rb_statValue' }, todayText),
              h('div', { className: 'rb_statLabel' }, text(translate, 'panel.today'))),
            h('div', { className: 'rb_stat' },
              h('div', { className: 'rb_statValue' }, usedText),
              h('div', { className: 'rb_statLabel' }, text(translate, 'panel.used'))),
          ),
          barFraction !== undefined
            ? h(
                'div',
                null,
                h('div', { className: 'rb_bar' },
                  h('div', { className: barFillClass, style: { width: `${Math.min(100, barFraction * 100)}%` } })),
                h('div', { className: 'rb_barNote' },
                  text(translate, 'panel.usedPercent', { pct: Math.round(barFraction * 100) })),
              )
            : null,
          manualValid && manualComputed !== null
            ? h('div', { className: 'rb_noteLine' }, text(translate, 'panel.manualHeroNote'))
            : null,
          data.unlimited === true && hasBalance
            ? h('div', { className: 'rb_noteLine' }, text(translate, 'panel.unlimitedNote'))
            : null,
          isLow
            ? h('div', { className: 'rb_noteLine warn' }, text(translate, 'panel.lowBalance'))
            : null,
          usageRows.length > 0
            ? h(
                'div',
                { className: 'rb_section' },
                h('div', { className: 'rb_sectionTitle' }, text(translate, 'panel.usageSection')),
                h(
                  'div',
                  { className: 'rb_rows' },
                  usageRows.map(([label, value]) => h(
                    'div',
                    { key: label, className: 'rb_row' },
                    h('span', { className: 'rb_rowName' }, label),
                    h('span', { className: 'rb_rowValue' }, value),
                  )),
                ),
              )
            : null,
          tokenRows.length > 0
            ? h(
                'div',
                { className: 'rb_section' },
                h('div', { className: 'rb_sectionTitle' }, text(translate, 'panel.tokenSection')),
                h(
                  'div',
                  { className: 'rb_rows' },
                  tokenRows.map(([label, value], index) => h(
                    'div',
                    { key: label, className: 'rb_row' },
                    h('span', { className: 'rb_rowName' }, label),
                    h('span',
                      { className: index === tokenRows.length - 1 && Array.isArray(data.modelLimits) && data.modelLimits.length > 0 ? 'rb_rowValue rb_rowValueWrap' : 'rb_rowValue' },
                      value),
                  )),
                ),
              )
            : null,
          manualSection,
        )
      })()

      return h(
        'div',
        { className: 'rb_root' },
        header,
        body,
        overrideSection,
        updateSection,
        footer,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // Register both language columns first: the rail label is read on every
        // projection, so a dictionary arriving after registration would show the
        // key until the next locale change.
        let translate
        let disposers = []
        if (ctx.locale !== undefined && ctx.locale !== null) {
          for (const [locale, dict] of Object.entries(TEXTS)) {
            try {
              disposers.push(ctx.locale.register(NS, locale, dict))
            } catch (error) {
              console.error(`dsh-relay-balance: registering the ${locale} dictionary failed`, error)
            }
          }
          try {
            translate = ctx.locale.bind(NS)
          } catch (error) {
            console.error('dsh-relay-balance: binding the locale namespace failed', error)
          }
        }

        // The two seats are registered from the innermost callback, exactly as
        // the shipped panels do: the rail entry and the panel it opens appear
        // together or not at all.
        try {
          if (ctx.slots === undefined || ctx.slots === null) {
            console.error('dsh-relay-balance: this DSH has no slots service; the panel stays unmounted')
            for (const dispose of disposers) { try { dispose() } catch { /* ignore */ } }
            return
          }
          ctx.slots.inject('main', () =>
            ctx.slots.inject('sidebar.panellist', () => {
              const stopMain = ctx.slots.register(
                { name: 'main', key: PANEL_ID, inject: () => ({ translate }) },
                BalancePanel,
              )
              const stopIcon = ctx.slots.register(
                {
                  name: 'sidebar.panellist',
                  id: PANEL_ID,
                  order: 70,
                  // A thunk is re-read on every projection, so the label follows
                  // the active locale without re-registering.
                  label: () => text(translate, 'rail.label'),
                },
                BalanceIcon,
              )
              return () => {
                if (typeof stopIcon === 'function') stopIcon()
                if (typeof stopMain === 'function') stopMain()
                for (const dispose of disposers) {
                  if (typeof dispose === 'function') { try { dispose() } catch { /* ignore */ } }
                }
                disposers = []
              }
            }),
          )
        } catch (error) {
          console.error('dsh-relay-balance: registering the balance panel failed', error)
          for (const dispose of disposers) { try { dispose() } catch { /* ignore */ } }
        }
      },
    }
  },
})
