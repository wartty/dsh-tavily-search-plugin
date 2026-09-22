/**
 * dsh-tavily-search-plugin — client half entry.
 *
 * Responsibilities:
 * - inject the card stylesheet (one `<style data-plugin>` tag) once per page
 * - register the Tavily card into the `settings.plugin.item` slot
 *
 * Declares every client service the card binds, so the browser cordis instance
 * parks this plugin until each provider is mounted. A `slots`-only declaration
 * once let `apply` run before the settings scope existed, which left the card
 * rendering its "settings service unavailable" state with no config fields.
 *
 * No `@deepseek-ai/dsh-client-*` value import — see `types.ts` for the
 * minimal-surface approach that keeps the bundle standalone.
 * @module dsh-tavily-search-plugin/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerConfigCard } from './config-card.ts'
import { injectStyles } from './styles.ts'

/**
 * Required client services (cordis fiber inject): the slot seat the card
 * registers into (`slots`), the settings scope it edits (`settingsScope`), and
 * the remote surface carrying both the credential domain and its invalidation
 * events (`remote`, `remote.credentials`).
 */
export const inject = ['slots', 'settingsScope', 'remote', 'remote.credentials']

/** Mount the stylesheet once and register the card. */
export function apply(ctx: Context): void {
  injectStyles()
  registerConfigCard(ctx)
}
