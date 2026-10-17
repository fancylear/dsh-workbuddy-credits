/**
 * dsh-workbuddy-credits — Host half.
 *
 * Serves the WorkBuddy credit picture to this package's browser half on one
 * loopback-only route. The upstream reader (`dsh-workbuddy-connect`) answers
 * every call from the real billing API — a live HTTP round trip of roughly
 * 300–600 ms that the skill explicitly forbids polling — so this half owns the
 * cache: opening the panel is served from memory, and only an explicit manual
 * refresh asks the upstream again.
 *
 * @module dsh-workbuddy-credits
 */

/** The one route this package owns. */
const ROUTE_PATH = '/plugins/dsh-workbuddy-credits/status';

/** Upstream readers, keyed by the provider the browser half asks for. */
const UPSTREAM_PATHS = {
  workbuddy: '/plugins/dsh-workbuddy-connect/status',
  'workbuddy-ai': '/plugins/dsh-workbuddy-connect/ai/status',
};

/** The domestic WorkBuddy account, which is the one the panel opens on. */
const DEFAULT_PROVIDER = 'workbuddy';

/** How long a served picture counts as fresh before the next read revalidates it. */
const DEFAULT_TTL_MS = 60_000;

/** Upper bound on a configured TTL, so a typo cannot pin a stale picture forever. */
const MAX_TTL_MS = 3_600_000;

/** Bound on a single upstream read. */
const UPSTREAM_TIMEOUT_MS = 30_000;

/** Longest upstream failure text carried back to the browser. */
const MESSAGE_MAX = 300;

/**
 * Reduce a request `Host` header to its hostname.
 * @param host - the raw header value.
 * @returns the lowercase hostname without brackets or port.
 */
function hostnameOf(host) {
  if (typeof host !== 'string') return '';
  let value = host.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end !== -1) return value.slice(1, end);
  }
  const colon = value.lastIndexOf(':');
  if (colon !== -1 && value.indexOf(':') === colon) value = value.slice(0, colon);
  return value;
}

/**
 * Whether a hostname names the loopback interface.
 * @param name - a hostname from a `Host` header or a parsed `Origin`.
 * @returns true when the request cannot have come from another machine.
 */
function isLoopbackHostname(name) {
  if (typeof name !== 'string') return false;
  if (name === 'localhost' || name === '::1' || name === '0:0:0:0:0:0:0:1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(name);
}

/**
 * The request must be addressed to loopback, and a browser-attached Origin must
 * be loopback too. The Host check drops DNS-rebinding pages (their Host is the
 * attacker's domain, not loopback); this panel's same-origin fetches carry no
 * Origin and pass on Host alone. Mirrors the upstream reader's own policy.
 * @param req - the incoming request.
 * @returns true when the request is trusted.
 */
function requestIsLoopback(req) {
  const host = req?.headers?.host;
  if (host === undefined || String(host).trim() === '') return false;
  if (!isLoopbackHostname(hostnameOf(host))) return false;
  const origin = req?.headers?.origin;
  if (origin === undefined || String(origin).trim() === '') return true;
  try {
    return isLoopbackHostname(hostnameOf(new URL(String(origin)).hostname));
  } catch {
    return false;
  }
}

/**
 * Write one JSON response. The charset is stated explicitly: the upstream
 * reader's header omits it, which is what turns Chinese package names into
 * mojibake in a decoding client that guesses ISO-8859-1.
 * @param res - the server response.
 * @param status - HTTP status code.
 * @param body - the JSON-serializable body.
 */
function json(res, status, body) {
  const buffer = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, must-revalidate',
    'content-length': buffer.length,
  });
  res.end(buffer);
}

/**
 * Coerce a value to a finite number.
 * @param value - the candidate.
 * @param fallback - returned when the candidate is not finite.
 * @returns the number.
 */
function toNumber(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Bound a thrown value to one short line.
 * @param error - the thrown value.
 * @returns the message.
 */
function messageOf(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX)}…` : text;
}

/**
 * Resolve the loopback base URL of this Harness's own web server, so the host
 * half reaches the upstream route without guessing a port.
 * @param webServer - the `webServer` service.
 * @returns an origin such as `http://127.0.0.1:19387`.
 */
function baseUrlOf(webServer) {
  const raw = typeof webServer?.host === 'string' ? webServer.host : '';
  const host = raw === '' || raw === '0.0.0.0' || raw === '::' ? '127.0.0.1' : raw;
  const printed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const port = toNumber(webServer?.port, 0);
  return port > 0 ? `http://${printed}:${port}` : `http://${printed}`;
}

/**
 * Project the upstream status document into the small shape the panel renders.
 *
 * The upstream document also carries catalog, visibility, and probe sections
 * that the panel never shows; dropping them here keeps the cached payload small
 * and the browser half free of projection logic.
 *
 * @param provider - the provider key that was read.
 * @param raw - the decoded upstream status document.
 * @param fetchedAtMs - when the read completed.
 * @param cached - whether this response came from the cache.
 * @returns the normalized payload.
 */
