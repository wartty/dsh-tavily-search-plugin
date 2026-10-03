/**
 * The card's MODEL: which fields exist, how a draft becomes a section value, and
 * the staged-write controller behind Save.
 *
 * Split out of the view on purpose — nothing here imports React or touches the
 * DOM, so the smoke test drives the whole write planner with stub services
 * (`pnpm test`), which is where a silent bug would otherwise corrupt a user's
 * settings document. `config-card.ts` renders what this module reports.
 *
 * WRITE SEMANTICS (mirrors the in-box cards):
 * - A draft the field's own rules refuse refuses the WHOLE save: applying the
 *   valid half would leave the document describing something nobody asked for.
 * - A write is confirmed by re-reading the user layer, not by the promise
 *   resolving: a host that accepts the call and keeps the old value must show up
 *   as a failure, not as a silent no-op with the draft cleared.
 * - Only the fields this save planned are dropped on the way out, so anything
 *   typed while the writes were in flight stays as the next edit.
 *
 * State matrix the view renders against (the card never silently disappears):
 * - `undefined` form: the settings services were absent at mount.
 * - scope `loading`: the host has not answered yet.
 * - scope `unavailable`: hidden from the web surface, or preferences are held in
 *   memory (a non-loopback page).
 * - scope `ready`: the editable form.
 * @module dsh-tavily-search-plugin/client/card-model
 */

import { TAVILY_API_KEY_ENV } from '../shared.ts'
import { TAVILY_SEARCH_DEPTHS, TAVILY_TIME_RANGES, TAVILY_TOPICS } from '../shared.ts'
import type { ConfigFormLike, ConfigSnapshot, RemoteLike } from './types.ts'
import type { CopyKey } from './locales.ts'

// Re-exported so `pnpm test` can assert every field key exists in BOTH language
// tables without reaching into the browser-only bundle.
export { en, zh } from './locales.ts'
export type { CopyKey } from './locales.ts'

// ---- Field declaration ----

/** One editable field of the settings section. */
export interface FieldSpec {
  /** Settings-section field name (the key written to the user layer). */
  field: string
  kind: 'text' | 'number' | 'select' | 'textlist' | 'boolean'
  /** Copy key for the visible label — `t(labelKey)`, never the copy itself. */
  labelKey: CopyKey
  /** Copy key for the hint under the control. */
  hintKey: CopyKey
  /** Copy key shown instead of the hint while the draft is invalid. */
  invalidKey?: CopyKey
  /** Number-field floor (mirrors the schema, so a bad draft is caught before Save). */
  min?: number
  /** Number-field ceiling (mirrors the schema). */
  max?: number
  /**
   * Extra draft format the host schema enforces on top of `kind`. `'date'` is the
   * host's `z.string().pattern(YYYY_MM_DD)`: without it an `'text'` field would
   * accept anything non-empty, and Save would only fail at the host's schema with
   * the generic footer message.
   */
  format?: 'date'
  /** Options for `select` fields — the verbatim wire values, shared with the host. */
  options?: readonly string[]
  /** Placeholder for text / textlist inputs (an example value, not copy). */
  placeholder?: string
}

/**
 * The card's fields, in render order. Options come from `../shared.ts` so a
 * vocabulary change cannot desynchronize this dropdown from the request body the
 * host builds, and `min`/`max`/`format` mirror the host schema so a draft the host
 * would refuse is refused before the round trip.
 */
