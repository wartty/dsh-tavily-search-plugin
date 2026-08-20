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

/** Cordis plugin name used by loader diagnostics and the settings namespace. */
export const name = 'web-search-tavily'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Stable provider id registered in the web seam's search registry. */
export const TAVILY_PROVIDER_ID = 'tavily'

/** Default Tavily search endpoint; `/search` is the operation. */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'

/** Default search depth Tavily applies when a request doesn't override it. */
export const TAVILY_DEFAULT_SEARCH_DEPTH = 'basic'

/** Default for asking Tavily to also generate a natural-language answer. */
export const TAVILY_DEFAULT_INCLUDE_ANSWER = true

/** Default number of results Tavily returns when neither the caller nor the section names one. */
export const TAVILY_DEFAULT_MAX_RESULTS = 7

/**
 * Default `topic` passed to Tavily. `'news'` biases results toward news-article
 * sources and (crucially) toward fresh content — without it, Tavily's `general`
 * topic returns whatever it has indexed, which for a 2026 query can surface
 * 2025/older pages and skip the day's headlines.
 */
export const TAVILY_DEFAULT_TOPIC: 'general' | 'news' = 'news'

/**
 * Default `days` window passed to Tavily. Restricts results to the last N days;
 * combined with `topic: 'news'` this guarantees that queries like "今天的新闻"
 * land on today's headlines rather than 2025 archive pages that happen to
 * contain the same keywords. Override via cordis.patch.yml if you need older
 * material.
 */
export const TAVILY_DEFAULT_DAYS = 7

/** Attribution header sent on every request. */
const USER_AGENT = 'deepseek-harness-tavily/0.2.0'

/** Environment variable naming this provider's API key. */
export const TAVILY_API_KEY_ENV = 'TAVILY_API_KEY'

/** Settings namespace carrying this provider's endpoint and key reference. */
export const TAVILY_SETTINGS_NAMESPACE = settingsNamespace(name)

/**
 * Plugin config (all optional — `apply` fills env-var and constant defaults).
 * @typedef {Object} Config
 * @property {string} [apiKey] Literal Tavily API key; prefer `apiKeyEnv`.
 * @property {string} [apiKeyEnv] Credential reference; defaults to `TAVILY_API_KEY`.
 * @property {string} [baseURL] Endpoint base; `/search` is appended.
 * @property {'basic'|'advanced'} [searchDepth] Tavily search depth.
 * @property {number} [maxResults] Default result count when a request carries none.
 * @property {boolean} [includeAnswer] Ask Tavily to also return a generated answer.
 * @property {'general'|'news'} [topic] Tavily result topic. Defaults to `'news'`
 *   so date-anchored queries return fresh headlines instead of stale archives.
 * @property {number} [days] Limit results to the last N days. Defaults to 7.
 *   Set to a larger value (or remove via `cordis.patch.yml` override) for
 *   historical research.
 */
export interface TavilyConfig {
  apiKey?: string
  apiKeyEnv?: string
  baseURL?: string
  searchDepth?: 'basic' | 'advanced'
  maxResults?: number
  includeAnswer?: boolean
  topic?: 'general' | 'news'
  days?: number
}

export const Config = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref'),
  baseURL: z.string(),
  searchDepth: z.union(['basic', 'advanced']),
  maxResults: z.number().step(1).min(1),
  includeAnswer: z.boolean(),
  topic: z.union(['general', 'news']),
  days: z.number().step(1).min(1),
})

/**
 * Resolved provider options (the plugin's `apply` supplies env-var and constant defaults).
 * @typedef {Object} TavilySearchProviderOptions
 * @property {string} [apiKey] Tavily API key. Empty/absent makes the provider unavailable.
 * @property {string} baseURL Endpoint base; `/search` is appended.
 * @property {'basic'|'advanced'} searchDepth Tavily search depth.
 * @property {number} maxResults Default result count when a request carries none.
 * @property {boolean} includeAnswer Whether Tavily should also return a generated answer.
 * @property {'general'|'news'} topic Tavily result topic. `'news'` biases to fresh news.
 * @property {number} days Limit results to last N days.
 * @property {() => Promise<string|undefined>} [resolveApiKey] Optional async key resolver.
 */
interface TavilySearchProviderOptions {
  apiKey?: string
  baseURL: string
  searchDepth: 'basic' | 'advanced'
  maxResults: number
  includeAnswer: boolean
  topic: 'general' | 'news'
  days: number
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
          ...options.days > 0 ? { days: options.days } : {},
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
  // Compose the section's base layer: composition defaults the user has not
  // overridden, so the card renders pre-populated (maxResults shows 5, not
  // blank) and a save that leaves the field alone preserves the default.
  const base: TavilyConfig = { maxResults: TAVILY_DEFAULT_MAX_RESULTS, ...config }
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
  try {
    return new URL(baseURL) !== null
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
