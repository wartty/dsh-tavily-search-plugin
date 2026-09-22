/**
 * dsh-tavily-search-plugin — host half.
 *
 * Registers a Tavily-backed `WebSearchProvider` with `ctx.web` so the harness's
 * built-in `web_search` tool (via `@deepseek-ai/dsh-tool-web`) searches the web
 * through Tavily instead of DeepSeek's paid search.
 *
 * This is a standalone, out-of-tree Cordis plugin — it is NOT part of the
 * DeepSeek Harness checkout and modifies no Harness source file. It plugs into
 * the public seam exactly like the in-box `@deepseek-ai/dsh-web-search-exa`
 * provider: it registers INTO the web seam's provider registry and never owns
 * the `ctx.web` key.
 *
 * Endpoint: `POST {baseURL}/search` (default https://api.tavily.com)
 * Auth:     `Authorization: Bearer <api key>`
 *
 * The browser half (`src/client/`) contributes the settings card on the
 * Settings → Plugins page; this file installs the settings namespace it edits.
 * Every fact the two halves share lives in `./shared.ts`.
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { Context } from '@deepseek-ai/cordis'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import packageJson from '../package.json' with { type: 'json' }
import { mcpHandoffText, TAVILY_PROVIDER_ID } from './shared.ts'
import { TAVILY_API_KEY_ENV, TAVILY_SEARCH_DEPTHS, TAVILY_SETTINGS_NAMESPACE } from './shared.ts'
import { TAVILY_TOPICS, TAVILY_TIME_RANGES } from './shared.ts'
import type { TavilySearchDepth, TavilyTimeRange, TavilyTopic } from './shared.ts'

/** Cordis plugin name used by loader diagnostics and the settings namespace. */
export const name = 'web-search-tavily'

/** The web seam this provider registers into. */
export const inject = ['web']

// The vocabulary lives in `./shared.ts` so the browser half renders exactly the
// values this half validates; re-exported here because the package root is where
// the README and consumers read it from.
export { mcpHandoffText, TAVILY_API_KEY_ENV, TAVILY_MCP_TOOLS, TAVILY_PROVIDER_ID } from './shared.ts'
export { TAVILY_SEARCH_DEPTHS, TAVILY_SETTINGS_NAMESPACE, TAVILY_TOPICS, TAVILY_TIME_RANGES } from './shared.ts'
export type { TavilyMcpTool, TavilySearchDepth, TavilyTimeRange, TavilyTopic } from './shared.ts'

/**
 * Default Tavily search endpoint. `/search` is appended to it, so a deployment
 * pointing at a proxy states only the proxy base.
 */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'

/**
 * Default search depth. `advanced` returns higher-relevance, multi-snippet
 * content (2 credits/req); the cheaper `basic`/`fast`/`ultra-fast` (1 credit)
 * are one card toggle away.
 */
export const TAVILY_DEFAULT_SEARCH_DEPTH: TavilySearchDepth = 'advanced'

/**
 * Default for also asking Tavily to generate a natural-language answer.
 * `false`: that answer reads like a stray extra "result" beside the rendered
 * `Sources:` list — sources-only by default, enable per deployment when the
 * summary is genuinely wanted.
 */
export const TAVILY_DEFAULT_INCLUDE_ANSWER = false

/** Default result count when neither the caller nor the section names one. */
export const TAVILY_DEFAULT_MAX_RESULTS = 7

/** Default content chunks retrieved per source; `1` keeps snippets short and focused. */
export const TAVILY_DEFAULT_CHUNKS_PER_SOURCE = 1

/**
 * Default `topic`. `'general'` is the broad-relevance mode suited to technical
 * and long-tail queries; `'news'` favours real-time headlines and `'finance'`
 * market data.
 */
export const TAVILY_DEFAULT_TOPIC: TavilyTopic = 'general'