function normalize(provider, raw, fetchedAtMs, cached) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const status = typeof source.status === 'string' ? source.status : 'unknown';
  const envelope = { provider, fetchedAtMs, cached, status };

  if (status !== 'signed-in') {
    // Only an explicit sign-out is a sign-out. Any other status means the
    // upstream answered something this projection does not recognize, which is
    // a read failure — reporting it as "signed out" would send the user to
    // re-authenticate an account that is still perfectly signed in.
    if (status !== 'signed-out') {
      return {
        ...envelope,
        ok: false,
        state: 'unavailable',
        error: '上游返回了无法识别的状态',
      };
    }
    return {
      ...envelope,
      ok: false,
      state: 'signed-out',
      ...(typeof source.reason === 'string' ? { reason: source.reason } : {}),
      ...(typeof source.reasonCode === 'string' ? { reasonCode: source.reasonCode } : {}),
    };
  }

  const signedIn = {
    ...envelope,
    ...(typeof source.domain === 'string' && source.domain !== '' ? { domain: source.domain } : {}),
    ...(Number.isFinite(toNumber(source.expiresAt, Number.NaN))
      ? { expiresAtMs: toNumber(source.expiresAt, 0) }
      : {}),
  };

  const credits = source.credits;
  if (credits === null || typeof credits !== 'object') {
    return {
      ...signedIn,
      ok: false,
      state: 'unavailable',
      error: typeof source.creditsError === 'string' && source.creditsError !== ''
        ? source.creditsError
        : '已登录，但上游没有返回积分数据',
    };
  }

  // Balance is a set of packages with independent expiry: the upstream deducts
  // soonest-expiring first, so the sort below is the order that matters.
  const accounts = (Array.isArray(credits.accounts) ? credits.accounts : [])
    .map((account) => {
      const row = account !== null && typeof account === 'object' ? account : {};
      return {
        packageName: typeof row.packageName === 'string' && row.packageName !== '' ? row.packageName : '(未命名)',
        remain: toNumber(row.remain, 0),
        size: toNumber(row.size, 0),
        unlimited: row.unlimited === true,
        endTimeMs: Number.isFinite(toNumber(row.endTimeMs, Number.NaN)) ? toNumber(row.endTimeMs, 0) : null,
      };
    })
    .sort((left, right) => (left.endTimeMs ?? Number.MAX_SAFE_INTEGER) - (right.endTimeMs ?? Number.MAX_SAFE_INTEGER));

  const expirySource = credits.expiry !== null && typeof credits.expiry === 'object' ? credits.expiry : {};
  const bucketOf = (bucket) => {
    const row = bucket !== null && typeof bucket === 'object' ? bucket : {};
    return {
      total: toNumber(row.total, 0),
      packages: toNumber(row.packages, 0),
      ...(Number.isFinite(toNumber(row.earliestEndTimeMs, Number.NaN))
        ? { earliestEndTimeMs: toNumber(row.earliestEndTimeMs, 0) }
        : {}),
    };
  };
  const expiry = {
    within24h: bucketOf(expirySource.within24h),
    within3d: bucketOf(expirySource.within3d),
    within7d: bucketOf(expirySource.within7d),
  };

  const models = (Array.isArray(source.models) ? source.models : [])
    .map((model) => {
      const row = model !== null && typeof model === 'object' ? model : {};
      const rate = typeof row.credits === 'string' ? row.credits : undefined;
      const numeric = rate === undefined ? Number.NaN : Number.parseFloat(rate.replace(/^x/u, ''));
      return {
        id: typeof row.id === 'string' ? row.id : '',
        name: typeof row.name === 'string' && row.name !== '' ? row.name : (typeof row.id === 'string' ? row.id : ''),
        free: row.free === true || numeric === 0,
        rate: rate ?? null,
        rateValue: Number.isFinite(numeric) ? numeric : null,
        badges: Array.isArray(row.badges) ? row.badges.filter((badge) => typeof badge === 'string') : [],
        contextWindow: Number.isFinite(toNumber(row.contextWindow, Number.NaN)) ? toNumber(row.contextWindow, 0) : null,
      };
    });

  return {
    ...signedIn,
    ok: true,
    state: 'ready',
    total: toNumber(credits.total, 0),
    accounts,
    expiry,
    hasExpiry: credits.expiry !== null && typeof credits.expiry === 'object',
    // Sorted cheapest-first so the panel can name the economical models directly.
    models: models.slice().sort((left, right) => (left.rateValue ?? Number.MAX_SAFE_INTEGER) - (right.rateValue ?? Number.MAX_SAFE_INTEGER)),
    freeModels: models.filter((model) => model.free),
  };
}

/** The shape returned when this host half cannot obtain a picture at all. */
function unavailable(provider, error) {
  return {
    ok: false,
    state: 'unavailable',
    provider,
    fetchedAtMs: Date.now(),
    cached: false,
    status: 'unknown',
    error: messageOf(error),
  };
}

