/**
 * The Tavily settings card.
 *
 * Registers one card into the `settings.plugin.item` slot keyed by
 * `web-search-tavily`. The card edits the same settings namespace the host
 * half installed via `installSettingsSection`; the host reads the namespace on
 * every search, so a save takes effect immediately on the next tool call.
 *
 * UI shape mirrors the built-in `WebSearchCard` in
 * `packages/client/ui-settings-plugins`: an editable header row (title,
 * description, "unsaved" badge, chevron) followed by three fields — API Key
 * (credentials domain), Endpoint URL, Max results per search — and a footer
 * with discard / save. Differences are limited to (1) the credential control
 * being hand-written instead of importing `SecretField`, since a standalone
 * bundle may not value-import that package, and (2) inline copy in zh/en.
 *
 * State matrix (the card renders in every state, never silently vanishes):
 * - `form === undefined`: `settingsScope` / `connection` / `remote` services
 *   absent (non-web profile); render an "unmounted" status card.
 * - `status === 'loading'`: host has not answered yet; render "loading".
 * - `status === 'unavailable'`: namespace hidden from the web surface; render
 *   an "unavailable" status card. The host half is unaffected.
 * - `status === 'ready'`: render the editable form.
 * @module dsh-tavily-search-plugin/client/config-card
 */

import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { NAMESPACE } from './constants.ts'
import type { SettingsScopeBinderLike, SettingsScopeLike } from './types.ts'

// ---- Field declaration ----
//
// 基本两个字段（baseURL / maxResults）沿用内置 WebSearchCard 的两行布局；
// 其余是 Tavily 当前 REST API 的完整可调面，全部走同一个 staged form 模型。

interface FieldSpec {
  /** Settings-section field name. */
  field: string
  kind: 'text' | 'number' | 'select' | 'textlist'
  /** Visible label (zh; API Key 单独保留英文 'API key')。 */
  label: string
  /** Hint shown under the control (zh)。 */
  hint: string
  /** Invalid-draft label. */
  invalidLabel?: string
  /** Number-field floor. */
  min?: number
  /** Number-field ceiling. */
  max?: number
  /** Options for `select` fields (verbatim wire values). */
  options?: readonly string[]
  /** Placeholder for text / textlist inputs. */
  placeholder?: string
}

const FIELDS: readonly FieldSpec[] = [
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
    options: ['basic', 'advanced', 'fast', 'ultra-fast'],
  },
  {
    field: 'topic',
    kind: 'select',
    label: '主题类别',
    hint: 'news 偏向实时新闻;general 为通用搜索;finance 为财经数据。',
    options: ['general', 'news', 'finance'],
  },
  {
    field: 'timeRange',
    kind: 'select',
    label: '时间范围',
    hint: 'Tavily 较新的时间窗形式(优先于"回溯天数")。',
    options: ['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y'],
  },
  {
    field: 'days',
    kind: 'number',
    label: '回溯天数',
    hint: '仅 topic=news 时生效;0 表示不限时间窗(旧版字段,建议改用"时间范围")。',
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
]

// ---- Staged form model ----

type StagedEdit =
  | { kind: 'edit'; text: string }
  | { kind: 'clear' }

interface FieldState {
  /** Current text in the input. */
  text: string
  /** Saving this draft would leave a user-layer override. */
  overridden: boolean
  /** Draft does not match the field's kind-specific rules. */
  invalid: boolean
}

interface CardShell {
  status: 'loading' | 'ready' | 'unavailable'
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
}

interface PlannedWrite {
  field: string
  /** `undefined` when the staged draft is invalid and the field should be left alone. */
  run: (() => Promise<boolean>) | undefined
}

// ---- Secret (API Key) plane ----

interface CredentialState {
  ref: string
  configured: boolean
  writable: boolean
  /** Last staged literal; cleared on save. */
  staged: string
  /** True when the staged literal is non-empty. */
  dirty: boolean
  saving: boolean
  failed: boolean
}

// ---- Minimal connection / remote surfaces (avoid value-importing dsh-client-*) ----