/**
 * Default `days` window. `0` means "no window" — the sensible default for
 * `topic: 'general'`, so older reference pages are not filtered out. Only
 * effective under `topic: 'news'`; `timeRange` wins when set.
 */
export const TAVILY_DEFAULT_DAYS = 0

/**
 * Default snippet cap in characters, ellipsis included. One Tavily `content`
 * block can be a whole page extract; the cap is what keeps a search from
 * flooding the model context, and deployments with a different context budget
 * change it from the card.
 */
export const TAVILY_DEFAULT_SNIPPET_MAX_CHARS = 600

/** Maximum `maxResults` Tavily accepts (search API hard ceiling, not a policy). */
const TAVILY_MAX_RESULTS_CEILING = 20

/** Attribution header sent on every request (version derived from the manifest). */
const USER_AGENT = `deepseek-harness-tavily/${packageJson.version}`

/** `YYYY-MM-DD` shape for Tavily's `start_date` / `end_date`. */
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/

/**
 * Plugin config. Fields stay optional to the *composition*: the paired schema
 * below carries every default, so the value `apply` receives — and the settings
 * section the card edits — is always fully resolved. A deployment changes any of
 * these from `cordis.patch.yml` or the card without touching this file.
 * @typedef {Object} Config
 * @property {string} [apiKey] Literal Tavily API key; prefer `apiKeyEnv`.
 * @property {string} [apiKeyEnv] Credential reference; defaults to `TAVILY_API_KEY`.
 * @property {string} [baseURL] Endpoint base; `/search` is appended.
 * @property {'basic'|'advanced'|'fast'|'ultra-fast'} [searchDepth] Tavily search depth; default `'advanced'`.
 * @property {number} [maxResults] Result count to request (1–20); default `7`.
 * @property {boolean} [includeAnswer] Ask Tavily to also return a generated answer; default `false`.
 * @property {'general'|'news'|'finance'} [topic] Result category; default `'general'`.
 * @property {number} [days] Legacy "last N days" window (0 disables); superseded by `timeRange`.
 * @property {'day'|'week'|'month'|'year'|'d'|'w'|'m'|'y'} [timeRange] Current time-window form; wins over `days`.
 * @property {string} [startDate] Only sources after this `YYYY-MM-DD` date.
 * @property {string} [endDate] Only sources before this `YYYY-MM-DD` date.
 * @property {string[]} [includeDomains] Domains to restrict results INTO.
 * @property {string[]} [excludeDomains] Domains to exclude from results.
 * @property {number} [chunksPerSource] Content chunks per source (1–3); default `1`.
 * @property {number} [snippetMaxChars] Cap on one source's rendered snippet; default `600`.
 * @property {boolean} [useMcp] MCP hand-off mode; default `false`. When `true`,
 *   `web_search` points the model at the `mcp__tavily__*` tools instead of
 *   searching, so no REST credits are spent.
 */
export interface Config {
  apiKey?: string
  apiKeyEnv?: string
  baseURL?: string
  searchDepth?: TavilySearchDepth
  maxResults?: number
  includeAnswer?: boolean
  topic?: TavilyTopic
  days?: number
  timeRange?: TavilyTimeRange
  startDate?: string
  endDate?: string
  includeDomains?: string[]
  excludeDomains?: string[]
  chunksPerSource?: number
  snippetMaxChars?: number
  useMcp?: boolean
}

/**
 * Runtime validator paired with {@link Config}. The schema is authoritative for
 * every default: the settings provider resolves sections through it, so the
 * card, the user document layer and the per-search projection all read one set
 * of values. Constraints belong here too — an invalid one fails the load loudly
 * (`$.maxResults expected number <= 20 but got 99`) instead of surfacing as a
 * puzzling search later.
 */
