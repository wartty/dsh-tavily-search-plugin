/**
 * dsh-tavily-search-plugin — client half entry.
 *
 * Responsibilities:
 * - register this plugin's dictionaries with the Client locale service
 * - inject the card stylesheet (one `<style data-plugin>` tag) once per page
 * - register the Tavily config item with the Plugin Manager (`plugins.item`)
 *
 * Declares every client service the page binds, so the browser cordis instance
 * parks this plugin until each provider is mounted (the list mirrors the shipped
 * `dsh-client-ui-settings-web-search` page, which does the same job for the
 * in-box provider). `locale` is in the list because the card's copy must be
 * resolvable before the first render: a slot entry that declares a locale
 * namespace fails loud without an installed locale face.
 *
 * No `@deepseek-ai/dsh-client-*` value import — see `types.ts` for the
 * minimal-surface approach that keeps the bundle standalone.
 * @module dsh-tavily-search-plugin/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { TAVILY_SETTINGS_NAMESPACE } from '../shared.ts'
import { registerConfigCard } from './config-card.ts'
import { en, zh } from './locales.ts'
import { injectStyles } from './styles.ts'

/**
 * Required client services (cordis fiber inject): the slot seat the page
 * registers into (`slots`), the per-entry config forms it edits (`configForms`),
 * the Client locale service carrying the card's copy (`locale`), and the remote
 * surface carrying both the credential domain and its invalidation events
 * (`remote`, `remote.credentials`).
 */
export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.credentials']

/** Register the dictionaries, mount the stylesheet once, register the config item. */
export function apply(ctx: Context): void {
  // Both tables land in ONE call so a language can never be half-installed, and
  // the effect's disposer removes exactly this call's entries — an HMR reload
  // (unload → apply) re-registers the namespace without tripping the runtime's
  // duplicate occupant guard. The minimal surface types the return as `unknown`,
  // so the disposer shape is narrowed at this one boundary.
  ctx.effect(
    () => ctx.locale.register(TAVILY_SETTINGS_NAMESPACE, { en, zh }) as () => void,
    'tavily: dictionaries',
  )
  injectStyles()
  registerConfigCard(ctx)
}