interface IApiClient {
  credentials: {
    describe(request: { refs: readonly string[] }): Promise<{ result: { ok: boolean; value: { credentials: Record<string, { configured: boolean; writable: boolean } | undefined> } } }>
    set(request: { ref: string; value: string }): Promise<{ result: { ok: boolean } }>
  }
}

interface RemoteBusLike {
  $on(event: string, listener: (payload: unknown) => void): () => void
}

// ---- Form controller ----

/**
 * Staged form. Edits never touch the document; `save` is the single mutation
 * point and re-reads the host's verdict afterwards so the dirty/failed flags
 * settle against the authoritative state.
 */
class CardForm {
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  private saving = false
  private failed = false
  private credential: CredentialState = { ref: '', configured: false, writable: true, staged: '', dirty: false, saving: false, failed: false }
  private readonly unsubRemote: () => void

  constructor(
    private readonly scope: SettingsScopeLike,
    private readonly api: IApiClient,
    private readonly remote: RemoteBusLike,
  ) {
    scope.subscribe(() => this.publish())
    void this.readCredential()
    // credentials/updated payload shape: string ref (newer DSH) or {ref: string}.
    this.unsubRemote = remote.$on('credentials/updated', (payload) => {
      const ref = refOfString(payload)
      if (ref !== undefined && ref === this.credential.ref) void this.readCredential()
    })
  }

  dispose(): void {
    this.unsubRemote()
    this.listeners.clear()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  shell(): CardShell {
    const snap = this.scope.getSnapshot()
    return {
      status: snap.status,
      available: snap.status === 'ready',
      writable: snap.writable,
      dirty: this.isDirty(),
      invalid: this.isInvalid(),
      saving: this.saving,
      failed: this.failed,
    }
  }

  fieldState(field: string): FieldState {
    const snap = this.scope.getSnapshot()
    const value = snap.value as Record<string, unknown> | undefined
    const user = snap.user as Record<string, unknown> | undefined
    const baseText = value === undefined ? '' : stringOf(value[field])
    const userText = user === undefined ? undefined : stringOf(user[field])
    const staged = this.staged.get(field)
    const draft = staged === undefined
      ? baseText
      : staged.kind === 'edit'
        ? staged.text
        : ''
    return {
      text: draft,
      overridden: userText !== undefined,
      invalid: !isValidDraft(this.fieldSpec(field), draft),
    }
  }

  /** Stage a text edit for one field. */
  edit(field: string, text: string): void {
    this.staged.set(field, { kind: 'edit', text })
    this.failed = false
    this.publish()
  }

  /** Stage a clear (drop the user override so the field inherits base). */
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

  /** API Key plane: stage the literal; commit happens in save(). */
  editKey(text: string): void {
    this.credential = { ...this.credential, staged: text, dirty: text.length > 0, failed: false }
    this.publish()
  }

  /** Flush every staged edit to the host. */
  async save(): Promise<void> {
    const writes = this.plan()
    const credentialWrite = this.credential.dirty && this.credential.staged.length > 0

    if (writes.length === 0 && !credentialWrite) return
    this.saving = true
    if (credentialWrite) this.credential = { ...this.credential, saving: true }
    this.failed = false
    this.publish()

    try {
      let allOk = true

      // Settings writes (sequential: revision fence).
      for (const write of writes) {
        if (write.run === undefined) {
          allOk = false
          continue
        }
        const ok = await write.run()
        if (!ok) allOk = false
      }

      // Credential write (single round trip).
      if (credentialWrite) {
        try {
          await this.api.credentials.set({ ref: this.credential.ref, value: this.credential.staged })
          await this.readCredential()
        } catch (_credentialWriteFailure) {
          allOk = false
          this.credential = { ...this.credential, failed: true }
        }
      }

      if (allOk) {
        this.staged.clear()
        this.credential = { ...this.credential, staged: '', dirty: false, failed: false }
      } else {
        this.failed = true
      }
    } finally {
      this.saving = false
      this.credential = { ...this.credential, saving: false }
      this.publish()
    }
  }

  /** Project the secret plane's current state to the renderer. */
  keyState(): CredentialState {
    return this.credential
  }

  // ---- internals ----

  private async readCredential(): Promise<void> {
    const ref = refOf(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      this.credential = {
        ref, configured: false, writable: true, staged: '', dirty: false, saving: false, failed: false,
      }
      this.publish()
    }
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs: [ref] })
    } catch (_credentialReadFailure) {
      // Read failure is non-fatal: the card stays usable, the key control
      // simply reports the last state it knew.
      return
    }
    if (!response.result.ok || ref !== refOf(this.scope.getSnapshot())) return
    const view = response.result.value.credentials[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      writable: view?.writable ?? true,
      staged: this.credential.staged,
      dirty: this.credential.dirty,
      saving: this.credential.saving,
      failed: this.credential.failed,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.publish()
  }

  private fieldSpec(field: string): FieldSpec {
    const spec = FIELDS.find(candidate => candidate.field === field)
    if (spec === undefined) throw new Error(`unknown field "${field}"`)
    return spec
  }

  private isDirty(): boolean {
    return this.staged.size > 0
  }

  private isInvalid(): boolean {
    for (const [field, staged] of this.staged) {
      if (staged.kind === 'clear') continue
      if (!isValidDraft(this.fieldSpec(field), staged.text)) return true
    }
    return false
  }

  private plan(): PlannedWrite[] {
    const writes: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      const spec = this.fieldSpec(field)
      if (staged.kind === 'clear') {
        writes.push({ field, run: async () => { await this.scope.unset(field); return true } })
        continue
      }
      if (!isValidDraft(spec, staged.text)) {
        writes.push({ field, run: undefined })
        continue
      }
      const value = coerceDraft(spec, staged.text)
      writes.push({ field, run: async () => { await this.scope.set(field, value); return true } })
    }
    return writes
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}

