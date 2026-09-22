/**
 * Facts BOTH halves of this plugin must agree on.
 *
 * The host half validates these values and puts them on the wire; the browser
 * half renders the same lists as card dropdown options and copies the MCP tool
 * ids into its guidance text. One copy is what keeps a vocabulary change from
 * silently desynchronizing the dropdown from the request body, and the tool ids
 * from drifting out of the hand-off message.
 *
 * PURITY RULE: this module is bundled into the Node (ESM) host build *and* the
 * browser (CJS) client build, so it may only contain plain data and pure
 * functions — no `node:` import, no `@deepseek-ai/dsh-*` value import, no global
 * access, no side effects.
 * @module dsh-tavily-search-plugin/shared
 */

/** Stable provider id registered in the web seam's search registry. */
export const TAVILY_PROVIDER_ID = 'tavily'

/**
 * Credential reference the API key lives under unless the section names another
 * one. Both halves need it: the host resolves it, the card shows which reference
 * it is resolving.
 */
export const TAVILY_API_KEY_ENV = 'TAVILY_API_KEY'

/**
 * Settings namespace this provider registers its section under and the card
 * edits. One definition for both halves: the card used to mirror the string in a
 * client-local constant, where a drift would silently unpair it from the host.
 */
export const TAVILY_SETTINGS_NAMESPACE = 'web-search-tavily'

/** Tavily search-depth vocabulary (REST API current enum). */
export const TAVILY_SEARCH_DEPTHS = ['basic', 'advanced', 'fast', 'ultra-fast'] as const
export type TavilySearchDepth = typeof TAVILY_SEARCH_DEPTHS[number]

/** Tavily topic vocabulary (REST API current enum). */
export const TAVILY_TOPICS = ['general', 'news', 'finance'] as const
export type TavilyTopic = typeof TAVILY_TOPICS[number]

/** Tavily `time_range` vocabulary (short and long forms). */
export const TAVILY_TIME_RANGES = ['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y'] as const
export type TavilyTimeRange = typeof TAVILY_TIME_RANGES[number]

/**
 * The Tavily MCP server's tool ids exactly as the harness mounts them
 * (`mcp__<serverName>__<toolName>`), so both halves name the same strings.
 */
export const TAVILY_MCP_TOOLS = {
  search: 'mcp__tavily__tavily_search',
  extract: 'mcp__tavily__tavily_extract',
  crawl: 'mcp__tavily__tavily_crawl',
  map: 'mcp__tavily__tavily_map',
} as const

/** One Tavily MCP tool id (`mcp__tavily__*`). */
export type TavilyMcpTool = typeof TAVILY_MCP_TOOLS[keyof typeof TAVILY_MCP_TOOLS]

/**
 * The answer `web_search` gives while MCP hand-off mode is on.
 *
 * `web_search` cannot be unmounted from the preset layer, so the call answers
 * with directions instead of searching — which is also what keeps MCP mode from
 * spending REST credits on a search the model did not ask the provider for.
 * @returns guidance naming the MCP tools to use instead.
 */
export function mcpHandoffText(): string {
  return 'web_search 已处于 Tavily MCP 模式（useMcp: true），本次调用不执行搜索，也不消耗 Tavily 配额。'
    + `请改用 ${TAVILY_MCP_TOOLS.search} 工具完成网页搜索；`
    + `页面提取、站点爬取与站点地图分别对应 ${TAVILY_MCP_TOOLS.extract}`
    + ` / ${TAVILY_MCP_TOOLS.crawl} / ${TAVILY_MCP_TOOLS.map}。`
}
