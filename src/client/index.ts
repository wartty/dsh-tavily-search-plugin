/**
 * dsh-tavily-search-plugin — client half entry.
 *
 * Responsibilities:
 * - inject the card stylesheet (one `<style data-plugin>` tag) once per page
 * - register the Tavily card into the `settings.plugin.item` slot
 *
 * Declares only the `slots` dependency: the card uses `settingsScope`
 * opportunistically (cards render in a "no settings service" state when it
 * is absent), and the loader does not need to gate plugin loading on it.
 *
 * No `@deepseek-ai/dsh-client-*` value import — see `types.ts` for the
 * minimal-surface approach that keeps the bundle standalone.
 * @module dsh-tavily-search-plugin/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerConfigCard } from './config-card.ts'
import { injectStyles } from './styles.ts'

/** Dependency: load only after the slot service is mounted. */
export const inject = ['slots']

/** Mount the stylesheet once and register the card. */
export function apply(ctx: Context): void {
  injectStyles()
  registerConfigCard(ctx)
}