// ---- Draft coercion & validation ----

function isValidDraft(spec: FieldSpec, text: string): boolean {
  // Empty always means "inherit the base / unset", so it is a valid draft.
  if (text === '') return true
  switch (spec.kind) {
    case 'text':
    case 'textlist':
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

function coerceDraft(spec: FieldSpec, text: string): unknown {
  if (text === '') return undefined
  switch (spec.kind) {
    case 'number':
      return Number(text)
    case 'textlist':
      return text
        .split(',')
        .map(part => part.trim())
        .filter(part => part.length > 0)
    case 'text':
    case 'select':
      return text
  }
}

function stringOf(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .join(', ')
  }
  return ''
}

function refOf(snapshot: { value?: unknown }): string {
  const value = snapshot.value as Record<string, unknown> | undefined
  const declared = value?.['apiKeyEnv']
  return typeof declared === 'string' && declared.length > 0 ? declared : 'TAVILY_API_KEY'
}

function refOfString(payload: unknown): string | undefined {
  if (typeof payload === 'string') return payload
  if (payload !== null && typeof payload === 'object' && 'ref' in payload) {
    const value = (payload as { ref?: unknown }).ref
    if (typeof value === 'string') return value
  }
  return undefined
}

// ---- Registration ----

/**
 * Register the Tavily card into `settings.plugin.item`.
 *
 * `settingsScope` / `connection` / `remote` are the optional services the
 * Settings page wires up; when any is missing (non-web profile) we still
 * register the card so the slot owner has something to render, and the
 * component falls through to the "unmounted" status panel.
 */
export function registerConfigCard(ctx: Context): void {
  const settingsScope = ctx.get('settingsScope') as SettingsScopeBinderLike | undefined
  const connection = ctx.get('connection') as { api: IApiClient } | undefined
  const remote = ctx.get('remote') as RemoteBusLike | undefined

  if (settingsScope === undefined || connection === undefined || remote === undefined) {
    // eslint-disable-next-line no-console
    console.warn(`[${NAMESPACE}] settingsScope/connection/remote service absent; the config card shows the unmounted state`)
  }

  const form = settingsScope !== undefined && connection !== undefined && remote !== undefined
    ? new CardForm(settingsScope.bind({ namespace: NAMESPACE }), connection.api, remote)
    : undefined

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
    { name: 'settings.plugin.item', key: NAMESPACE, order: 30, label: NAMESPACE },
    () => React.createElement(ConfigCard, { form }),
  ))
}

