/**
 * dsh-workbuddy-credits — browser half.
 *
 * A sidebar panel showing the WorkBuddy credit picture at a glance. Every read
 * goes through this package's own host half, which caches: opening the panel is
 * a memory read, and only the Refresh control asks the billing API again. There
 * is no polling anywhere — a timer that calls the upstream would spend the very
 * quota the panel reports.
 *
 * @module dsh-workbuddy-credits/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-workbuddy-credits',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'workbuddyCredits';
    /** The id shared by the sidebar entry and the main panel it opens. */
    const PANEL_ID = 'workbuddy-credits';
    /** This package's own host route. */
    const ROUTE = '/plugins/dsh-workbuddy-credits/status';
    /** Providers the panel can show; their accounts and credits are separate. */
    const PROVIDERS = ['workbuddy', 'workbuddy-ai'];
    /** Reopening the panel within this window trusts the picture already in hand. */
    const FRESH_MS = 5_000;
    /** Milliseconds in a day. */
    const DAY_MS = 86_400_000;

    const ZH = {
      panel: 'WorkBuddy 积分',
      title: 'WorkBuddy 积分',
      subtitle: '余额按“先到期的先用”扣减，因此真正要盯的是到期分布。',
      providerCn: '国内版',
      providerIntl: '国际版',
      refresh: '刷新',
      refreshing: '正在读取上游计费接口…',
      updatedAt: '更新于 {time}',
      servedFromCache: '（宿主缓存）',
      live: '实时',
      total: '合计余额',
      creditUnit: '积分',
      expiring7d: '7 天内过期',
      expiring24h: '24 小时内',
      expiring3d: '3 天内',
      freeModels: '免费模型',
      packages: '套餐数',
      count: '{n} 个',
      detail: '套餐明细',
      colExpires: '到期时间',
      colRemaining: '剩余',
      colSize: '总量',
      colLeft: '剩余时长',
      colPackage: '套餐',
      expired: '已过期',
      noExpiry: '无到期时间',
      unlimited: '不限量',
      days: '{n} 天',
      gift: '赠送',
      giftHint: '赠送包通常不续期，用不完直接清零。',
      tokenValidUntil: '令牌有效至 {time}',
      domain: '账号域 {domain}',
      warning: '7 天内有 {total} 积分过期（{packages} 个包）',
      warningEarliest: '，最早 {time}',
      refreshFailed: '刷新失败，以下仍是上次成功读取的数据：',
      noExpiryData: '上游没有给出任何到期时间，无法判断（这不等于不会过期）。',
      rateTitle: '倍率参考',
      rateHint: '倍率越低越省。倍率与实际价格的关系由上游决定，只能给量级估算。',
      rate: 'x{value}',
      signedOutTitle: '未登录',
      signedOutBody: '该版 App 从未登录，或没留下插件自留的凭据副本。装好并登录对应桌面 App 后重试。',
      signedOutGeneric: '该版账号当前未登录。',
      unavailableTitle: '已登录，但读取积分失败',
      unavailableBody: '通常是令牌过期或网络问题。',
      errorTitle: '查询失败',
      errorBody: '确认 DSH 在运行、已安装 dsh-workbuddy-connect。',
      retry: '重试',
      loading: '正在读取…',
      empty: '这个账号名下没有任何积分包。',
      enterprise: '企业账号按周期重置额度，没有普通包的到期语义。',
      footnote: '每次手动刷新都会真实调用上游计费接口，因此面板不会自动轮询。',
    };

    const EN = {
      panel: 'WorkBuddy credits',
      title: 'WorkBuddy credits',
      subtitle: 'Balance is spent soonest-expiring first, so the expiry spread is what matters.',
      providerCn: 'CN',
      providerIntl: 'Intl',
      refresh: 'Refresh',
      refreshing: 'Reading the upstream billing API…',
      updatedAt: 'Updated {time}',
      servedFromCache: ' (host cache)',
      live: 'live',
      total: 'Total balance',
      creditUnit: 'credits',
      expiring7d: 'Expiring in 7 days',
      expiring24h: 'Within 24h',
      expiring3d: 'Within 3 days',
      freeModels: 'Free models',
      packages: 'Packages',
      count: '{n}',
      detail: 'Package detail',
      colExpires: 'Expires',
      colRemaining: 'Remaining',
      colSize: 'Size',
      colLeft: 'Time left',
      colPackage: 'Package',
      expired: 'expired',
      noExpiry: 'no expiry',
      unlimited: 'unlimited',
      days: '{n} d',
      gift: 'gift',
      giftHint: 'Gift packages are usually not renewed; unused credits simply reset.',
      tokenValidUntil: 'Token valid until {time}',
      domain: 'Account domain {domain}',
      warning: '{total} credits expire within 7 days ({packages} packages)',
      warningEarliest: ', earliest {time}',
      refreshFailed: 'Refresh failed; the figures below are from the last successful read:',
      noExpiryData: 'The upstream reported no expiry time at all, so nothing can be judged (that is not the same as never expiring).',
      rateTitle: 'Rate reference',
      rateHint: 'Lower is cheaper. The upstream decides how a rate maps to real price, so treat this as an order-of-magnitude guide only.',
      rate: 'x{value}',
      signedOutTitle: 'Not signed in',
      signedOutBody: 'This app version was never signed in, or left no stored credential copy. Install and sign in to the matching desktop app, then retry.',
      signedOutGeneric: 'This account is not signed in.',
      unavailableTitle: 'Signed in, but reading credits failed',
      unavailableBody: 'Usually an expired token or a network problem.',
      errorTitle: 'Query failed',
      errorBody: 'Check that DSH is running and dsh-workbuddy-connect is installed.',
      retry: 'Retry',
      loading: 'Loading…',
      empty: 'This account holds no credit packages.',
      enterprise: 'Enterprise accounts get a quota that resets per period and carry no ordinary package expiry.',
      footnote: 'Every manual refresh really calls the upstream billing API, which is why this panel never polls.',
    };

    // ---------------------------------------------------------------- helpers

    /**
     * Zero-pad a number to two digits.
     * @param value - the number.
     * @returns the padded string.
     */
    function pad2(value) {
      return value < 10 ? `0${value}` : String(value);
    }

    /**
     * Format an epoch-millisecond instant as local `YYYY-MM-DD HH:mm`.
     * @param ms - the instant.
     * @returns the formatted text, or an empty string for a missing instant.
     */
    function formatDateTime(ms) {
      if (!Number.isFinite(ms)) return '';
      const date = new Date(ms);
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    }

    /**
     * Format an epoch-millisecond instant as local `HH:mm:ss`.
     * @param ms - the instant.
     * @returns the formatted text.
     */
    function formatClock(ms) {
      if (!Number.isFinite(ms)) return '';
      const date = new Date(ms);
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
    }

    /**
     * Render a credit amount with thousands separators.
     * @param value - the amount.
     * @returns the formatted text.
     */
    function formatAmount(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      return number.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }

    /**
     * Days remaining until an instant, rounded to one decimal.
     * @param endMs - the expiry instant.
     * @param nowMs - the current instant.
     * @returns the day count, negative once expired.
     */
    function daysUntil(endMs, nowMs) {
      return (endMs - nowMs) / DAY_MS;
    }

    /**
     * Whether a package name reads as a gifted (non-renewing) package.
     * @param name - the package name.
     * @returns true when the name marks it as a gift.
     */
    function isGiftPackage(name) {
      return typeof name === 'string' && /赠送|gift/i.test(name);
    }

    /**
     * One short line for a thrown value.
     * @param error - the thrown value.
     * @returns the message.
     */
    function messageOf(error) {
      return error instanceof Error ? error.message : String(error);
    }

    // ------------------------------------------------------------------ store

    /**
     * The panel's data source, owned by the plugin run rather than by the
     * component, so switching panels away and back shows the last picture
     * immediately instead of flashing an empty shell.
     *
     * It never polls: `ensure()` reads only when the picture is older than
     * {@link FRESH_MS}, and `refresh()` is the one path that asks the host for a
     * real upstream read.
     *
     * @returns the store handle.
     */
    function createStore() {
      const listeners = new Set();
      /** Per-provider last-good payload, so switching back is instant. */
      const cache = new Map();

      let active = PROVIDERS[0];
      let phase = 'idle';
      let data = null;
      let error = null;
      let refreshing = false;
      let loadedAtMs = null;
      /** Monotonic read id; a result whose id is stale is dropped. */
      let seq = 0;
      let snapshot = null;

      /**
       * Rebuild the published snapshot and notify subscribers.
       * @returns nothing.
       */
      function publish() {
        snapshot = { provider: active, phase, data, error, refreshing, loadedAtMs };
        for (const listener of [...listeners]) listener();
      }

      /**
       * Adopt a provider's cached payload without any read.
       * @param provider - the provider key.
       * @returns nothing.
       */
      function adopt(provider) {
        const entry = cache.get(provider);
        data = entry === undefined ? null : entry.data;
        loadedAtMs = entry === undefined ? null : entry.at;
        error = null;
        phase = data === null ? 'idle' : 'ready';
        refreshing = false;
      }

      /**
       * Read one provider through this package's host half.
       * @param provider - the provider key.
       * @param force - whether to ask the host for a real upstream read.
       * @returns a promise settling when the read finished.
       */
      async function load(provider, force) {
        const mine = (seq += 1);
        if (force) refreshing = true;
        else if (data === null) phase = 'loading';
        publish();

        const query = `?provider=${encodeURIComponent(provider)}${force ? '&refresh=1' : ''}`;
        try {
          const response = await fetch(`${ROUTE}${query}`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { accept: 'application/json' },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await response.json();
          if (mine !== seq) return;
          cache.set(provider, { data: body, at: Date.now() });
          if (provider === active) {
            data = body;
            error = null;
            loadedAtMs = Date.now();
            phase = 'ready';
          }
        } catch (failure) {
          if (mine !== seq) return;
          if (provider === active) {
            error = messageOf(failure);
            phase = data === null ? 'error' : 'ready';
          }
        } finally {
          if (mine === seq) {
            refreshing = false;
            publish();
          }
        }
      }

      return {
        getSnapshot() {
          if (snapshot === null) publish();
          return snapshot;
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        /** Read only when the picture is older than the freshness window. */
        ensure() {
          if (data !== null && loadedAtMs !== null && Date.now() - loadedAtMs < FRESH_MS) return;
          void load(active, false);
        },
        /** The manual refresh: a real upstream read, deduped by the host. */
        refresh() {
          void load(active, true);
        },
        /** Switch provider, showing its cached picture at once when present. */
        setProvider(provider) {
          if (provider === active || !PROVIDERS.includes(provider)) return;
          active = provider;
          seq += 1;
          adopt(provider);
          publish();
          void load(provider, false);
        },
      };
    }

    /**
     * Subscribe a component to a store handle.
     * @param store - the store handle.
     * @returns the current snapshot.
     */
    function useStore(store) {
      const [snapshot, setSnapshot] = React.useState(() => store.getSnapshot());
      React.useEffect(() => {
        setSnapshot(store.getSnapshot());
        return store.subscribe(() => setSnapshot(store.getSnapshot()));
      }, [store]);
      return snapshot;
    }

    // ----------------------------------------------------------------- styles

    /**
     * Panel stylesheet. Only `--dsw-alias-*` theme tokens are referenced, so the
     * panel follows the host palette and light/dark switching.
     */
    const CSS = `
.wbc-root{box-sizing:border-box;height:100%;overflow-y:auto;padding:calc(var(--dsh-frame-top-clearance,48px) + 4px) 24px 40px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55;}
.wbc-inner{max-width:920px;margin:0 auto;display:flex;flex-direction:column;gap:14px;}
.wbc-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.wbc-title{margin:0;font-size:17px;font-weight:600;}
.wbc-sub{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;}
.wbc-spacer{flex:1 1 auto;}
.wbc-stamp{color:var(--dsw-alias-label-secondary);font-size:11.5px;font-variant-numeric:tabular-nums;}
.wbc-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;}
.wbc-seg>button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:4px 10px;cursor:pointer;}
.wbc-seg>button+button{border-left:1px solid var(--dsw-alias-border-l1);}
.wbc-seg>button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:500;}
.wbc-btn{appearance:none;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:4px 10px;border-radius:8px;cursor:pointer;}
.wbc-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);}
.wbc-btn:disabled{opacity:.55;cursor:default;}
.wbc-spin{display:inline-block;width:11px;height:11px;border:1.5px solid var(--dsw-alias-label-secondary);border-top-color:transparent;border-radius:50%;animation:wbc-spin .7s linear infinite;}
@keyframes wbc-spin{to{transform:rotate(360deg);}}
@media (prefers-reduced-motion:reduce){.wbc-spin{animation-duration:2.4s;}}
.wbc-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;}
.wbc-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:10px 13px;}
.wbc-card-label{font-size:11.5px;color:var(--dsw-alias-label-secondary);}
.wbc-card-value{margin-top:2px;font-size:21px;font-weight:600;font-variant-numeric:tabular-nums;}
.wbc-card-unit{font-size:11.5px;font-weight:400;color:var(--dsw-alias-label-secondary);margin-left:3px;}
.wbc-card.is-warn .wbc-card-value{color:var(--dsw-alias-state-warn-primary);}
.wbc-alert{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:10px;padding:9px 12px;font-size:12.5px;}
.wbc-alert-mark{color:var(--dsw-alias-state-warn-primary);font-weight:600;}
.wbc-alert.is-soft{border-color:var(--dsw-alias-border-l2);}
.wbc-alert.is-soft .wbc-alert-mark{color:var(--dsw-alias-state-idle-primary);}
.wbc-note{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0;}
.wbc-block{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:4px 0 0;overflow:hidden;}
.wbc-block-head{display:flex;align-items:baseline;gap:8px;padding:9px 14px 7px;}
.wbc-block-title{margin:0;font-size:12.5px;font-weight:600;}
.wbc-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;}
.wbc-table th{text-align:left;font-weight:500;font-size:11.5px;color:var(--dsw-alias-label-secondary);padding:6px 14px;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap;}
.wbc-table td{padding:7px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:middle;}
.wbc-table tr:last-child td{border-bottom:0;}
.wbc-table tbody tr:hover{background:var(--dsw-alias-bg-layer-2);}
.wbc-num{text-align:right;white-space:nowrap;}
.wbc-name{max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wbc-tag{display:inline-block;margin-left:6px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:10.5px;color:var(--dsw-alias-label-secondary);}
.wbc-soon{color:var(--dsw-alias-state-warn-primary);}
.wbc-gone{color:var(--dsw-alias-state-idle-primary);}
.wbc-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 12px;}
.wbc-chip{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:999px;padding:2px 9px;font-size:11.5px;}
.wbc-chip.is-free{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);}
.wbc-empty{padding:12px 14px;color:var(--dsw-alias-label-secondary);}
.wbc-state{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:16px;}
.wbc-state-title{margin:0;font-size:14px;font-weight:600;}
.wbc-state.is-error .wbc-state-title{color:var(--dsw-alias-state-error-primary);}
.wbc-state.is-warn .wbc-state-title{color:var(--dsw-alias-state-warn-primary);}
.wbc-state-body{margin:0;color:var(--dsw-alias-label-secondary);font-size:12.5px;}
.wbc-actions{display:flex;gap:8px;}
.wbc-foot{margin:2px 0 0;color:var(--dsw-alias-label-secondary);font-size:11.5px;}
`;

    // ------------------------------------------------------------- components

    /**
     * The sidebar glyph: a stack of coins at the size the sidebar asks for.
     * @param props - the sidebar's icon share.
     * @returns the icon element.
     */
    function CreditsIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 20;
      const stroke = { stroke: 'currentColor', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', style: { display: 'block' } },
        h('ellipse', { cx: 12, cy: 7.2, rx: 6.8, ry: 3, ...stroke }),
        h('path', { d: 'M5.2 7.2v4.2c0 1.66 3.05 3 6.8 3s6.8-1.34 6.8-3V7.2', ...stroke }),
        h('path', { d: 'M5.2 11.4v4.2c0 1.66 3.05 3 6.8 3s6.8-1.34 6.8-3v-4.2', ...stroke }),
      );
    }

    /**
     * One summary figure.
     * @param props - label, value, unit, and optional warning tone.
     * @returns the card element.
     */
    function StatCard(props) {
      return h(
        'div',
        { className: props.warn === true ? 'wbc-card is-warn' : 'wbc-card' },
        h('div', { className: 'wbc-card-label' }, props.label),
        h(
          'div',
          { className: 'wbc-card-value' },
          props.value,
          props.unit === undefined ? null : h('span', { className: 'wbc-card-unit' }, props.unit),
        ),
      );
    }

    /**
     * A state panel with an optional retry control.
     * @param props - tone, title, body, and the t/onRetry pair.
     * @returns the state element.
     */
    function StatePanel(props) {
      return h(
        'div',
        { className: `wbc-state${props.tone === undefined ? '' : ` is-${props.tone}`}`, role: 'status' },
        h('p', { className: 'wbc-state-title' }, props.title),
        props.body === undefined ? null : h('p', { className: 'wbc-state-body' }, props.body),
        props.onRetry === undefined
          ? null
          : h('div', { className: 'wbc-actions' }, h('button', { type: 'button', className: 'wbc-btn', onClick: props.onRetry }, props.t('retry'))),
      );
    }

    /**
     * The signed-in body: summary, expiry warning, package detail, model rates.
     * @param props - the payload and the translate function.
     * @returns the body element.
     */
    function CreditsBody(props) {
      const { t, data } = props;
      const nowMs = Date.now();

      const within7d = data.expiry.within7d;
      const freeModels = Array.isArray(data.freeModels) ? data.freeModels : [];
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];

      // Ordered cheapest-first by the host half; the tail is not worth showing.
      const rated = (Array.isArray(data.models) ? data.models : []).filter((model) => model.rate !== null && !model.free);
      const shown = rated.slice(0, 6);

      const warning =
        within7d.packages > 0
          ? h(
              'div',
              { className: 'wbc-alert', role: 'status' },
              h('span', { className: 'wbc-alert-mark', 'aria-hidden': 'true' }, '⚠'),
              h(
                'span',
                null,
                t('warning', { total: formatAmount(within7d.total), packages: within7d.packages }),
                Number.isFinite(within7d.earliestEndTimeMs)
                  ? t('warningEarliest', { time: formatDateTime(within7d.earliestEndTimeMs) })
                  : '',
                ' ',
                t('giftHint'),
              ),
            )
          : null;

      // The buckets are cumulative, so these are "within X" statements, and an
      // empty window costs no space at all.
      const sooner = [];
      if (data.expiry.within24h.packages > 0) sooner.push(`${t('expiring24h')} ${formatAmount(data.expiry.within24h.total)}`);
      if (data.expiry.within3d.packages > 0) sooner.push(`${t('expiring3d')} ${formatAmount(data.expiry.within3d.total)}`);

      const expiryNote = sooner.length > 0 ? sooner.join(' · ') : data.hasExpiry ? null : t('noExpiryData');

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'wbc-cards' },
          h(StatCard, { label: t('total'), value: formatAmount(data.total), unit: t('creditUnit') }),
          h(StatCard, {
            label: t('expiring7d'),
            value: formatAmount(within7d.total),
            unit: t('creditUnit'),
            warn: within7d.packages > 0,
          }),
          h(StatCard, { label: t('freeModels'), value: String(freeModels.length), unit: t('count', { n: '' }).trim() }),
          h(StatCard, { label: t('packages'), value: String(accounts.length), unit: t('count', { n: '' }).trim() }),
        ),
        warning,
      // A refresh that failed behind a usable picture says so, rather than
      // silently showing stale numbers as if they were just read.
      typeof data.refreshError === 'string' && data.refreshError !== ''
        ? h(
            'div',
            { className: 'wbc-alert is-soft', role: 'status' },
            h('span', { className: 'wbc-alert-mark', 'aria-hidden': 'true' }, '!'),
            h('span', null, `${t('refreshFailed')} ${data.refreshError}`),
          )
        : null,
        typeof data.domain === 'string' && data.domain !== ''
          ? h(
              'p',
              { className: 'wbc-note' },
              t('domain', { domain: data.domain }),
              Number.isFinite(data.expiresAtMs) ? ` · ${t('tokenValidUntil', { time: formatDateTime(data.expiresAtMs) })}` : '',
            )
          : null,
        expiryNote === null ? null : h('p', { className: 'wbc-note' }, expiryNote),
        h(
          'div',
          { className: 'wbc-block' },
          h(
            'div',
            { className: 'wbc-block-head' },
            h('h3', { className: 'wbc-block-title' }, t('detail')),
            h('span', { className: 'wbc-sub' }, t('subtitle')),
          ),
          accounts.length === 0
            ? h('p', { className: 'wbc-empty' }, t('empty'))
            : h(
                'table',
                { className: 'wbc-table' },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    h('th', null, t('colExpires')),
                    h('th', { className: 'wbc-num' }, t('colRemaining')),
                    h('th', { className: 'wbc-num' }, t('colSize')),
                    h('th', { className: 'wbc-num' }, t('colLeft')),
                    h('th', null, t('colPackage')),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  accounts.map((account, index) => {
                    const gift = isGiftPackage(account.packageName);
                    const days = account.endTimeMs === null ? null : daysUntil(account.endTimeMs, nowMs);
                    const leftClass = days === null ? '' : days < 0 ? 'wbc-num wbc-gone' : days <= 7 ? 'wbc-num wbc-soon' : 'wbc-num';
                    return h(
                      'tr',
                      { key: `${index}-${account.packageName}-${account.endTimeMs ?? 'none'}` },
                      h('td', null, account.endTimeMs === null ? t('noExpiry') : formatDateTime(account.endTimeMs)),
                      h('td', { className: 'wbc-num' }, account.unlimited ? t('unlimited') : formatAmount(account.remain)),
                      h('td', { className: 'wbc-num' }, account.size > 0 ? formatAmount(account.size) : '—'),
                      h('td', { className: leftClass }, days === null ? '—' : days < 0 ? t('expired') : t('days', { n: days.toFixed(1) })),
                      h(
                        'td',
                        { className: 'wbc-name', title: account.packageName },
                        account.packageName,
                        gift ? h('span', { className: 'wbc-tag' }, t('gift')) : null,
                      ),
                    );
                  }),
                ),
              ),
        ),
        freeModels.length > 0
          ? h(
              'div',
              { className: 'wbc-block' },
              h('div', { className: 'wbc-block-head' }, h('h3', { className: 'wbc-block-title' }, t('freeModels'))),
              h(
                'div',
                { className: 'wbc-chips' },
                freeModels.map((model) => h('span', { key: model.id, className: 'wbc-chip is-free' }, model.name)),
              ),
            )
          : null,
        shown.length > 0
          ? h(
              'div',
              { className: 'wbc-block' },
              h(
                'div',
                { className: 'wbc-block-head' },
                h('h3', { className: 'wbc-block-title' }, t('rateTitle')),
                h('span', { className: 'wbc-sub' }, t('rateHint')),
              ),
              h(
                'div',
                { className: 'wbc-chips' },
                shown.map((model) => h('span', { key: model.id, className: 'wbc-chip' }, `${model.name} ${t('rate', { value: model.rate.replace(/^x/u, '') })}`)),
              ),
            )
          : null,
      );
    }

    /**
     * The panel page.
     * @param props - the store handle and the translate function.
     * @returns the page element.
     */
    function CreditsPage(props) {
      const { t, store } = props;
      const state = useStore(store);

      React.useEffect(() => {
        store.ensure();
      }, [store]);

      const data = state.data;
      const signedIn = data !== null && data.state === 'ready';
      const stamp =
        data === null || !Number.isFinite(data.fetchedAtMs)
          ? null
          : `${t('updatedAt', { time: formatClock(data.fetchedAtMs) })}${data.cached === true ? t('servedFromCache') : ''}`;

      let body;
      if (state.phase === 'error' && data === null) {
        body = h(StatePanel, {
          tone: 'error',
          title: t('errorTitle'),
          body: `${state.error ?? ''} ${t('errorBody')}`.trim(),
          t,
          onRetry: () => store.refresh(),
        });
      } else if (data === null) {
        body = h(StatePanel, { title: t('loading') });
      } else if (data.state === 'signed-out') {
        body = h(StatePanel, {
          tone: 'warn',
          title: t('signedOutTitle'),
          body: data.reasonCode === 'no-credential' ? t('signedOutBody') : t('signedOutGeneric'),
          t,
          onRetry: () => store.refresh(),
        });
      } else if (data.state === 'unavailable') {
        body = h(StatePanel, {
          tone: 'warn',
          title: t('unavailableTitle'),
          body: `${data.error ?? ''} ${t('unavailableBody')}`.trim(),
          t,
          onRetry: () => store.refresh(),
        });
      } else if (signedIn) {
        body = h(CreditsBody, { t, data });
      } else {
        body = h(StatePanel, { title: t('loading') });
      }

      return h(
        'div',
        { className: 'wbc-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'wbc-inner' },
          h(
            'div',
            { className: 'wbc-head' },
            h('h2', { className: 'wbc-title' }, t('title')),
            h(
              'div',
              { className: 'wbc-seg', role: 'group' },
              h(
                'button',
                { type: 'button', 'aria-pressed': state.provider === 'workbuddy', onClick: () => store.setProvider('workbuddy') },
                t('providerCn'),
              ),
              h(
                'button',
                { type: 'button', 'aria-pressed': state.provider === 'workbuddy-ai', onClick: () => store.setProvider('workbuddy-ai') },
                t('providerIntl'),
              ),
            ),
            h('div', { className: 'wbc-spacer' }),
            stamp === null ? null : h('span', { className: 'wbc-stamp' }, stamp),
            h(
              'button',
              {
                type: 'button',
                className: 'wbc-btn',
                'aria-busy': state.refreshing,
                disabled: state.refreshing,
                onClick: () => store.refresh(),
              },
              state.refreshing ? h('span', { className: 'wbc-spin', 'aria-hidden': 'true' }) : null,
              state.refreshing ? t('refreshing') : t('refresh'),
            ),
          ),
          body,
          h('p', { className: 'wbc-foot' }, t('footnote')),
        ),
      );
    }

    // ----------------------------------------------------------------- entry

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-workbuddy-credits: panel copy');
        const t = ctx.locale.bind(NS);
        const store = createStore();

        // The sidebar owns the button and resolves its label from this list
        // metadata; the same id addresses the `main` entry below.
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 10,
          label: () => t('panel'),
          locale: NS,
        }, CreditsIcon));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          // `locale: NS` already supplies the `t` seat, so only the store is
          // injected here — the renderer rejects a prop it receives twice.
          inject: () => ({ store }),
        }, CreditsPage));
      },
    };
  },
});