export const FIELDS: readonly FieldSpec[] = [
  { field: 'baseURL', kind: 'text', labelKey: 'field.baseURL.label', hintKey: 'field.baseURL.hint' },
  {
    field: 'maxResults',
    kind: 'number',
    labelKey: 'field.maxResults.label',
    hintKey: 'field.maxResults.hint',
    invalidKey: 'field.maxResults.invalid',
    min: 1,
    max: 20,
  },
  {
    field: 'searchDepth',
    kind: 'select',
    labelKey: 'field.searchDepth.label',
    hintKey: 'field.searchDepth.hint',
    options: TAVILY_SEARCH_DEPTHS,
  },
  {
    field: 'topic',
    kind: 'select',
    labelKey: 'field.topic.label',
    hintKey: 'field.topic.hint',
    options: TAVILY_TOPICS,
  },
  {
    field: 'timeRange',
    kind: 'select',
    labelKey: 'field.timeRange.label',
    hintKey: 'field.timeRange.hint',
    options: TAVILY_TIME_RANGES,
  },
  {
    field: 'days',
    kind: 'number',
    labelKey: 'field.days.label',
    hintKey: 'field.days.hint',
    invalidKey: 'field.days.invalid',
    min: 0,
  },
  {
    field: 'startDate',
    kind: 'text',
    labelKey: 'field.startDate.label',
    hintKey: 'field.startDate.hint',
    invalidKey: 'field.startDate.invalid',
    format: 'date',
    placeholder: '2026-01-01',
  },
  {
    field: 'endDate',
    kind: 'text',
    labelKey: 'field.endDate.label',
    hintKey: 'field.endDate.hint',
    invalidKey: 'field.endDate.invalid',
    format: 'date',
    placeholder: '2026-12-31',
  },
  {
    field: 'chunksPerSource',
    kind: 'number',
    labelKey: 'field.chunksPerSource.label',
    hintKey: 'field.chunksPerSource.hint',
    invalidKey: 'field.chunksPerSource.invalid',
    min: 1,
    max: 3,
  },
  {
    field: 'snippetMaxChars',
    kind: 'number',
    labelKey: 'field.snippetMaxChars.label',
    hintKey: 'field.snippetMaxChars.hint',
    invalidKey: 'field.snippetMaxChars.invalid',
    min: 16,
  },
  {
    field: 'includeDomains',
    kind: 'textlist',
    labelKey: 'field.includeDomains.label',
    hintKey: 'field.includeDomains.hint',
    placeholder: 'example.com, news.site.org',
  },
  {
    field: 'excludeDomains',
    kind: 'textlist',
    labelKey: 'field.excludeDomains.label',
    hintKey: 'field.excludeDomains.hint',
    placeholder: 'spam.example, junk.org',
  },
  {
    field: 'useMcp',
    kind: 'boolean',
    labelKey: 'field.useMcp.label',
    hintKey: 'field.useMcp.hint',
  },
]

const FIELD_BY_NAME = new Map(FIELDS.map(spec => [spec.field, spec]))

/**
 * The spec for one field.
 * @param field - settings-section field name.
 * @returns the spec.
 * @throws {Error} when the field is misspelled — every caller passes a name from
 *   {@link FIELDS}, so a miss means the two lists drifted, which must not render
 *   an empty control.
 */
export function fieldSpec(field: string): FieldSpec {
  const spec = FIELD_BY_NAME.get(field)
  if (spec === undefined) throw new Error(`web-search-tavily: unknown card field "${field}"`)
  return spec
}

// ---- State ----

/** One staged draft: a new text, or "drop the user override". */
export type StagedEdit =
  | { kind: 'edit'; text: string }
  | { kind: 'clear' }

/** One write Save will run (or refuse), derived from a staged draft. */
export type FieldWrite =
  | { kind: 'set'; field: string; value: unknown }
  | { kind: 'clear'; field: string }
  | { kind: 'refused'; field: string }

/** What the view renders for one field. */
export interface FieldState {
  /** Current text in the control. */
  text: string
  /** Saving this draft would leave (or keep) a user-layer override. */
  overridden: boolean
  /** This field's staged draft would be refused by its own rules. */
  invalid: boolean
}

/** The card-wide projection the header and footer read. */
export interface CardShell {
  status: 'loading' | 'ready' | 'unavailable'
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
}

/** The API-key plane's state (kept out of the settings document on purpose). */
export interface CredentialState {
  /** Credential reference the key is stored under. */
  ref: string
  /** The credentials domain has a value for this reference. */
  configured: boolean
  /** The domain accepts writes. */
  writable: boolean
  /** Last staged literal; cleared once the write lands. */
  staged: string
  /** A non-empty literal is staged. */
  dirty: boolean
  saving: boolean
  failed: boolean
}

/** The credential plane before the host has answered. */
function idleCredential(ref = TAVILY_API_KEY_ENV): CredentialState {
  return { ref, configured: false, writable: true, staged: '', dirty: false, saving: false, failed: false }
}

/** Remote event announcing that a credential reference changed. */
const CREDENTIAL_UPDATED_EVENT = 'credentials/reference-updated'

// ---- Form controller ----

/**
 * Staged form. Edits never touch the document: `save` is the single mutation
 * point, and it confirms each write against the host's user layer before the
 * draft is dropped.
 */
