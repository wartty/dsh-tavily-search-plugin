/**
 * The Tavily settings card — VIEW half of the client.
 *
 * Registers one card into the `settings.plugin.item` slot keyed by
 * `web-search-tavily`, and renders it. Field specs, draft rules and the
 * staged-write controller live in `./card-model.ts`, which is React-free and
 * driven directly by `pnpm test`; this module only renders what it reports and
 * routes events back into it.
 *
 * State matrix (the card renders in every state, it never silently vanishes):
 * - `status === 'loading'`: the host has not answered yet.
 * - `status === 'unavailable'`: the namespace is hidden from the web surface, or
 *   the connection holds preferences in memory (a non-loopback page).
 * - `status === 'ready'`: the editable form.
 *
 * USER-VISIBLE COPY is Chinese-only on purpose (single-language deployment); the
 * built-in cards localize through `ctx.locale`, which would mean shipping
 * dictionaries for a plugin whose audience is this profile.
 * @module dsh-tavily-search-plugin/client/config-card
 */

import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { TAVILY_MCP_TOOLS, TAVILY_SETTINGS_NAMESPACE } from '../shared.ts'
import { booleanText, CardForm, FIELDS } from './card-model.ts'
import type { CardShell, FieldSpec } from './card-model.ts'
import type { RemoteLike, SettingsScopeBinderLike } from './types.ts'

/** Plugin display name shown on the card header. */
const DISPLAY_NAME = 'Tavily'

/** One-line subtitle: what this card configures. */
const DISPLAY_DESCRIPTION = 'Tavily API 搜索提供方(默认走免费额度)。'

/**
 * Register the Tavily card into `settings.plugin.item`.
 *
 * All four services are declared in this bundle's `inject` (see
 * `src/client/index.ts`), so they are mounted by the time this runs. The
 * absent-services branch only guards a profile that mounts this bundle without
 * the settings surface; a card that cannot edit anything is worth less than a
 * diagnostic line.
 * @param ctx - the browser plugin context.
 */
export function registerConfigCard(ctx: Context): void {
  const settingsScope = ctx.get('settingsScope') as SettingsScopeBinderLike | undefined
  // The credential plane rides the remote surface (`remote.credentials`), NOT
  // `connection`: the connection handle carries transport state only.
  const remote = ctx.get('remote') as RemoteLike | undefined

  if (settingsScope === undefined || remote === undefined) {
    ctx.logger.warn(
      `[${TAVILY_SETTINGS_NAMESPACE}] settingsScope/remote missing; the card cannot mount`,
    )
    return
  }

  const form = new CardForm(settingsScope.bind({ namespace: TAVILY_SETTINGS_NAMESPACE }), remote)
  // The form owns two subscriptions; tie their release to this plugin's fiber so
  // an HMR reload or unload cannot leave a stale instance publishing into
  // unmounted components.
  ctx.effect(() => () => form.dispose(), 'tavily: settings-card form')

  // Keyed slot registration: the plugins tab dispatches one item per served
  // settings namespace and renders whatever card claims that key. Keyed entries
  // declare neither `order` nor `label` — the tab owns the ordering and the card
  // owns its own copy (settings-card cookbook §3). `inject` hands the card its
  // controller as props, which keeps the component identity stable across
  // re-registrations (a fresh component function would remount and drop the
  // card's open/guide state).
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
    { name: 'settings.plugin.item', key: TAVILY_SETTINGS_NAMESPACE, inject: () => ({ form }) },
    ConfigCard,
  ))
}

// ---- Card UI ----

/** Props the slot injects into {@link ConfigCard}. */
interface ConfigCardProps {
  form?: CardForm
}

/**
 * Render the card body. Every hook is declared above every early return:
 * switching from "loading" to "ready" re-renders, and React would throw
 * "Rendered more hooks than during the previous render" if a hook sat below one.
 * @param props - the controller injected by the slot registration.
 * @returns the card element.
 */
