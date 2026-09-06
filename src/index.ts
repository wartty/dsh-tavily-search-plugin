/**
 * dsh-tavily-search-plugin — host half.
 *
 * Registers a Tavily-backed `WebSearchProvider` with `ctx.web` so the harness's
 * built-in `web_search` tool (via `@deepseek-ai/dsh-tool-web`) can search the
 * web for free through Tavily instead of DeepSeek's paid search.
 *
 * This is a standalone, out-of-tree Cordis plugin — it is NOT part of the
 * DeepSeek Harness checkout and does not modify any Harness source file. It is
 * a function/namespace plugin exactly like the in-box
 * `@deepseek-ai/dsh-web-search-exa` provider: it registers INTO the web seam's
 * provider registry; it does not own the `ctx.web` key.
 *
 * Endpoint: `POST {baseURL}/search` (default https://api.tavily.com)
 * Auth:     `Authorization: Bearer <api key>`
 *
 * The browser half (`src/client/`) contributes the settings card on the
 * Settings → Plugins page; this file installs the settings namespace it edits.
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import packageJson from '../package.json' with { type: 'json' }

/** Cordis plugin name used by loader diagnostics and the settings namespace. */
export const name = 'web-search-tavily'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Stable provider id registered in the web seam's search registry. */
export const TAVILY_PROVIDER_ID = 'tavily'

/** Default Tavily search endpoint; `/search` is the operation. */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'

/** Default search depth Tavily applies when a request doesn't override it.
 * `advanced` returns higher-relevance, multi-snippet content (2 credits/req);
 * the cheaper `basic`/`fast`/`ultra-fast` (1 credit) are one card toggle away. */
export const TAVILY_DEFAULT_SEARCH_DEPTH = 'advanced' as const

/** Default for asking Tavily to also generate a natural-language answer. */
export const TAVILY_DEFAULT_INCLUDE_ANSWER = true

/** Default number of results Tavily returns when neither the caller nor the section names one. */
export const TAVILY_DEFAULT_MAX_RESULTS = 7

/** Default content chunks retrieved per source; `1` keeps snippets short and focused. */
export const TAVILY_DEFAULT_CHUNKS_PER_SOURCE = 1

/**
 * Default `topic` passed to Tavily. `'general'` is the broad-relevance mode
 * suited to technical and long-tail queries; switch to `'news'` (card dropdown)
 * when you specifically want real-time headlines, or `'finance'` for market data.
 */
export const TAVILY_DEFAULT_TOPIC: TavilyTopic = 'general'

/**
 * Default `days` time window handed to Tavily. `0` means "no window" — the
 * sensible default for `topic: 'general'` technical queries, so older reference
 * pages aren't filtered out. Only effective under `topic: 'news'`; the newer
 * `timeRange` field takes precedence when set.
 */
export const TAVILY_DEFAULT_DAYS = 0

/** Maximum `maxResults` Tavily accepts (search API hard ceiling). */
const TAVILY_MAX_RESULTS_CEILING = 20

/** Tavily search-depth vocabulary (REST API current enum). */
export const TAVILY_SEARCH_DEPTHS = ['basic', 'advanced', 'fast', 'ultra-fast'] as const
export type TavilySearchDepth = typeof TAVILY_SEARCH_DEPTHS[number]

/** Tavily topic vocabulary (REST API current enum). */
export const TAVILY_TOPICS = ['general', 'news', 'finance'] as const
export type TavilyTopic = typeof TAVILY_TOPICS[number]

/** Tavily `time_range` vocabulary (short and long forms). */
export const TAVILY_TIME_RANGES = ['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y'] as const
export type TavilyTimeRange = typeof TAVILY_TIME_RANGES[number]

/** Attribution header sent on every request (version derived from the manifest). */
const USER_AGENT = `deepseek-harness-tavily/${packageJson.version}`

/** Environment variable naming this provider's API key. */
export const TAVILY_API_KEY_ENV = 'TAVILY_API_KEY'

/** Settings namespace carrying this provider's endpoint and key reference. */
export const TAVILY_SETTINGS_NAMESPACE = settingsNamespace(name)

/** `YYYY-MM-DD` shape for Tavily's `start_date` / `end_date`. */
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/