export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(TAVILY_API_KEY_ENV),
  baseURL: z.string().default(TAVILY_DEFAULT_BASE_URL),
  searchDepth: z.union([...TAVILY_SEARCH_DEPTHS]).default(TAVILY_DEFAULT_SEARCH_DEPTH),
  maxResults: z.number().step(1).min(1).max(TAVILY_MAX_RESULTS_CEILING).default(TAVILY_DEFAULT_MAX_RESULTS),
  includeAnswer: z.boolean().default(TAVILY_DEFAULT_INCLUDE_ANSWER),
  topic: z.union([...TAVILY_TOPICS]).default(TAVILY_DEFAULT_TOPIC),
  days: z.number().step(1).min(0).default(TAVILY_DEFAULT_DAYS),
  timeRange: z.union([...TAVILY_TIME_RANGES]),
  startDate: z.string().pattern(YYYY_MM_DD),
  endDate: z.string().pattern(YYYY_MM_DD),
  includeDomains: z.array(z.string()).default([]),
  excludeDomains: z.array(z.string()).default([]),
  chunksPerSource: z.number().step(1).min(1).max(3).default(TAVILY_DEFAULT_CHUNKS_PER_SOURCE),
  snippetMaxChars: z.number().step(1).min(16).default(TAVILY_DEFAULT_SNIPPET_MAX_CHARS),
  useMcp: z.boolean().default(false),
})

/**
 * What one search runs with: the section projected into the shape the request
 * builder and result mapper read, plus a lazy credential resolver.
 *
 * Exported because {@link TavilySearchProvider} is: a consumer of the class can
 * name what it must pass. Every field except the optional ones is total, so the
 * provider never re-checks for missing configuration.
 */
export interface TavilySearchProviderOptions
  extends Required<Omit<Config, 'apiKey' | 'timeRange' | 'startDate' | 'endDate'>> {
  /** Literal key from the section, when one was configured. */
  apiKey?: string
  timeRange?: TavilyTimeRange
  startDate?: string
  endDate?: string
  /** Resolves the credential reference at search time (credential seam → environment). */
  resolveApiKey?: () => Promise<string | undefined>
}

/**
 * Project a section into provider options — a pure rename/derive step with the
 * schema's defaults restated for completeness, so the exported provider contract
 * holds even when a caller supplies a partial object.
 * @param config - the currently authoritative section.
 * @returns total options for one search.
 */
export function toProviderOptions(config: Config): TavilySearchProviderOptions {
  return {
    ...config.apiKey !== undefined && config.apiKey.length > 0 ? { apiKey: config.apiKey } : {},
    apiKeyEnv: config.apiKeyEnv ?? TAVILY_API_KEY_ENV,
    baseURL: config.baseURL ?? TAVILY_DEFAULT_BASE_URL,
    searchDepth: config.searchDepth ?? TAVILY_DEFAULT_SEARCH_DEPTH,
    maxResults: config.maxResults ?? TAVILY_DEFAULT_MAX_RESULTS,
    includeAnswer: config.includeAnswer ?? TAVILY_DEFAULT_INCLUDE_ANSWER,
    topic: config.topic ?? TAVILY_DEFAULT_TOPIC,
    days: config.days ?? TAVILY_DEFAULT_DAYS,
    ...config.timeRange !== undefined ? { timeRange: config.timeRange } : {},
    ...config.startDate !== undefined ? { startDate: config.startDate } : {},
    ...config.endDate !== undefined ? { endDate: config.endDate } : {},
    includeDomains: config.includeDomains ?? [],
    excludeDomains: config.excludeDomains ?? [],
    chunksPerSource: config.chunksPerSource ?? TAVILY_DEFAULT_CHUNKS_PER_SOURCE,
    snippetMaxChars: config.snippetMaxChars ?? TAVILY_DEFAULT_SNIPPET_MAX_CHARS,
    useMcp: config.useMcp ?? false,
  }
}