function ConfigCard({ form }: ConfigCardProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  // MCP hand-off confirmation flow: 'asking' when the user flips useMcp on,
  // 'guide' after they answer "not configured yet" (shows the patch snippet).
  const [mcpConfirm, setMcpConfirm] = React.useState<'idle' | 'asking' | 'guide'>('idle')
  // `useSyncExternalStore` rather than subscribe-in-an-effect: a publish landing
  // between the first render and the effect would otherwise be lost, leaving the
  // card on "loading" until the next user input. `shell()` returns a cached
  // object, so React's identity check re-renders only on a real change.
  const subscribe = React.useCallback(
    (notify: () => void) => form?.subscribe(notify) ?? (() => {}),
    [form],
  )
  const shell = React.useSyncExternalStore(subscribe, () => form?.shell() as CardShell)

  if (form === undefined) {
    return statusCard(
      '设置服务不可用',
      '插件未拿到 settingsScope / remote 服务,卡片无法编辑。检查 profile 是否挂载了设置界面(web profile 默认挂载)。',
    )
  }
  if (!shell.available) {
    if (shell.status === 'unavailable') {
      return statusCard(
        `设置命名空间 "${TAVILY_SETTINGS_NAMESPACE}" 当前不可写`,
        '两种成因:该命名空间未对浏览器暴露(旧版 DSH 有白名单),或当前连接把偏好保留在内存里(非 loopback 页面不落盘)。host 半不受影响,`ctx.web` 每次搜索仍会读取该命名空间。',
        '在 DSH 主机本机用 dsh web 打印的地址打开页面,可以拿到可持久化的设置面;命名空间暴露情况见插件 README 的故障排查章节。',
      )
    }
    return statusCard(
      '正在读取配置…',
      '等待 host 端首次回答 settings.describe;到达后卡片会自动切换为可编辑状态。',
    )
  }

  const key = form.keyState()
  const onMcpToggled = (checked: boolean) => setMcpConfirm(checked ? 'asking' : 'idle')

  return React.createElement(
    'li',
    { className: open ? 'dstav-card dstav-card-open' : 'dstav-card' },
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dstav-header',
        'aria-expanded': open,
        onClick: () => setOpen(current => !current),
      },
      React.createElement(
        'span',
        { className: 'dstav-head-text' },
        React.createElement('span', { className: 'dstav-name' }, DISPLAY_NAME),
        React.createElement('span', { className: 'dstav-description' }, DISPLAY_DESCRIPTION),
      ),
      shell.dirty || key.dirty
        ? React.createElement('span', { className: 'dstav-badge' }, 'unsaved')
        : null,
      chevron(open),
    ),
    open
      ? React.createElement(
        'div',
        { className: 'dstav-body' },
        shell.writable
          ? null
          : React.createElement(
            'p',
            { className: 'dstav-read-only', role: 'status' },
            '当前设置文档为只读(memory 模式或只读 provider),所有改动不会持久化。',
          ),
        keyField(form, key),
        // Field order is the model's; the toggle that opens the MCP guide is the
        // only field the view reacts to beyond staging its draft.
        FIELDS.map(spec => renderField(
          form,
          spec,
          shell,
          spec.field === 'useMcp' ? onMcpToggled : undefined,
        )),
        React.createElement(McpPanel, { state: mcpConfirm, set: setMcpConfirm, form }),
        footer(shell, form, key.dirty),
      )
      : null,
  )
}

/**
 * The API-key control. It reads and writes the credentials domain, not the
 * settings document, so the literal never rides a settings response.
 * @param form - the form controller.
 * @param key - the credential plane's state.
 * @returns the control row.
 */
function keyField(form: CardForm, key: ReturnType<CardForm['keyState']>): React.ReactElement {
  const statusLabel = key.saving
    ? '保存中…'
    : key.dirty
      ? '未保存'
      : key.configured
        ? '已配置'
        : '未配置'
  const statusClass = key.configured || key.dirty || key.saving ? 'dstav-badge' : 'dstav-badge-muted'
  return React.createElement(
    'div',
    { className: 'dstav-field' },
    React.createElement(
      'div',
      { className: 'dstav-field-head' },
      React.createElement('label', { className: 'dstav-label', htmlFor: 'dstav-api-key' }, 'API key'),
      React.createElement(
        'span',
        { className: 'dstav-badges' },
        React.createElement('span', { className: statusClass }, statusLabel),
      ),
    ),
    React.createElement('input', {
      id: 'dstav-api-key',
      className: 'dstav-input',
      type: 'password',
      autoComplete: 'off',
      placeholder: key.configured ? '已配置——输入新值以替换' : '输入 Tavily API Key (tvly-...)',
      disabled: !key.writable || key.saving,
      value: key.staged,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => form.editKey(event.target.value),
    }),
    React.createElement(
      'p',
      { className: 'dstav-hint' },
      `写入后仅存于 DSH 凭证域(引用 ${key.ref}),不会随 settings 文档回传。`,
    ),
  )
}

/**
 * The discard/save footer.
 * @param shell - the card-wide projection.
 * @param form - the form controller.
 * @param keyDirty - whether an API-key literal is staged.
 * @returns the footer element.
 */