export class CardForm {
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  private readonly disposeScope: () => void
  private readonly disposeRemote: () => void
  private saving = false
  private failed = false
  private credential: CredentialState = idleCredential()
  /** Cached projection: `useSyncExternalStore` needs a value that is stable between publishes. */
  private shellState: CardShell
  private plannedWrites: FieldWrite[]

  constructor(
    private readonly scope: ConfigFormLike,
    private readonly remote: RemoteLike,
  ) {
    this.plannedWrites = this.buildPlan()
    this.shellState = this.buildShell()
    this.disposeScope = scope.subscribe(() => this.publish())
    void this.readCredential()
    // The payload is a ref string on current DSH; older builds wrapped it in
    // `{ref}`. Only our own reference is interesting.
    this.disposeRemote = remote.$on(CREDENTIAL_UPDATED_EVENT, (payload) => {
      const ref = credentialRefOf(payload)
      if (ref !== undefined && ref === this.credential.ref) void this.readCredential()
    })
  }

  /** Release every subscription this form owns. */
  dispose(): void {
    this.disposeScope()
    this.disposeRemote()
    this.listeners.clear()
  }

  /** Observe form changes (returns a disposer). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The card-wide projection (same object until the next change). */
  shell(): CardShell {
    return this.shellState
  }

  /** The writes Save would run right now, in staging order. */
  plan(): readonly FieldWrite[] {
    return this.plannedWrites
  }

  /** What the view renders for one field. */
  fieldState(field: string): FieldState {
    const snapshot = this.scope.getSnapshot()
    const value = recordOf(snapshot.value)
    const user = recordOf(snapshot.user)
    const staged = this.staged.get(field)
    const draft = staged === undefined
      ? stringOf(value?.[field])
      : staged.kind === 'edit'
        ? staged.text
        : ''
    return {
      text: draft,
      // A staged edit answers for itself, so the badge previews the save instead
      // of reporting a state the pending edit already contradicts.
      overridden: staged === undefined ? Object.hasOwn(user ?? {}, field) : staged.kind === 'edit',
      // Only a draft can be invalid: a composition value outside this card's
      // rules is the host's business and must not paint the card red.
      invalid: staged?.kind === 'edit' ? !isValidDraft(fieldSpec(field), staged.text) : false,
    }
  }

  /**
   * The effective boolean of a `boolean` field (staged draft, else the resolved
   * section, else unset). Typed so callers never compare raw draft strings.
   */
  booleanField(field: string): boolean | undefined {
    const text = this.fieldState(field).text
    if (text === 'true') return true
    if (text === 'false') return false
    return undefined
  }

  /** The API-key plane's state. */
  keyState(): CredentialState {
    return this.credential
  }

  /** Stage a text edit for one field. */
  edit(field: string, text: string): void {
    this.staged.set(field, { kind: 'edit', text })
    this.failed = false
    this.publish()
  }

  /** Stage a clear: drop the user override so the field inherits the base layer. */
  clear(field: string): void {
    this.staged.set(field, { kind: 'clear' })
    this.failed = false
    this.publish()
  }

  /** Drop every staged edit without touching the host. */
  discard(): void {
    this.staged.clear()
    this.credential = { ...this.credential, staged: '', dirty: false, failed: false }
    this.failed = false
    this.publish()
  }

  /** API-key plane: stage the literal; the commit happens in `save()`. */
  editKey(text: string): void {
    this.credential = { ...this.credential, staged: text, dirty: text.length > 0, failed: false }
    this.publish()
  }

  /** Flush every staged edit to the host. */
  async save(): Promise<void> {
    // Re-entrancy guard: a second Save while the first is in flight would plan
    // the same drafts twice and race the revision fence.
    if (this.saving) return
    const plan = this.plannedWrites
    const credentialWrite = this.credential.dirty && this.credential.staged.length > 0
    if (plan.length === 0 && !credentialWrite) return

    // A refused draft refuses the whole save, credential write included.
    if (plan.some(write => write.kind === 'refused')) {
      this.failed = true
      this.publish()
      return
    }

    this.saving = true
    this.failed = false
    if (credentialWrite) this.credential = { ...this.credential, saving: true }
    this.publish()

    const written = new Set<string>()
    try {
      // Sequential by design: every settings write is fenced by the revision it
      // read, so parallel writes would race each other's fence.
      for (const write of plan) {
        if (await this.apply(write)) written.add(write.field)
        else this.failed = true
      }
      if (credentialWrite && !await this.writeCredential()) this.failed = true
    } finally {
      // Drop only what this save planned: an edit staged while the writes were in
      // flight is the user's next change, not part of this one.
      for (const field of written) this.staged.delete(field)
      this.saving = false
      this.credential = { ...this.credential, saving: false }
      this.publish()
    }
  }

