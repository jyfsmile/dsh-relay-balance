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
    /** Locale namespace owned by this plugin. */
    const NS = 'dsh-relay-balance'
    /** Below this balance (USD) the rail icon shows a red dot. */
    const LOW_BALANCE_USD = 1

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
        'panel.used': 'Total used',
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
        'panel.unlimited': 'Unlimited quota',
        'panel.expires': 'Expires',
        'panel.neverExpires': 'Never expires',
        'panel.models': 'Models',
        'panel.justNow': 'just now',
        'panel.minutesAgo': '{n} min ago',
        'panel.hoursAgo': '{n} h ago',
        'panel.notAvailable': '—',
      },
      zh: {
        'rail.label': '中转余额',
        'panel.title': '中转余额',
        'panel.balance': '剩余额度',
        'panel.used': '累计已用',
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
        'panel.unlimited': '额度不限',
        'panel.expires': '到期',
        'panel.neverExpires': '永不过期',
        'panel.models': '可用模型',
        'panel.justNow': '刚刚',
        'panel.minutesAgo': '{n} 分钟前',
        'panel.hoursAgo': '{n} 小时前',
        'panel.notAvailable': '—',
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
      if (seconds < 60) return text(translate, 'panel.justNow')
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
            const response = await fetch(ROUTE)
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
      const [data, setData] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [updatedAt, setUpdatedAt] = React.useState(null)
      const [refreshSeconds, setRefreshSeconds] = React.useState(60)

      const load = React.useCallback(async () => {
        setLoading(true)
        try {
          const response = await fetch(ROUTE)
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

      // Auto-refresh, cleaned up on unmount; the interval follows the
      // refreshSeconds the Host route reports (default 60s).
      React.useEffect(() => {
        load()
        const timer = setInterval(load, refreshSeconds * 1000)
        return () => clearInterval(timer)
      }, [load, refreshSeconds])

      // --- shared card chrome (DSH tokens with plain fallbacks) ---
      const cardStyle = {
        background: 'var(--dsw-alias-bg-elevated, rgba(128,128,128,0.06))',
        border: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.18))',
        borderRadius: '12px',
      }
      const labelStyle = { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' }
      const valueStyle = { fontSize: '16px', fontWeight: 600, lineHeight: 1.3, color: 'var(--dsw-alias-label-primary)' }

      const refreshButton = h(
        'button',
        {
          type: 'button',
          disabled: loading,
          onClick: load,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 500,
            borderRadius: '999px',
            border: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.25))',
            background: loading
              ? 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12))'
              : 'var(--dsw-alias-button-elevated-fill, rgba(128,128,128,0.08))',
            color: 'var(--dsw-alias-label-primary)',
            cursor: loading ? 'default' : 'pointer',
          },
        },
        loading ? text(translate, 'panel.refreshing') : text(translate, 'panel.refresh'),
      )

      const header = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
        h('div', { style: { fontSize: '15px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } },
          text(translate, 'panel.title')),
        refreshButton,
      )

      const footer = updatedAt === null
        ? null
        : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))' } },
            `${text(translate, 'panel.updated')} ${fmtAgo(updatedAt, translate)}`)

      const body = (() => {
        if (loading && data === null && error === null) {
          return h('div', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } },
            text(translate, 'panel.loading'))
        }
        if (error === 'no-key') {
          return h(
            'div',
            { style: { ...cardStyle, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px' } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } },
              text(translate, 'panel.emptyTitle')),
            h('div', { style: { fontSize: '13px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' } },
              text(translate, 'panel.emptyBody')),
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
            {
              style: {
                ...cardStyle,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                borderColor: 'var(--dsw-alias-state-error-primary, rgba(211,51,51,0.4))',
                background: 'var(--dsw-alias-state-error-bg, rgba(211,51,51,0.06))',
              },
            },
            h('div', { style: { fontSize: '13px', lineHeight: 1.6, color: 'var(--dsw-alias-state-error-primary, #d33)' } }, message),
            h('button',
              {
                type: 'button',
                onClick: load,
                style: {
                  alignSelf: 'flex-start',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 500,
                  borderRadius: '999px',
                  border: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.25))',
                  background: 'var(--dsw-alias-button-elevated-fill, rgba(128,128,128,0.08))',
                  color: 'var(--dsw-alias-label-primary)',
                  cursor: 'pointer',
                },
              },
              text(translate, 'panel.retry')),
          )
        }
        if (data === null) return null

        const isLow = typeof data.balanceUsd === 'number' && data.balanceUsd < LOW_BALANCE_USD
        const balanceText = data.unlimited === true
          ? text(translate, 'panel.unlimited')
          : fmtMoney(data.balanceDisplay ?? data.balanceUsd, data.currency)

        // Hero: balance on a card, with a blue ¥ chip and the key hint.
        const hero = h(
          'div',
          { style: { ...cardStyle, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              h('span', {
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  background: 'var(--dsw-alias-state-info-primary, #2f7cf6)',
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 700,
                },
              }, data.currency === 'CNY' ? '¥' : '$'),
              h('span', { style: labelStyle }, text(translate, 'panel.balance')),
            ),
            data.keyHint !== undefined
              ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))' } }, data.keyHint)
              : null,
          ),
          h('div', {
            style: {
              fontSize: '30px',
              fontWeight: 700,
              lineHeight: 1.2,
              color: isLow
                ? 'var(--dsw-alias-state-error-primary, #d33)'
                : 'var(--dsw-alias-label-primary)',
            },
          }, balanceText),
          isLow
            ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #d33)' } },
                text(translate, 'panel.lowBalance'))
            : null,
          data.username !== undefined || data.keyName !== undefined
            ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
                [data.username, data.keyName].filter((part) => part !== undefined).join(' · '))
            : null,
        )

        // 2x2 stat grid, same card chrome as the hero.
        const stats = [
          [text(translate, 'panel.used'), fmtMoney(data.usedDisplay ?? data.usedUsd, data.currency)],
          [text(translate, 'panel.today'), fmtMoney(data.todayDisplay ?? data.todayUsd, data.currency)],
          [text(translate, 'panel.requestsToday'), fmtNum(data.requestsToday)],
          [text(translate, 'panel.tokensToday'), fmtNum(data.tokensToday)],
        ]
        const grid = h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } },
          stats.map(([label, value]) => h(
            'div',
            { key: label, style: { ...cardStyle, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '2px' } },
            h('span', { style: labelStyle }, label),
            h('span', { style: valueStyle }, value),
          )),
        )

        // Small meta rows under the grid: total requests, expiry, models.
        const metaRows = []
        metaRows.push([text(translate, 'panel.requestsTotal'), fmtNum(data.requestsTotal)])
        if (data.neverExpires === true) {
          metaRows.push([text(translate, 'panel.expires'), text(translate, 'panel.neverExpires')])
        } else if (data.expiresAt !== undefined) {
          metaRows.push([text(translate, 'panel.expires'), fmtDate(data.expiresAt)])
        }
        if (Array.isArray(data.modelLimits) && data.modelLimits.length > 0) {
          metaRows.push([text(translate, 'panel.models'), data.modelLimits.join(', ')])
        }
        const meta = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '2px 4px' } },
          metaRows.map(([label, value]) => h(
            'div',
            { key: label, style: { display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '13px', lineHeight: 1.6 } },
            h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, label),
            h('span', { style: { color: 'var(--dsw-alias-label-primary)', textAlign: 'right' } }, value),
          )),
        )

        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
          hero,
          grid,
          meta,
        )
      })()

      return h(
        'div',
        { style: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' } },
        header,
        body,
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