/**
 * Plugin config (all optional — `apply` fills env-var and constant defaults).
 * @typedef {Object} Config
 * @property {string} [apiKey] Literal Tavily API key; prefer `apiKeyEnv`.
 * @property {string} [apiKeyEnv] Credential reference; defaults to `TAVILY_API_KEY`.
 * @property {string} [baseURL] Endpoint base; `/search` is appended.
 * @property {'basic'|'advanced'|'fast'|'ultra-fast'} [searchDepth] Tavily search depth; default `'advanced'`.
 * @property {number} [maxResults] Default result count when a request carries none (1–20).
 * @property {boolean} [includeAnswer] Ask Tavily to also return a generated answer.
 * @property {'general'|'news'|'finance'} [topic] Tavily result category; default `'general'`.
 * @property {number} [days] Limit results to the last N days (0 disables); legacy form,
 *   superseded by `timeRange` but still honoured for backward compatibility. Default `0`.
 * @property {'day'|'week'|'month'|'year'|'d'|'w'|'m'|'y'} [timeRange] Tavily's current
 *   time-window form; takes precedence over `days` when set.
 * @property {string} [startDate] Returns only sources after this `YYYY-MM-DD` date.
 * @property {string} [endDate] Returns only sources before this `YYYY-MM-DD` date.
 * @property {string[]} [includeDomains] Domains to restrict results INTO.
 * @property {string[]} [excludeDomains] Domains to exclude from results.
 * @property {number} [chunksPerSource] Content chunks per source (1–3); default `1`.
 */
export interface TavilyConfig {
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
}

export const Config = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref'),
  baseURL: z.string(),
  searchDepth: z.union([...TAVILY_SEARCH_DEPTHS]),
  maxResults: z.number().step(1).min(1).max(TAVILY_MAX_RESULTS_CEILING),
  includeAnswer: z.boolean(),
  topic: z.union([...TAVILY_TOPICS]),
  days: z.number().step(1).min(0),
  timeRange: z.union([...TAVILY_TIME_RANGES]),
  startDate: z.string().pattern(YYYY_MM_DD),
  endDate: z.string().pattern(YYYY_MM_DD),
  includeDomains: z.array(z.string()),
  excludeDomains: z.array(z.string()),
  chunksPerSource: z.number().step(1).min(1).max(3),
})

/**
 * Resolved provider options (the plugin's `apply` supplies env-var and constant defaults).
 * Every field is already defaulted here, so `search()` never re-checks for missing values.
 */
interface TavilySearchProviderOptions {
  apiKey?: string
  baseURL: string
  searchDepth: TavilySearchDepth
  maxResults: number
  includeAnswer: boolean
  topic: TavilyTopic
  days: number
  timeRange?: TavilyTimeRange
  startDate?: string
  endDate?: string
  includeDomains: string[]
  excludeDomains: string[]
  chunksPerSource: number
  resolveApiKey?: () => Promise<string | undefined>
}

/**
 * Project a resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx context supplying the credential and environment planes.
 * @param config the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(ctx: Context, config: TavilyConfig): TavilySearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? TAVILY_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  const resolveApiKey = async (): Promise<string | undefined> => {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
    // Without the seam the environment is the whole credential plane.
    const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
    return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
  }
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey,
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
  }
}

/**
 * Map one Tavily result to a normalized source object.
 * @param result one entry of Tavily's flat `results[]`.
 * @returns the normalized source.
 */
function mapTavilyResult(result: { url?: string; title?: string; content?: string }): {
  url: string
  title?: string
  snippet?: string
} {
  const url = result.url ?? ''
  const source: { url: string; title?: string; snippet?: string } = { url }
  if (result.title != null && result.title.length > 0) {
    source.title = result.title
  }
  if (result.content != null && result.content.length > 0) {
    // Cap the snippet so a long page extract doesn't flood the model context.
    source.snippet = result.content.length > 600
      ? `${result.content.slice(0, 597)}…`
      : result.content
  }
  return source
}

/**
 * The Tavily-backed search provider. HTTP redirects fail as `WEB_PROVIDER_ERROR`.
 */
export class TavilySearchProvider {
  private readonly resolveOptions: () => TavilySearchProviderOptions

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   *   once at each operation's entry so one search never mixes two sections.
   *   A thunk rather than a value because the plugin's settings section can
   *   change between searches, and re-registering the provider to carry a new
   *   endpoint would make the seam's selection observable to the user as a
   *   flicker.
   */
  constructor(resolveOptions: () => TavilySearchProviderOptions) {
    this.resolveOptions = resolveOptions
  }