  // ---- internals ----

  /**
   * Run one planned write and confirm the host kept it.
   *
   * The promise resolving only means the host accepted the call — the settings
   * surface re-reads its own state after a write — so the user layer is what
   * decides. `SettingsScope.set`/`unset` reject on transport errors, validation
   * refusals and revision conflicts; a rejection is a failed save, not an
   * exception for the caller to trip over.
   * @param write - one entry of the plan.
   * @returns whether the user layer now describes exactly this write.
   */
  private async apply(write: FieldWrite): Promise<boolean> {
    try {
      if (write.kind === 'set') await this.scope.set(write.field, write.value)
      else if (write.kind === 'clear') await this.scope.unset(write.field)
      else return false
    } catch {
      return false
    }
    return covers(this.scope.getSnapshot().user, write)
  }

  /**
   * Commit the staged literal through the credentials domain.
   * @returns whether the host now holds a value for the reference.
   */
  private async writeCredential(): Promise<boolean> {
    try {
      await this.remote.credentials.set(this.credential.ref, this.credential.staged)
      // The literal landed even if a settings write in the same save did not, so
      // drop it here rather than letting the box show a key the host already has.
      this.credential = { ...this.credential, staged: '', dirty: false }
      await this.readCredential()
      return true
    } catch {
      this.credential = { ...this.credential, failed: true }
      return false
    }
  }

  /**
   * Read the credential plane's state for the current reference.
   *
   * A read failure is non-fatal — the card stays usable and the key control keeps
   * reporting the last state it knew.
   */
  private async readCredential(): Promise<void> {
    const ref = credentialRefIn(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      this.credential = idleCredential(ref)
      this.publish()
    }

    let response: Awaited<ReturnType<RemoteLike['credentials']['describe']>>
    try {
      response = await this.remote.credentials.describe([ref])
    } catch {
      return
    }
    // The reference may have moved while the read was in flight.
    if (!response.ok || ref !== credentialRefIn(this.scope.getSnapshot())) return

    const view = response.value[ref]
    const next: CredentialState = {
      ...this.credential,
      ref,
      configured: view?.configured ?? false,
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.publish()
  }

  /**
   * Turn the staged map into the writes Save will run, in staging order.
   * @returns one entry per staged field: a concrete write, or a refusal.
   */
  private buildPlan(): FieldWrite[] {
    const writes: FieldWrite[] = []
    for (const [field, staged] of this.staged) {
      if (staged.kind === 'clear' || staged.text === '') {
        // Empty text means "inherit the base layer". It must go through
        // `unset` — a merge patch skips `undefined`, so `set(field, undefined)`
        // would silently keep the existing override.
        writes.push({ kind: 'clear', field })
        continue
      }
      const spec = fieldSpec(field)
      if (!isValidDraft(spec, staged.text)) {
        writes.push({ kind: 'refused', field })
        continue
      }
      writes.push({ kind: 'set', field, value: coerceDraft(spec, staged.text) })
    }
    return writes
  }

  /** Build the card-wide projection from the current plan and snapshot. */
  private buildShell(): CardShell {
    const snapshot = this.scope.getSnapshot()
    return {
      status: snapshot.status === 'ready'
        ? 'ready'
        : snapshot.status === 'unavailable' ? 'unavailable' : 'loading',
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.plannedWrites.length > 0,
      invalid: this.plannedWrites.some(write => write.kind === 'refused'),
      saving: this.saving,
      failed: this.failed,
    }
  }

  /** Recompute the projection, then wake the subscribers. */
  private publish(): void {
    this.plannedWrites = this.buildPlan()
    this.shellState = this.buildShell()
    for (const listener of this.listeners) listener()
  }
}

/**
 * Whether a user layer now describes exactly one write.
 * @param user - the snapshot's raw user layer.
 * @param write - the write that was just attempted.
 * @returns whether the host kept it.
 */
function covers(user: unknown, write: FieldWrite): boolean {
  const layer = recordOf(user) ?? {}
  if (write.kind === 'clear') return !Object.hasOwn(layer, write.field)
  if (write.kind === 'set') return Object.hasOwn(layer, write.field) && sameValue(layer[write.field], write.value)
  return false
}

/** Compare a written value with what the host reports (arrays compare by content). */
function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return JSON.stringify(left) === JSON.stringify(right)
  return left === right
}

