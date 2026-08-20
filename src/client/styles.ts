/**
 * One-shot CSS injection for the client half.
 *
 * Every `dstav-*` class lives in a single `<style data-plugin data-plugin-css>`
 * tag; client-modules reads the `data-plugin` attribute to attribute the
 * stylesheet to this plugin, so updates to the plugin version replace it.
 *
 * Colours go through theme variables (`--dsw-alias-*`, defined in
 * `packages/client/ui-theme/src/styles/design-platform.css`) so the card
 * follows the user's light/dark theme automatically.
 * @module dsh-tavily-search-plugin/client/styles
 */

import { NAMESPACE } from './constants.ts'

declare const document: {
  createElement(tag: 'style'): {
    dataset: Record<string, string>
    textContent: string
  }
  head: {
    appendChild(node: { dataset: Record<string, string>; textContent: string }): void
  }
}

let stylesInjected = false

/** Inject the card's stylesheet into the document head; no-op after the first call. */
export function injectStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  stylesInjected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = NAMESPACE
  tag.dataset.pluginCss = `${NAMESPACE}/card`
  tag.textContent = `
.dstav-card {
  list-style: none;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color .16s, background .16s;
  margin: 0;
  padding: 0;
}
.dstav-card:hover { border-color: var(--dsw-alias-label-dimmed); }
.dstav-card-open { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-label-dimmed); }
.dstav-header {
  width: 100%; appearance: none; border: 0; background: none; font: inherit;
  color: inherit; text-align: left; cursor: pointer;
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border-radius: 12px;
}
.dstav-head-text {
  display: flex; flex-direction: column; gap: 2px;
  min-width: 0; flex: 1;
}
.dstav-name {
  color: var(--dsw-alias-label-primary);
  font-size: 15px; font-weight: 600; line-height: 1.4;
}
.dstav-description {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px; line-height: 1.5;
}
.dstav-pending {
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px; font-weight: 500; line-height: 17px;
}
.dstav-chevron {
  color: var(--dsw-alias-label-secondary);
  transition: transform .16s;
  flex-shrink: 0;
}
.dstav-chevron-open { transform: rotate(180deg); }
.dstav-body {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding: 4px 16px 16px;
  display: flex; flex-direction: column; gap: 6px;
}
.dstav-read-only {
  color: var(--dsw-alias-label-tertiary);
  margin: 0; padding-top: 12px;
  font-size: 12px; line-height: 1.5;
}
.dstav-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding-top: 12px;
}
.dstav-failed {
  color: var(--dsw-alias-label-error);
  margin: 0; flex: 1;
  font-size: 12px; line-height: 1.5;
}
.dstav-discard {
  font: inherit; color: var(--dsw-alias-label-secondary);
  background: 0 0; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  padding: 6px 12px; font-size: 13px; line-height: 1.5;
}
.dstav-discard:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-label-dimmed);
}
.dstav-discard:disabled { cursor: default; opacity: .5; }
.dstav-save {
  font: inherit; color: var(--dsw-alias-bg-layer-1);
  background: var(--dsw-alias-label-primary);
  cursor: pointer;
  border: 0; border-radius: 8px;
  padding: 6px 14px; font-size: 13px; font-weight: 500; line-height: 1.5;
}
.dstav-save:hover:not(:disabled) { filter: brightness(1.08); }
.dstav-save:disabled { cursor: default; opacity: .5; }
.dstav-field {
  flex-direction: column; gap: 6px;
  padding: 12px 0;
  display: flex;
}
.dstav-field + .dstav-field {
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dstav-field-head {
  align-items: center; gap: 8px;
  display: flex;
}
.dstav-label {
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  flex: 1;
  font-size: 13px; font-weight: 500; line-height: 1.5;
}
.dstav-badges {
  align-items: center; gap: 8px;
  display: inline-flex;
}
.dstav-badge {
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px; font-weight: 500; line-height: 17px;
}
.dstav-badge-muted {
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px; line-height: 17px;
}
.dstav-reset {
  font: inherit;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: 0 0; border: none;
  padding: 0;
  font-size: 12px; line-height: 1.5;
}
.dstav-reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.dstav-reset:disabled { cursor: default; opacity: .5; }
.dstav-input {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3);
  height: 34px;
  font: inherit;
  color: var(--dsw-alias-label-primary);
  border-radius: 8px;
  padding: 0 12px;
  font-size: 13px; line-height: 1.5;
}
.dstav-input:focus-visible {
  border-color: var(--dsw-alias-brand-primary);
  outline: none;
}
.dstav-input:disabled {
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
}
.dstav-input-invalid {
  border-color: var(--dsw-alias-label-error);
}
.dstav-invalid {
  color: var(--dsw-alias-label-error);
  margin: 0;
  font-size: 12px; line-height: 1.5;
}
.dstav-hint {
  color: var(--dsw-alias-label-tertiary);
  margin: 0;
  font-size: 12px; line-height: 1.5;
}
.dstav-status {
  display: flex; flex-direction: column; gap: 4px;
  padding: 14px 16px;
}
.dstav-status-title {
  color: var(--dsw-alias-label-primary);
  margin: 0;
  font-size: 13px; font-weight: 500; line-height: 1.5;
}
.dstav-status-body {
  color: var(--dsw-alias-label-secondary);
  margin: 0;
  font-size: 12px; line-height: 1.6;
}
`
  document.head.appendChild(tag)
}
