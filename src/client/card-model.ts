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

import { TAVILY_API_KEY_ENV, TAVILY_MCP_TOOLS } from '../shared.ts'
import { TAVILY_SEARCH_DEPTHS, TAVILY_TIME_RANGES, TAVILY_TOPICS } from '../shared.ts'
import type { RemoteLike, SettingsScopeLike, SettingsSnapshot } from './types.ts'

// ---- Field declaration ----

/** One editable field of the settings section. */
export interface FieldSpec {
  /** Settings-section field name (the key written to the user layer). */
  field: string
  kind: 'text' | 'number' | 'select' | 'textlist' | 'boolean'
  /** Visible label. */
  label: string
  /** Hint shown under the control. */
  hint: string
  /** Shown in place of the hint while the draft is invalid. */
  invalidLabel?: string
  /** Number-field floor (mirrors the schema, so a bad draft is caught before Save). */
  min?: number
  /** Number-field ceiling (mirrors the schema). */
  max?: number
  /** Options for `select` fields — the verbatim wire values, shared with the host. */
  options?: readonly string[]
  /** Placeholder for text / textlist inputs. */
  placeholder?: string
}

/**
 * The card's fields, in render order. Options come from `../shared.ts` so a
 * vocabulary change cannot desynchronize this dropdown from the request body the
 * host builds, and `min`/`max` mirror the host schema so a draft the host would
 * refuse is refused before the round trip.
 */
export const FIELDS: readonly FieldSpec[] = [
  {
    field: 'baseURL',
    kind: 'text',
    label: '接口地址',
    hint: '默认 https://api.tavily.com,/search 由插件自动追加。',
  },
  {
    field: 'maxResults',
    kind: 'number',
    label: '每次搜索最多结果数',
    hint: 'Tavily 每次搜索返回的结果数上限(1–20),默认 7。',
    invalidLabel: '必须是 1–20 的整数',
    min: 1,
    max: 20,
  },
  {
    field: 'searchDepth',
    kind: 'select',
    label: '搜索深度',
    hint: 'basic/fast/ultra-fast 计 1 credit,advanced 计 2 credits。',
    options: TAVILY_SEARCH_DEPTHS,
  },
  {
    field: 'topic',
    kind: 'select',
    label: '主题类别',
    hint: 'news 偏向实时新闻;general 为通用搜索;finance 为财经数据。',
    options: TAVILY_TOPICS,
  },
  {
    field: 'timeRange',
    kind: 'select',
    label: '时间范围',
    hint: 'Tavily 较新的时间窗形式(优先于「回溯天数」)。',
    options: TAVILY_TIME_RANGES,
  },
  {
    field: 'days',
    kind: 'number',
    label: '回溯天数',
    hint: '仅 topic=news 时生效;0 表示不限时间窗(旧版字段,建议改用「时间范围」)。',
    invalidLabel: '必须是 ≥ 0 的整数',
    min: 0,
  },
  {
    field: 'startDate',
    kind: 'text',
    label: '起始日期',
    hint: '仅返回该日期之后发布/更新的结果,格式 YYYY-MM-DD。',
    placeholder: '2026-01-01',
  },
  {
    field: 'endDate',
    kind: 'text',
    label: '截止日期',
    hint: '仅返回该日期之前发布/更新的结果,格式 YYYY-MM-DD。',
    placeholder: '2026-12-31',
  },
  {
    field: 'chunksPerSource',
    kind: 'number',
    label: '每源内容块数',
    hint: '每个来源返回的内容片段数(1–3),控制 content 长度。',
    invalidLabel: '必须是 1–3 的整数',
    min: 1,
    max: 3,
  },
  {
    field: 'snippetMaxChars',
    kind: 'number',
    label: '单条摘录上限',
    hint: '每个来源正文的字符上限(含末尾省略号),默认 600;这是控制上下文占用的闸门。',
    invalidLabel: '必须是 ≥ 16 的整数',
    min: 16,
  },
  {
    field: 'includeDomains',
    kind: 'textlist',
    label: '包含域名',
    hint: '逗号分隔,结果仅限定这些域名(最多 300 个)。',
    placeholder: 'example.com, news.site.org',
  },
  {
    field: 'excludeDomains',
    kind: 'textlist',
    label: '排除域名',
    hint: '逗号分隔,从结果中排除这些域名(最多 150 个)。',
    placeholder: 'spam.example, junk.org',
  },
  {
    field: 'useMcp',
    kind: 'boolean',
    label: '使用 Tavily MCP 服务器',
    hint: `开启后 web_search 让位给 ${TAVILY_MCP_TOOLS.search} 等 MCP 工具(需先配置 MCP 服务器,开关下方会给配置片段)。`,
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
    private readonly scope: SettingsScopeLike,
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
      invalid: staged === undefined ? false : !isValidDraft(fieldSpec(field), staged.text),
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
      status: snapshot.status,
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
export function credentialRefIn(snapshot: SettingsSnapshot): string {
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