/**
 * Resolve the credential reference for one section against the credential seam,
 * falling back to the launch environment when no credential provider is mounted
 * (a profile without `dsh-credentials` still honours `TAVILY_API_KEY`).
 * @param ctx - context supplying the credential and environment planes.
 * @param apiKeyEnv - the reference to resolve.
 * @returns a resolver evaluated once per search, so a rotated key is picked up.
 */
function credentialResolver(ctx: Context, apiKeyEnv: string): () => Promise<string | undefined> {
  const ref = credentialRef(apiKeyEnv)
  return async () => {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) return (await credentials.resolve(ref))?.value
    const ambient = launchEnvironmentOf(ctx).get(ref)
    return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
  }
}

/**
 * Project a section into the options one search runs with.
 * @param ctx - context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(ctx: Context, config: Config): TavilySearchProviderOptions {
  const options = toProviderOptions(config)
  return { ...options, resolveApiKey: credentialResolver(ctx, options.apiKeyEnv) }
}

/** One Tavily search request body (`POST {baseURL}/search`). */
export interface TavilySearchBody {
  query: string
  topic: TavilyTopic
  search_depth: TavilySearchDepth
  max_results: number
  time_range?: TavilyTimeRange
  days?: number
  start_date?: string
  end_date?: string
  include_domains?: string[]
  exclude_domains?: string[]
  chunks_per_source: number
  include_answer: boolean
  include_raw_content: false
  include_images: false
}

/**
 * Build the REST body for one search.
 *
 * `max_results` is capped by the configured value, never raised by a request:
 * the seam already forwards `dsh-tool-web`'s own bound, and honouring the
 * section keeps Tavily usage inside the plan. Time window: the current
 * `time_range` form wins; the legacy `days` window is only sent when an existing
 * config still sets it (never as `0`, which means "no window").
 * @param request - the seam request: one query plus an optional result bound.
 * @param options - the section snapshot this call resolved.
 * @returns the JSON body to POST.
 */
export function buildSearchBody(
  request: WebSearchRequest,
  options: TavilySearchProviderOptions,
): TavilySearchBody {
  return {
    query: request.query,
    topic: options.topic,
    search_depth: options.searchDepth,
    max_results: Math.min(request.maxResults ?? options.maxResults, options.maxResults),
    ...options.timeRange !== undefined
      ? { time_range: options.timeRange }
      : options.days > 0 ? { days: options.days } : {},
    ...options.startDate !== undefined ? { start_date: options.startDate } : {},
    ...options.endDate !== undefined ? { end_date: options.endDate } : {},
    ...options.includeDomains.length > 0 ? { include_domains: options.includeDomains } : {},
    ...options.excludeDomains.length > 0 ? { exclude_domains: options.excludeDomains } : {},
    chunks_per_source: options.chunksPerSource,
    include_answer: options.includeAnswer,
    include_raw_content: false,
    include_images: false,
  }
}

/** The part of Tavily's search response this provider reads. */
export interface TavilySearchPayload {
  results?: { url?: string; title?: string; content?: string }[]
  answer?: string
}

/**
 * Normalize one Tavily response into the seam's search result.
 *
 * A result without a URL is DROPPED rather than emitted with an empty one: the
 * seam's contract is that a source always carries a URL, and `dsh-tool-web`
 * renders `title ?? hostname(url)`.
 * @param payload - the decoded Tavily response.
 * @param options - the section snapshot the request was built from.
 * @returns the sources plus the optional generated answer.
 */
export function toSearchResult(
  payload: TavilySearchPayload,
  options: TavilySearchProviderOptions,
): WebSearchResult {
  const sources = (payload.results ?? [])
    .map(result => toSource(result, options.snippetMaxChars))
    .filter((source): source is WebSearchSource => source !== undefined)
  const answer = payload.answer
  return {
    // Label the answer so it reads as an isolated summary rather than one more
    // result beside the `Sources:` list the web tool renders.
    ...answer != null && answer.length > 0 ? { content: `**Answer:** ${answer}` } : {},
    sources,
    // The seam truncates to `request.maxResults` and owns this flag.
    truncated: false,
  }
}