// ---- Card UI ----

/**
 * Render the card body. Hooks MUST be declared above every early return —
 * switching from "loading" to "ready" re-renders, and React would throw
 * "Rendered more hooks than during the previous render" if a hook sat below
 * a return-null.
 */
function ConfigCard({ form }: { form: CardForm | undefined }): React.ReactElement {
  const [, forceRender] = React.useReducer((count: number) => count + 1, 0)
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => (form === undefined ? undefined : form.subscribe(forceRender)), [form])

  if (form === undefined) {
    return statusCard(
      '设置服务不可用',
      'settingsScope / connection / remote 服务缺失,本卡片无法编辑。请用 `pnpm dsh web` 启动 web profile。',
    )
  }

  const shell = form.shell()
  if (!shell.available) {
    if (shell.status === 'unavailable') {
      return statusCard(
        `设置命名空间 "${NAMESPACE}" 未对 Web 暴露`,
        'DSH 的设置 API 默认只对浏览器暴露部分命名空间,本命名空间不在已暴露列表里,卡片为只读状态。host 半不受影响,`ctx.web` 每次搜索仍会读取该命名空间。',
        '如果你用的是旧版本 DSH,见插件 README 的故障排查章节;新版本已默认暴露所有命名空间。',
      )
    }
    return statusCard(
      '正在读取配置…',
      '等待 host 端首次回答 `settings.describe`;到达后卡片会自动切换为可编辑状态。',
    )
  }

  const blocked = !shell.dirty || shell.invalid || shell.saving
  const cardClass = open ? 'dstav-card dstav-card-open' : 'dstav-card'
  const key = form.keyState()
  const keyStatusLabel = key.saving
    ? '保存中…'
    : key.dirty
      ? '未保存'
      : key.configured
        ? '已配置'
        : '未配置'
  const keyStatusClass = key.configured || key.dirty || key.saving
    ? 'dstav-badge'
    : 'dstav-badge-muted'

  return React.createElement(
    'li',
    { className: cardClass },
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dstav-header',
        'aria-expanded': open,
        onClick: () => setOpen(!open),
      },
      React.createElement(
        'span',
        { className: 'dstav-head-text' },
        React.createElement('span', { className: 'dstav-name' }, 'Tavily'),
        React.createElement(
          'span',
          { className: 'dstav-description' },
          'Tavily 搜索提供方。',
        ),
      ),
      shell.dirty || key.dirty ? React.createElement('span', { className: 'dstav-pending' }, 'unsaved') : null,
      chevron(open),
    ),
    open
      ? React.createElement(
        'div',
        { className: 'dstav-body' },
        !shell.writable
          ? React.createElement(
            'p',
            { className: 'dstav-read-only', role: 'status' },
            '当前设置文档为只读(memory 模式或只读 provider),所有改动不会持久化。',
          )
          : null,

        // --- API Key (credentials domain) ---
        React.createElement(
          'div',
          { className: 'dstav-field' },
          React.createElement(
            'div',
            { className: 'dstav-field-head' },
            React.createElement(
              'label',
              { className: 'dstav-label', htmlFor: 'dstav-api-key' },
              'API key',
            ),
            React.createElement(
              'span',
              { className: 'dstav-badges' },
              React.createElement('span', { className: keyStatusClass }, keyStatusLabel),
            ),
          ),
          React.createElement('input', {
            id: 'dstav-api-key',
            className: 'dstav-input',
            type: 'password',
            autoComplete: 'off',
            placeholder: key.configured ? '已配置——输入新值以替换' : '输入 Tavily API Key (tvly-...)',
            disabled: !key.writable,
            value: key.staged,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => form.editKey(event.target.value),
          }),
          React.createElement(
            'p',
            { className: 'dstav-hint' },
            '写入后仅存于 DSH 凭证域,不会随 settings 文档回传。',
          ),
        ),

        // --- Settings fields (mirrors built-in WebSearchCard's 2-row layout) ---
        FIELDS.map(spec => renderField(form, spec, shell)),

        // --- Footer ---
        React.createElement(
          'div',
          { className: 'dstav-footer' },
          shell.failed
            ? React.createElement(
              'p',
              { className: 'dstav-failed', role: 'status' },
              '保存失败;草稿已保留,请修正后重试。',
            )
            : null,
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dstav-discard',
              disabled: !shell.dirty || shell.saving,
              onClick: () => form.discard(),
            },
            '放弃',
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dstav-save',
              disabled: blocked && !key.dirty,
              onClick: () => { void form.save() },
            },
            shell.saving ? '保存中…' : '保存',
          ),
        ),
      )
      : null,
  )
}

