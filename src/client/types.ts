/**
 * Browser-side minimal surface for the dependencies this plugin consumes.
 *
 * The plugin's client half ships as a standalone bundle outside the DSH
 * monorepo, so it must NOT value-import any `@deepseek-ai/dsh-client-*` package
 * — the monorepo's purity gate forbids it, and even without that gate a value
 * import would carry the package's runtime identity into our bundle (two
 * copies of the same module loader, two `__ModuleLoader__` registrations, etc.).
 *
 * Each interface below is the subset of the real client API this plugin uses;
 * the runtime instances come from `ctx.slots` / `ctx.settingsScope`, declared
 * via the module augmentation at the bottom of this file. The augmentation
 * sits on `@deepseek-ai/cordis` because cordis is the only `@deepseek-ai`
 * package we declare as a peer dependency of the client half.
 * @module dsh-tavily-search-plugin/client/types
 */

/** A settings namespace snapshot (the structural subset of `SettingsScopeSnapshot`). */
export interface SettingsSnapshot {
  /** `'loading'` until the host answers; `'ready'` once value is settled; `'unavailable'` when the namespace is hidden or the service is missing. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Last schema-resolved value (schema defaults → composition base → user layer); undefined until the first accepted value arrives. */
  value: unknown
  /** Raw user-layer value; a field that appears here counts as a user override. */
  user: unknown
  /** Whether the host document accepts writes (memory mode is always false). */
  writable: boolean
}

/** Browser-side settings scope (the subset of `dsh-client-runtime`'s `SettingsScope`). */
export interface SettingsScopeLike {
  getSnapshot(): SettingsSnapshot
  /** Observe snapshot replacement; returns a disposer. */
  subscribe(listener: () => void): () => void
  /** Write one field (revision fenced; re-reads host state on conflict). */
  set(field: string, value: unknown): Promise<void>
  /** Clear one field so it inherits the composition base layer. */
  unset(field: string): Promise<void>
}

/** `ctx.settingsScope` (the subset of `dsh-client-ui-settings`'s `SettingsScopeBinder`). */
export interface SettingsScopeBinderLike {
  bind(spec: { namespace: string }): SettingsScopeLike
}

/** One credential's state as the credentials domain reports it. */
export interface CredentialSummary {
  configured: boolean
  writable: boolean
}

/**
 * The browser credential domain (`ctx.remote.credentials`).
 *
 * The API key lives HERE rather than in the settings document: settings values
 * travel back to the browser on every read, while this domain keeps the secret
 * beside the harness and reports only whether it is set and writable.
 *
 * Signatures are POSITIONAL and the answer is the bare `{ ok, value }` envelope
 * — this is the generated remote face, not the settings scope's field API
 * (`dsh-client-ui-settings-plugins`'s `WebSearchCard` calls it the same way).
 */
export interface RemoteCredentialsLike {
  /** Ask which of `refs` hold a value; `value` is keyed by reference. */
  describe(refs: readonly string[]): Promise<{
    ok: boolean
    value: Record<string, CredentialSummary | undefined>
  }>
  /** Write one literal under `ref`. Rejection means the write did not land. */
  set(ref: string, value: string): Promise<unknown>
}

/**
 * `ctx.remote` — the browser remote surface this card uses: the event bus for
 * credential invalidations, plus the credentials domain itself.
 */
export interface RemoteLike {
  $on(event: string, listener: (payload: unknown) => void): () => void
  credentials: RemoteCredentialsLike
}

/**
 * One slot-register call's minimal option set (subset of `dsh-client-ui-slots`).
 *
 * Only the fields this plugin passes are modelled: a KEYED entry is addressed by
 * `key` and owns everything about itself, so `id`/`order`/`label` (list-slot
 * concerns) are deliberately absent here.
 */
export interface SlotOptions {
  /** Target slot name, e.g. `'settings.plugin.item'`. */
  name: string
  /** Keyed-slot key: the settings namespace this card edits. */
  key: string
  /**
   * Props factory the slot calls before rendering the entry, so the card
   * receives its controller as props instead of closing over it — the component
   * identity then stays stable across re-registrations.
   */
  inject?: () => Record<string, unknown>
}

/** Browser-side slot service (subset of `dsh-client-ui-slots`). */
export interface SlotsLike {
  /** Register once the target slot has been declared; returns a disposer. */
  inject(name: string, register: () => unknown): void
  /** Contribute one entry to an already-declared slot. */
  register(options: SlotOptions, component: unknown): unknown
}

// cordis's Context has no `slots` or `settingsScope` members of its own —
// they're merged in by the client-ui-slots and client-ui-settings packages.
// Our standalone bundle depends on neither, so we merge the same shape here
// and let the runtime instances come from the loader.
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser slot service (provided at runtime by `dsh-client-ui-slots`). */
    slots: SlotsLike
    /** Browser settings-scope binder (provided at runtime by `dsh-client-ui-settings`). */
    settingsScope: SettingsScopeBinderLike
  }
}