function footer(shell: CardShell, form: CardForm, keyDirty: boolean): React.ReactElement {
  // The key plane lives outside `staged`, so its draft counts as pending work:
  // Discard must be able to undo it, and Save must not be blocked by an invalid
  // settings draft while a key is waiting (the model refuses the whole save).
  const pending = shell.dirty || keyDirty
  return React.createElement(
    'div',
    { className: 'dstav-footer' },
    shell.failed
      ? React.createElement(
        'p',
        { className: 'dstav-failed', role: 'status' },
        '保存未全部生效;未落盘的草稿已保留,请修正或重试。',
      )
      : null,
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dstav-discard',
        disabled: !pending || shell.saving,
        onClick: () => form.discard(),
      },
      '放弃',
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dstav-save',
        disabled: !pending || shell.invalid || shell.saving,
        onClick: () => { void form.save() },
      },
      shell.saving ? '保存中…' : '保存',
    ),
  )
}

/**
 * Render one settings field.
 * @param form - the form controller.
 * @param spec - the field's declaration.
 * @param shell - the card-wide projection.
 * @param onBooleanToggle - notified when a `boolean` field flips (used by MCP).
 * @returns the field row.
 */
function renderField(
  form: CardForm,
  spec: FieldSpec,
  shell: CardShell,
  onBooleanToggle?: (checked: boolean) => void,
): React.ReactElement {
  const state = form.fieldState(spec.field)
  // Editing during a save would stage an edit the in-flight plan knows nothing
  // about; lock the controls for the duration instead.
  const disabled = !shell.writable || shell.saving
  const inputId = `dstav-${spec.field}`
  const inputClass = state.invalid ? 'dstav-input dstav-input-invalid' : 'dstav-input'
  return React.createElement(
    'div',
    { className: 'dstav-field', key: spec.field },
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
            { type: 'button', className: 'dstav-reset', disabled, onClick: () => form.clear(spec.field) },
            'reset',
          ),
        )
        : null,
    ),
    fieldControl(form, spec, state, inputId, inputClass, disabled, onBooleanToggle),
    React.createElement(
      'p',
      { className: state.invalid ? 'dstav-invalid' : 'dstav-hint' },
      state.invalid ? spec.invalidLabel ?? 'Invalid value' : spec.hint,
    ),
  )
}

/**
 * The editable control for one field.
 *
 * `text`/`number`/`textlist` share an `<input>`; `select` gets a dropdown whose
 * empty option means "inherit the base layer"; `boolean` gets a checkbox whose
 * draft text comes from the model.
 * @param form - the form controller.
 * @param spec - the field's declaration.
 * @param state - the field's rendered state.
 * @param inputId - the control's DOM id (also the label's `htmlFor`).
 * @param inputClass - class for text-like controls.
 * @param disabled - whether writes are impossible right now.
 * @param onBooleanToggle - notified when a `boolean` field flips.
 * @returns the control element.
 */
function fieldControl(
  form: CardForm,
  spec: FieldSpec,
  state: ReturnType<CardForm['fieldState']>,
  inputId: string,
  inputClass: string,
  disabled: boolean,
  onBooleanToggle?: (checked: boolean) => void,
): React.ReactElement {
  if (spec.kind === 'select') {
    return React.createElement(
      'select',
      {
        id: inputId,
        className: inputClass,
        ...state.invalid ? { 'aria-invalid': true } : {},
        value: state.text,
        disabled,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => form.edit(spec.field, event.target.value),
      },
      React.createElement('option', { value: '' }, '(未设置)'),
      (spec.options ?? []).map(option => React.createElement('option', { key: option, value: option }, option)),
    )
  }
  if (spec.kind === 'boolean') {
    return React.createElement('input', {
      id: inputId,
      className: 'dstav-checkbox',
      type: 'checkbox',
      checked: form.booleanField(spec.field) === true,
      disabled,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        form.edit(spec.field, booleanText(event.target.checked))
        onBooleanToggle?.(event.target.checked)
      },
    })
  }
  return React.createElement('input', {
    id: inputId,
    className: inputClass,
    type: 'text',
    ...spec.kind === 'number' ? { inputMode: 'numeric' as const } : {},
    ...state.invalid ? { 'aria-invalid': true } : {},
    value: state.text,
    placeholder: spec.placeholder ?? (spec.kind === 'number' ? '(未设置)' : ''),
    disabled,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => form.edit(spec.field, event.target.value),
  })
}