/**
 * Map one Tavily result onto the seam's source shape.
 * @param result - one entry of Tavily's flat `results[]`.
 * @param snippetMaxChars - cap for the rendered snippet, ellipsis included.
 * @returns the source, or `undefined` when the result carries no URL.
 */
function toSource(
  result: { url?: string; title?: string; content?: string },
  snippetMaxChars: number,
): WebSearchSource | undefined {
  const url = result.url
  if (url === undefined || url.length === 0) return undefined
  return {
    url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    ...result.content != null && result.content.length > 0
      ? { snippet: ellipsize(result.content, snippetMaxChars) }
      : {},
  }
}

/**
 * Cap a string at `limit` characters, ellipsis included.
 * @param value - text to cap.
 * @param limit - maximum length of the result.
 * @returns the original text, or a truncated copy ending in an ellipsis.
 */
function ellipsize(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 1))}…`
}

/**
 * Translate one fetch/body failure into the seam's error vocabulary.
 *
 * Cancellation is not a provider fault, so it maps to `WEB_ABORTED`; everything
 * else — DNS, TLS, connection refused, an unprocessable body — is
 * `WEB_PROVIDER_ERROR`, which the seam documents as the catch-all for provider
 * transport failures.
 * @param error - the thrown value.
 * @param context - what was being attempted, for the message.
 * @returns the error to throw.
 */
export function toProviderError(error: unknown, context: string): WebError {
  if (isAbortError(error)) return new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
  return new WebError(`${context}: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
}