function renderField(form: CardForm, spec: FieldSpec, shell: CardShell): React.ReactElement {
  const state = form.fieldState(spec.field)
  const disabled = !shell.writable
  const inputId = `dstav-${spec.field}`
  const inputClass = state.invalid ? 'dstav-input dstav-input-invalid' : 'dstav-input'

  // The editable control differs by kind: text/number/textlist share an
  // `<input>`, `select` gets a dropdown with an explicit "(未设置)" empty
  // option, so a cleared override is one click away.
  const control = spec.kind === 'select'
    ? React.createElement('select', {
      id: inputId,
      className: inputClass,
      ...(state.invalid ? { 'aria-invalid': true } : {}),
      value: state.text,
      disabled,
      onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
        form.edit(spec.field, event.target.value),
    },
    React.createElement('option', { value: '' }, '(未设置)'),
    (spec.options ?? []).map(option =>
      React.createElement('option', { key: option, value: option }, option)),
    )
    : React.createElement('input', {
      id: inputId,
      className: inputClass,
      type: 'text',
      ...(spec.kind === 'number' ? { inputMode: 'numeric' as const } : {}),
      ...(state.invalid ? { 'aria-invalid': true } : {}),
      value: state.text,
      placeholder: spec.placeholder ?? (spec.kind === 'number' ? '(未设置)' : ''),
      disabled,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        form.edit(spec.field, event.target.value),
    })

  return React.createElement(
    'div',
    { className: 'dstav-field' },
    React.createElement(
      'div',
      { className: 'dstav-field-head' },
      React.createElement('label', { className: 'dstav-label', htmlFor: inputId }, spec.label),
      state.overridden
        ? React.createElement(
          'span',
          { className: 'dstav-badges' },
          React.createElement('span', { className: 'dstav-badge' }, 'overridden'),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dstav-reset',
              disabled,
              onClick: () => form.clear(spec.field),
            },
            'reset',
          ),
        )
        : null,
    ),
    control,
    React.createElement(
      'p',
      { className: state.invalid ? 'dstav-invalid' : 'dstav-hint' },
      state.invalid ? spec.invalidLabel ?? 'Invalid value' : spec.hint,
    ),
  )
}

/** Inline 14×14 chevron, matching the built-in card's glyph (path copied verbatim). */
function chevron(open: boolean): React.ReactElement {
  return React.createElement(
    'svg',
    {
      className: open ? 'dstav-chevron dstav-chevron-open' : 'dstav-chevron',
      width: 14,
      height: 14,
      viewBox: '0 0 14 14',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': true,
    },
    React.createElement('path', {
      d: 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z',
      fill: 'currentColor',
    }),
  )
}

/** A read-only status card explaining why the editable form cannot be shown. */
function statusCard(title: string, body: string, remedy?: string): React.ReactElement {
  return React.createElement(
    'li',
    { className: 'dstav-card' },
    React.createElement(
      'div',
      { className: 'dstav-status' },
      React.createElement('p', { className: 'dstav-status-title' }, title),
      React.createElement('p', { className: 'dstav-status-body' }, body),
      remedy === undefined
        ? null
        : React.createElement('p', { className: 'dstav-status-body' }, remedy),
    ),
  )
}