/**
 * The patch snippet to paste into a profile's `cordis.patch.yml` to mount the
 * Tavily remote MCP server. The README's MCP section carries the same snippet —
 * keep the two in step when either changes.
 *
 * The URL carries a `<…>` placeholder on purpose: a `!!js process.env.X`
 * expression reads the shell environment DSH was launched from, which does NOT
 * include `~/.dsh/.credentials.yaml`, so a literal the user fills in is the
 * reliable form.
 */
const MCP_PATCH_SNIPPET = `- insert:
    - id: mcp-tavily
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: streamable-http
        serverName: tavily
        url: https://mcp.tavily.com/mcp/?tavilyApiKey=<把你的 key 粘到这里 — 见 ~/.dsh/.credentials.yaml>
        toolCallTimeoutMs: 60000
        failOnStartupError: false`

/** Props of {@link McpPanel}. */
interface McpPanelProps {
  state: 'idle' | 'asking' | 'guide'
  set: (next: 'idle' | 'asking' | 'guide') => void
  form: CardForm
}

/**
 * The MCP hand-off guide under the `useMcp` toggle.
 *
 * Three states: 'asking' (the user flipped the toggle on), 'guide' (they
 * answered "not configured yet" — show the snippet), and hidden once they
 * confirm the server is already configured. It is a component, not a helper
 * called from a branch, so it may legitimately own state (the copy feedback) and
 * cannot become a conditional-hook bug later.
 * @param props - panel state, its setter, and the form controller.
 * @returns the panel, or `null` when it does not apply.
 */
function McpPanel({ state, set, form }: McpPanelProps): React.ReactElement | null {
  const [copy, setCopy] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  if (state === 'idle') return null
  // The panel only makes sense while a `useMcp: true` draft is staged; a discard
  // (or flipping the toggle back) collapses it.
  if (form.booleanField('useMcp') !== true) return null

  if (state === 'asking') {
    return React.createElement(
      'div',
      { className: 'dstav-mcp-panel', role: 'status' },
      React.createElement('p', { className: 'dstav-mcp-title' }, '是否已经配置了 Tavily 的 MCP 服务器？'),
      React.createElement(
        'div',
        { className: 'dstav-mcp-actions' },
        React.createElement('button', { type: 'button', className: 'dstav-mcp-yes', onClick: () => set('idle') }, '是，已配置'),
        React.createElement('button', { type: 'button', className: 'dstav-mcp-no', onClick: () => set('guide') }, '否，未配置'),
      ),
    )
  }

  const copyLabel = copy === 'copied' ? '已复制' : copy === 'failed' ? '复制失败,请手动选择' : '复制配置'
  return React.createElement(
    'div',
    { className: 'dstav-mcp-panel' },
    React.createElement(
      'p',
      { className: 'dstav-mcp-title' },
      '尚未配置 Tavily MCP 服务器。将以下配置粘贴到 ~/.dsh/profiles/web/cordis.patch.yml,然后重启 DSH:',
    ),
    React.createElement('pre', { className: 'dstav-mcp-snippet' }, MCP_PATCH_SNIPPET),
    React.createElement(
      'div',
      { className: 'dstav-mcp-actions' },
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dstav-mcp-copy',
          onClick: () => {
            // A clipboard write can reject (permission, non-secure origin), so
            // report the outcome instead of silently doing nothing.
            void navigator.clipboard?.writeText(MCP_PATCH_SNIPPET)
              .then(() => setCopy('copied'), () => setCopy('failed'))
          },
        },
        copyLabel,
      ),
      React.createElement('button', { type: 'button', className: 'dstav-mcp-back', onClick: () => set('asking') }, '返回'),
    ),
    React.createElement(
      'p',
      { className: 'dstav-mcp-note' },
      `粘贴并重启后,模型会看到 ${Object.values(TAVILY_MCP_TOOLS).join(' / ')} 工具;`
      + '本开关保存后,web_search 将让位给 MCP 搜索且不消耗 REST 配额。',
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

/**
 * A read-only status card explaining why the editable form cannot be shown.
 * @param title - the headline.
 * @param body - what happened.
 * @param remedy - optional next step.
 * @returns the card element.
 */
function statusCard(title: string, body: string, remedy?: string): React.ReactElement {
  return React.createElement(
    'li',
    { className: 'dstav-card' },
    React.createElement(
      'div',
      { className: 'dstav-status' },
      React.createElement('p', { className: 'dstav-status-title' }, title),
      React.createElement('p', { className: 'dstav-status-body' }, body),
      remedy === undefined ? null : React.createElement('p', { className: 'dstav-status-body' }, remedy),
    ),
  )
}