/**
 * The Tavily-backed search provider.
 *
 * HTTP redirects fail closed as `WEB_PROVIDER_ERROR` (`redirect: 'error'`): the
 * bearer token must never be replayed to a redirect target.
 */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = TAVILY_PROVIDER_ID

  private readonly options: () => TavilySearchProviderOptions

  /**
   * @param options - the options for the NEXT operation, snapshotted once at the
   *   operation's entry so one search never mixes two sections. A thunk rather
   *   than a value because the settings section can change between searches, and
   *   re-registering the provider to carry a new endpoint would show up in the
   *   seam's selection as a flicker.
   */
  constructor(options: () => TavilySearchProviderOptions) {
    this.options = options
  }

  available(): boolean {
    const options = this.options()
    // MCP hand-off mode never performs a REST search, so the key and endpoint
    // preconditions are irrelevant — staying available keeps `web_search`
    // answering with the pointer message instead of a provider error.
    if (options.useMcp) return true
    // A key may come from the environment/credential resolver rather than a
    // literal, so a present resolver is enough — exactly as the in-box DeepSeek
    // provider judges availability. This check stays local: no network calls.
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && isValidBaseUrl(options.baseURL)
      && isPositiveInteger(options.maxResults)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One snapshot for the whole operation, so a settings write landing mid-call
    // cannot mix the key of one section with the endpoint of another.
    const options = this.options()
    if (options.useMcp) {
      return { content: mcpHandoffText(), sources: [], truncated: false }
    }

    const apiKey = options.apiKey ?? await options.resolveApiKey?.()
    if (apiKey === undefined || apiKey.length === 0) {
      throw new WebError('Tavily API key is not configured', 'WEB_PROVIDER_ERROR')
    }

    const response = await this.post(options, apiKey, buildSearchBody(request, options), signal)
    if (!response.ok) throw new WebError(await readErrorMessage(response), 'WEB_PROVIDER_ERROR')

    let payload: TavilySearchPayload
    try {
      payload = await response.json() as TavilySearchPayload
    } catch (error) {
      throw toProviderError(error, 'Tavily returned an unprocessable response body')
    }
    return toSearchResult(payload, options)
  }

  /**
   * POST one request body to Tavily.
   * @param options - the resolved section snapshot.
   * @param apiKey - bearer token for this call.
   * @param body - the request body.
   * @param signal - optional cancellation forwarded from the service call.
   * @returns the raw response; the caller judges the status.
   */
  private async post(
    options: TavilySearchProviderOptions,
    apiKey: string,
    body: TavilySearchBody,
    signal?: AbortSignal,
  ): Promise<Response> {
    try {
      return await fetch(`${options.baseURL}/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error) {
      throw toProviderError(error, 'Tavily search request failed')
    }
  }
}

/**
 * Read the most specific message Tavily's error body offers.
 *
 * A read that fails mid-body must not hide a cancellation behind the generic
 * HTTP message, so an abort is re-thrown as `WEB_ABORTED`; any other unreadable
 * body simply leaves the status line as the message.
 * @param response - a non-2xx response.
 * @returns the message to surface.
 */
async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `Tavily API error (HTTP ${response.status})`
  try {
    const parsed = await response.json() as { detail?: unknown; error?: unknown; message?: unknown }
    const detail = parsed.detail ?? parsed.error ?? parsed.message
    return typeof detail === 'string' && detail.length > 0 ? detail : fallback
  } catch (error) {
    if (isAbortError(error)) throw toProviderError(error, 'Tavily search aborted')
    return fallback
  }
}

/** Register the Tavily search provider and the settings section it reads. */
export function apply(ctx: Context, config: Config): void {
  // DSH ≥ 0.1.5 hands the section's source as a THUNK (`() => T`): keep a level
  // of indirection and re-read it per search, so a committed settings change
  // takes effect without re-registering the provider.
  let current: () => Config = () => config
  // DSH ≥ 0.1.5 dropped the free `installSettingsSection` helper: the section now
  // installs through the `settings` service, injected at call level so the
  // provider still registers — falling back to the composition entry — when the
  // settings service is absent. `config` is already resolved through the schema,
  // so it is a complete base layer.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, TAVILY_SETTINGS_NAMESPACE, Config, config, {
      validate: value => validateSection(value),
      setSource: (source: () => Config) => {
        current = source
      },
      // The registration carries no resolved value: the provider projects the
      // section per search, so a committed change needs no re-registration.
      onChange: () => {},
    })
  })
  ctx.web.registerSearchProvider(new TavilySearchProvider(() => resolveOptions(ctx, current())))
}

/**
 * Refuse a section write the schema cannot express.
 *
 * These constraints run at the WRITE, not on the next search: a relative
 * endpoint or an inverted date window is a mistake the card should report while
 * it is being made. The settings provider calls this on registration and on
 * every `scope.set`/`scope.unset`, and keeps the last good section when a stored
 * document fails it.
 * @param value - the resolved section about to be committed.
 * @throws {Error} when `baseURL` is not absolute or the date window is inverted.
 */
export function validateSection(value: Config): void {
  if (value.baseURL !== undefined && !isValidBaseUrl(value.baseURL)) {
    throw new Error(
      `${TAVILY_SETTINGS_NAMESPACE}: baseURL must be an absolute URL (got ${JSON.stringify(value.baseURL)})`,
    )
  }
  // `YYYY-MM-DD` sorts lexicographically, so a plain string comparison is the
  // same ordering the two dates carry.
  if (value.startDate !== undefined && value.endDate !== undefined && value.startDate > value.endDate) {
    throw new Error(
      `${TAVILY_SETTINGS_NAMESPACE}: startDate (${value.startDate}) must not be after endDate (${value.endDate})`,
    )
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  // `new URL` accepts a relative string only with a base argument; called with
  // one argument it throws for a relative value and returns an absolute URL for
  // any absolute `http(s)`/`ws(s)`/file input, so the throw is the reject path.
  try {
    new URL(baseURL)
    return true
  } catch {
    return false
  }
}

/** True for a result limit that can be sent to Tavily (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
