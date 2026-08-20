/**
 * Constants shared by the client-half modules.
 *
 * Mirrors the host half's `TAVILY_SETTINGS_NAMESPACE` and is kept in sync by
 * string equality — the client must not import a host package, so the value
 * is duplicated rather than imported.
 * @module dsh-tavily-search-plugin/client/constants
 */

/** Settings namespace the host half installs and this card edits. */
export const NAMESPACE = 'web-search-tavily'

/** Plugin display name shown on the card header. */
export const DISPLAY_NAME = 'Tavily'

/** Short subtitle shown under the card title. */
export const DISPLAY_DESCRIPTION = 'Tavily-backed web search provider (free tier via Tavily API).'