  get id(): string {
    return TAVILY_PROVIDER_ID
  }

  available(): boolean {
    // A key may come from the environment/credential resolver rather than a
    // literal, so a present resolver makes the provider available exactly as
    // the in-box DeepSeek provider does.
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && isValidBaseUrl(options.baseURL)
      && isPositiveInteger(options.maxResults)
  }

  async search(
    request: { query: string; maxResults?: number },
    signal?: AbortSignal,
  ): Promise<{ content?: string; sources: { url: string; title?: string; snippet?: string }[]; truncated: boolean }> {
    // One snapshot for the whole operation, so a settings write landing mid-call
    // cannot mix the key of one section with the endpoint of another.
    const options = this.resolveOptions()
    // The configured default is the hard ceiling: a request may ask for fewer
    // results, but never more — this keeps Tavily usage within the free tier
    // regardless of the host tool layer's own source cap.
    const requested = request.maxResults ?? options.maxResults
    const maxResults = Math.min(requested, options.maxResults)
    const apiKey = options.apiKey ?? await options.resolveApiKey?.()
    if (apiKey === undefined || apiKey.length === 0) {
      throw new WebError('Tavily API key is not configured', 'WEB_PROVIDER_ERROR')
    }

    let response: Response
    try {
      response = await fetch(`${options.baseURL}/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          query: request.query,
          topic: options.topic,
          search_depth: options.searchDepth,
          ...maxResults !== undefined ? { max_results: maxResults } : {},
          // Time window: the current `time_range` form wins; the legacy `days`
          // window (0 = disabled) is a fallback for existing configs.
          ...options.timeRange !== undefined
            ? { time_range: options.timeRange }
            : (options.days > 0 ? { days: options.days } : {}),
          ...options.startDate !== undefined ? { start_date: options.startDate } : {},
          ...options.endDate !== undefined ? { end_date: options.endDate } : {},
          ...options.includeDomains.length > 0 ? { include_domains: options.includeDomains } : {},
          ...options.excludeDomains.length > 0 ? { exclude_domains: options.excludeDomains } : {},
          chunks_per_source: options.chunksPerSource,
          include_answer: options.includeAnswer,
          include_raw_content: false,
          include_images: false,
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error) {
      if (isAbortError(error)) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Tavily search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Tavily API error (HTTP ${status})`
      try {
        const parsed = await response.json()
        const detail = parsed.detail ?? parsed.error ?? parsed.message
        if (typeof detail === 'string' && detail.length > 0) message = detail
      } catch (error) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider error.
        if (isAbortError(error)) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise the HTTP status is already captured in `message` above.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    let payload: { results?: { url?: string; title?: string; content?: string }[]; answer?: string }
    try {
      payload = await response.json()
    } catch (error) {
      if (isAbortError(error)) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Tavily returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    const sources = (payload.results ?? []).map(mapTavilyResult)
    const content = payload.answer != null && payload.answer.length > 0
      ? payload.answer
      : undefined
    return {
      ...content !== undefined ? { content } : {},
      sources,
      truncated: false,
    }
  }
}

/** Register the Tavily search provider with `ctx.web`. */
export function apply(ctx: Context, config: TavilyConfig): void {
  let current: TavilyConfig = config
  // Compose the section's base layer: defaults the user has not overridden,
  // so the card renders pre-populated and a save that leaves a field alone
  // preserves the default.
  const base: TavilyConfig = {
    maxResults: TAVILY_DEFAULT_MAX_RESULTS,
    ...config,
  }
  installSettingsSection(ctx, TAVILY_SETTINGS_NAMESPACE, Config, base, {
    setSource: (source: TavilyConfig) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per search, so a committed change needs no re-registration.
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new TavilySearchProvider(() => resolveOptions(ctx, current)))
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  // `new URL` accepts relative strings only with a base argument; called with
  // one argument it throws for a relative value and returns an absolute URL for
  // any absolute `http(s)`/`ws(s)`/file input, so the throw is the reject path.
  try {
    new URL(baseURL)
    return true
  } catch {
    return false
  }
}

/** True for a request limit that can be sent to Tavily (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}