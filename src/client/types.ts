/**
 * Browser-side minimal surface for the dependencies this plugin consumes.
 *
 * The plugin's client half ships as a standalone bundle outside the DSH
 * monorepo, so it must NOT value-import any `@deepseek-ai/dsh-client-*` package
 * — the monorepo's purity gate forbids it, and even without that gate a value
 * import would carry the package's runtime identity into our bundle (two copies
 * of the same module loader, two `__ModuleLoader__` registrations, etc.).
 *
 * DSH 0.2.0 replaced the settings scope with `configForms`: one form per profile
 * ENTRY id, read and written through the same `getSnapshot/subscribe/set/unset`
 * shape the scope exposed. The runtime instances come from `ctx.configForms`,
 * `ctx.slots` and `ctx.locale` (the Client locale service every visible string
 * resolves through), declared via the module augmentation at the bottom of this
 * file.
 * @module dsh-tavily-search-plugin/client/types
 */

/** One entry's config snapshot (the structural subset of the client form's snapshot). */
export interface ConfigSnapshot {
  /**
   * `'idle'`/`'loading'` until the host answers, `'ready'` once a value settles,
   * `'unavailable'` when the entry is not served or edits cannot persist (a
   * non-loopback page holds preferences in memory).
   */
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  /** Last schema-resolved value (schema defaults → composition base → user layer); undefined until the first accepted value arrives. */
  value: unknown
  /** Raw user-layer value; a field that appears here counts as a user override. */
  user: unknown
  /** Revision the next write is fenced against. */
  revision?: number
  /** Whether the host document accepts writes (memory mode is always false). */
  writable: boolean
}

/**
 * One entry's config form (`ctx.configForms.get(entryId)`) — the 0.2.0 successor
 * of the removed settings scope: same read/write shape, keyed by entry id.
 */
export interface ConfigFormLike {
  getSnapshot(): ConfigSnapshot
  /** Observe snapshot replacement; returns a disposer. */
  subscribe(listener: () => void): () => void
  /** Write one field (revision fenced; the write is confirmed by re-reading). */
  set(field: string, value: unknown): Promise<void>
  /** Clear one field so it inherits the layers below the user document. */
  unset(field: string): Promise<void>
}

/** `ctx.configForms` (the subset of `dsh-client-ui-settings`'s ConfigForms this plugin uses). */
export interface ConfigFormsLike {
  /** The config form of one profile entry id. */
  get(entryId: string): ConfigFormLike
  /**
   * Run `register` while ANY of `namespaces` is served by the host, and tear the
   * registration down when none is; returns a disposer. This is what keeps an
   * uninstalled plugin from leaving an item behind in the manager's list.
   */
  whileServed(namespaces: readonly string[], register: () => void): () => void
}

/** One credential's state as the credentials domain reports it. */
export interface CredentialSummary {
  configured: boolean
  writable: boolean
}

/**
 * The browser credential domain (`ctx.remote.credentials`).
 *
 * The API key lives HERE rather than in the config document: config values
 * travel back to the browser on every read, while this domain keeps the secret
 * beside the harness and reports only whether it is set and writable.
 *
 * Signatures are POSITIONAL and the answer is the bare `{ ok, value }` envelope —
 * this is the generated remote face, not the form's field API.
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

/** One language's dictionary: flat copy key → template text (`{name}` placeholders). */
export type LocaleDict = Record<string, string>

/**
 * Namespace-bound translate (`ctx.locale.bind(ns)`). It reads the active locale
 * at CALL time, so a reference captured while registering stays valid across a
 * language switch; `{name}` placeholders interpolate from `params`.
 */
export type TranslateLike = (key: string, params?: Record<string, unknown>) => string

/**
 * `ctx.locale` — the Client locale service (the subset of `dsh-client-locale`'s
 * `LocaleRuntime` this plugin uses).
 *
 * Registering both dictionaries in ONE call is what keeps a language from being
 * half-installed: the runtime rejects a namespace/locale pair it already holds,
 * so the two halves must be the same call. `bind` hands back the translate
 * function the card renders through.
 */
export interface LocaleLike {
  /**
   * Add one namespace's dictionaries, all locales at once.
   * @param ns - namespace owned by this plugin.
   * @param dicts - locale id → flat key/text table.
   * @returns an idempotent disposer removing exactly this call's dictionaries.
   */
  register(ns: string, dicts: Record<string, LocaleDict>): unknown
  /** Bind `ns` to a translate function (stable reference per namespace). */
  bind(ns: string): TranslateLike
}

/**
 * One slot-register call's minimal option set (subset of `dsh-client-ui-slots`).
 *
 * `plugins.item` is a LIST slot: an entry is addressed by `id`, may carry an
 * `order` and a `label`, and its `inject` face hands the component its props.
 */
export interface SlotOptions {
  /** Target slot name, e.g. `'settings.plugins.tab'` or `'plugins.item'`. */
  name: string
  /** List entry id — the plugin row this item configures. */
  id: string
  /** Render order within the list (smaller = earlier). */
  order?: number
  /** Display label, resolved by the slot owner; a thunk follows the active locale. */
  label?: string | (() => string)
  /**
   * Dictionary namespace of this entry's copy, declared so the slot layer keeps
   * registration-time text (the tab/row label) in step with the active locale.
   */
  locale?: string
  /**
   * Props factory the slot calls before rendering the entry, so the card
   * receives its controller as props instead of closing over it — the component
   * identity then stays stable across re-registrations.
   */
  inject?: () => Record<string, unknown>
}

/** Browser-side slot service (subset of `dsh-client-ui-slots`). */
export interface SlotsLike {
  /**
   * Run `register` once the slot named `name` is declared. The registration is
   * tracked by the calling fiber; the return value is a disposer when the
   * implementation provides one (callers that must know treat it as optional).
   */
  inject(name: string, register: () => unknown): (() => void) | undefined
  /** Contribute one entry to an already-declared slot. */
  register(options: SlotOptions, component: unknown): unknown
}

// cordis's Context has no `slots`, `configForms` or `locale` members of its own —
// they are merged in by the client slot package, `dsh-client-ui-settings` and
// `dsh-client-locale`. Our standalone bundle depends on none of them, so we
// merge the same shape here and let the runtime instances come from the loader.
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser slot service (provided at runtime by the client slot package). */
    slots: SlotsLike
    /** Browser plugin-config forms (provided at runtime by `dsh-client-ui-settings`). */
    configForms: ConfigFormsLike
    /** Client locale service (provided at runtime by `dsh-client-locale`). */
    locale: LocaleLike
  }
}