/**
 * Read the upstream status document over loopback.
 * @param base - this Harness's own origin.
 * @param provider - the provider key to read.
 * @returns the decoded document.
 */
async function fetchUpstream(base, provider) {
  const response = await fetch(`${base}${UPSTREAM_PATHS[provider]}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`上游状态路由返回 ${response.status}（dsh-workbuddy-connect 是否在运行？）`);
  return await response.json();
}

/**
 * Refresh one provider's cached picture, joining an in-flight read rather than
 * starting a second one — a burst of panel opens must not become a burst of
 * billing-API calls.
 *
 * Only a usable picture is cached. A sign-out or an unreadable answer is
 * returned but not stored, so signing in again shows up on the next read
 * instead of hiding behind a cached "not signed in" for a whole TTL.
 *
 * @param deps - route dependencies.
 * @param provider - the provider key.
 * @returns the fresh payload.
 */
function revalidate(deps, provider) {
  const existing = deps.inflight.get(provider);
  if (existing !== undefined) return existing;
  const run = (async () => {
    try {
      const raw = await fetchUpstream(deps.base(), provider);
      const payload = normalize(provider, raw, Date.now(), false);
      if (payload.ok === true) deps.cache.set(provider, { payload, fetchedAtMs: Date.now() });
      else deps.cache.delete(provider);
      return payload;
    } finally {
      deps.inflight.delete(provider);
    }
  })();
  deps.inflight.set(provider, run);
  return run;
}

/**
 * Serve one provider: fresh cache wins, a stale cache is served immediately and
 * revalidated behind it, and only an explicit refresh blocks on the upstream.
 *
 * A refresh that fails does not throw away numbers the user was already
 * looking at: the last good picture is returned with `refreshError` set, so the
 * panel can keep showing the balance and say that the refresh did not land.
 *
 * @param deps - route dependencies.
 * @param provider - the provider key.
 * @param force - whether the caller asked for a real refresh.
 * @returns the payload to send.
 */
async function read(deps, provider, force) {
  const entry = deps.cache.get(provider);

  if (!force && entry !== undefined) {
    const ageMs = Date.now() - entry.fetchedAtMs;
    if (ageMs < deps.ttlMs()) return { ...entry.payload, cached: true, ageMs };
    // Stale-while-revalidate: never make the panel wait for the billing API
    // when a usable picture is already in hand.
    void revalidate(deps, provider).catch(() => {});
    return { ...entry.payload, cached: true, stale: true, ageMs };
  }

  try {
    const payload = await revalidate(deps, provider);
    return { ...payload, cached: false, ageMs: 0 };
  } catch (error) {
    if (entry === undefined) throw error;
    return {
      ...entry.payload,
      cached: true,
      stale: true,
      ageMs: Date.now() - entry.fetchedAtMs,
      refreshError: messageOf(error),
    };
  }
}

/**
 * The route handler.
 * @param req - the incoming request.
 * @param res - the server response.
 * @param deps - route dependencies.
 */
async function handle(req, res, deps) {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'method not allowed' });
    return;
  }
  if (!requestIsLoopback(req)) {
    json(res, 403, { error: 'request-not-trusted' });
    return;
  }

  let url;
  try {
    url = new URL(typeof req.url === 'string' ? req.url : '/', 'http://localhost');
  } catch {
    json(res, 400, { error: 'bad request' });
    return;
  }

  const requested = url.searchParams.get('provider');
  const provider = requested !== null && Object.hasOwn(UPSTREAM_PATHS, requested) ? requested : DEFAULT_PROVIDER;
  const refresh = url.searchParams.get('refresh');
  const force = refresh === '1' || refresh === 'true';

  try {
    json(res, 200, await read(deps, provider, force));
  } catch (error) {
    // A failed read is a data state the panel renders, not a transport error.
    json(res, 200, unavailable(provider, error));
  }
}

/**
 * Mount the status route. The `webServer` service is optional: in a profile
 * that serves no browser the panel does not exist either, so the plugin stays
 * inactive instead of failing to load.
 * @param ctx - the host plugin context.
 * @param config - the Loader row's config.
 */
export function apply(ctx, config) {
  const settings = config !== null && typeof config === 'object' ? config : {};
  const configuredTtl = toNumber(settings.cacheTtlMs, DEFAULT_TTL_MS);
  const ttlMs = configuredTtl > 0 ? Math.min(configuredTtl, MAX_TTL_MS) : DEFAULT_TTL_MS;

  const cache = new Map();
  const inflight = new Map();
  let base = 'http://127.0.0.1:19387';

  ctx.inject(['webServer'], (webCtx) => {
    base = baseUrlOf(webCtx.webServer);
    webCtx.effect(() => {
      const dispose = webCtx.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: (req, res) => handle(req, res, {
          cache,
          inflight,
          base: () => base,
          ttlMs: () => ttlMs,
        }),
      });
      return () => {
        dispose();
      };
    }, 'dsh-workbuddy-credits: status route');
  });
}