// ---- Draft rules (pure) ----

/** The host schema's `YYYY_MM_DD` shape (see `YYYY_MM_DD` in `../index.ts`). */
const YYYY_MM_DD = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Whether a draft is a real calendar day in `YYYY-MM-DD` form.
 *
 * The pattern alone is not enough: `2026-02-31` and `2026-13-01` match it and the
 * host's `z.string().pattern(...)` would accept them, but Tavily's API and the
 * host's own date comparison both expect a date that exists. The round trip
 * through `Date.UTC` is the "exists" check — a normalised overflow (Feb 31 →
 * Mar 3) shows up as a different month/day.
 * @param text - the draft.
 * @returns whether it is a well-formed existing date.
 */
function isCalendarDate(text: string): boolean {
  const match = YYYY_MM_DD.exec(text)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
}

/**
 * Whether a draft may be written.
 *
 * Empty means "inherit the base layer", which is always valid: clearing a field
 * is how a deployment returns to the schema default.
 * @param spec - the field's rules.
 * @param text - the draft.
 * @returns whether Save may send it.
 */
export function isValidDraft(spec: FieldSpec, text: string): boolean {
  if (text === '') return true
  // A declared format is checked before `kind`: it mirrors a host-schema
  // constraint, and a draft the host would refuse must never reach Save.
  if (spec.format === 'date' && !isCalendarDate(text)) return false
  switch (spec.kind) {
    case 'text':
    case 'textlist':
    case 'boolean':
      return true
    case 'select':
      return spec.options === undefined || spec.options.includes(text)
    case 'number': {
      if (!/^-?\d+$/.test(text)) return false
      const value = Number(text)
      return Number.isInteger(value)
        && (spec.min === undefined || value >= spec.min)
        && (spec.max === undefined || value <= spec.max)
    }
  }
}

/**
 * Convert a valid draft into the value the settings section stores.
 * @param spec - the field's rules.
 * @param text - the draft (must satisfy {@link isValidDraft}).
 * @returns the JSON value to write; `undefined` for an empty draft, which the
 *   plan turns into a clear rather than a write.
 */
export function coerceDraft(spec: FieldSpec, text: string): unknown {
  if (text === '') return undefined
  switch (spec.kind) {
    case 'number':
      return Number(text)
    case 'boolean':
      return text === 'true'
    case 'textlist':
      return text.split(',').map(part => part.trim()).filter(part => part.length > 0)
    case 'text':
    case 'select':
      return text
  }
}

/**
 * The draft text a boolean control stages, so the `'true'`/`'false'` wire form
 * lives in this module rather than in the view's event handlers.
 * @param value - the control's checked state.
 * @returns the draft text.
 */
export function booleanText(value: boolean): string {
  return value ? 'true' : 'false'
}

/**
 * Render a settings value as control text.
 * @param value - a resolved/user-layer field value.
 * @returns its text form (`''` for values a text control cannot show).
 */
export function stringOf(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').join(', ')
  return ''
}

/**
 * The credential reference the section resolves against.
 * @param snapshot - the current settings snapshot.
 * @returns the declared reference, else the built-in default.
 */
export function credentialRefIn(snapshot: ConfigSnapshot): string {
  const declared = recordOf(snapshot.value)?.['apiKeyEnv']
  return typeof declared === 'string' && declared.length > 0 ? declared : TAVILY_API_KEY_ENV
}

/**
 * Extract a credential reference from a remote event payload.
 * @param payload - the event payload (a ref string, or `{ref}` on older builds).
 * @returns the reference, or `undefined` when the payload carries none.
 */
export function credentialRefOf(payload: unknown): string | undefined {
  if (typeof payload === 'string') return payload
  if (payload !== null && typeof payload === 'object' && 'ref' in payload) {
    const value = (payload as { ref?: unknown }).ref
    if (typeof value === 'string') return value
  }
  return undefined
}

/**
 * Narrow a snapshot layer to a field map.
 * @param value - a snapshot layer.
 * @returns the layer as a record, or `undefined` when it is not one.
 */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
