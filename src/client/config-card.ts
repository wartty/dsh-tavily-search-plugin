/**
 * The Tavily configuration card — VIEW half of the client.
 *
 * DSH 0.2.0 moved plugin configuration to per-ENTRY forms: `ctx.configForms`
 * hands out a form keyed by the profile entry id, and the Plugin Manager renders
 * every `plugins.item` entry twice — a `view: 'summary'` line inside its plugin
 * list and the full `view: 'page'` panel. This module claims that item and
 * renders both views. Field specs, draft rules and the staged-write controller
 * live in `./card-model.ts`, which is React-free and driven directly by
 * `pnpm test`; this module only renders what it reports and routes events back.
 *
 * State matrix (the card renders in every state, it never silently vanishes):
 * - `status === 'loading'`: the host has not answered yet.
 * - `status === 'unavailable'`: the entry is not served, or the connection holds
 *   configuration in memory (a non-loopback page).
 * - `status === 'ready'`: the editable form.
 *
 * USER-VISIBLE COPY is never inlined here: every string resolves through the
 * Client locale service (`ctx.locale.bind(namespace)`), whose dictionaries are
 * registered by `src/client/index.ts` — the official rule is "route visible UI
 * text through the Client locale service". The bound `t` is passed to the
 * components as a PROP, never held in a module global: the card stays pure with
 * respect to its inputs, and the reference is stable for the registration's
 * lifetime (the runtime returns one function per namespace).
 * @module dsh-tavily-search-plugin/client/config-card
 */

import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { TAVILY_MCP_TOOLS, TAVILY_SETTINGS_NAMESPACE } from '../shared.ts'
import { booleanText, CardForm, FIELDS } from './card-model.ts'
import type { CardShell, FieldSpec } from './card-model.ts'
import type { ConfigFormsLike, RemoteLike, TranslateLike } from './types.ts'

/**
 * Register the Tavily config page with the Plugin Manager.
 *
 * The services are declared in this bundle's `inject` (see `src/client/index.ts`),
 * so they are mounted by the time this runs; the absent-services branch only
 * guards a profile that mounts this bundle without the settings surface — a card
 * that cannot edit anything is worth less than a diagnostic line.
 * @param ctx - the browser plugin context.
 */
export function registerConfigCard(ctx: Context): void {
  // `configForms` is 0.2.0's replacement for the removed settings scope: one form
  // per profile ENTRY id — the same key this plugin declares in `shared.ts`.
  const forms = ctx.get('configForms') as ConfigFormsLike | undefined
  // The credential plane rides the remote surface (`remote.credentials`), NOT
  // `connection`: the connection handle carries transport state only.
  const remote = ctx.get('remote') as RemoteLike | undefined

  if (forms === undefined || remote === undefined) {
    ctx.logger.warn(
      `[${TAVILY_SETTINGS_NAMESPACE}] configForms/remote missing; the config page cannot mount`,
    )
    return
  }

  const form = new CardForm(forms.get(TAVILY_SETTINGS_NAMESPACE), remote)
  // The form owns two subscriptions; tie their release to this plugin's fiber so
  // an HMR reload or unload cannot leave a stale instance publishing into
  // unmounted components.
  ctx.effect(() => () => form.dispose(), 'tavily: config form subscription')

  // One bound translate for this registration; the runtime hands out a stable
  // function per namespace, so passing it through the inject faces keeps the
  // memoization of every consumer intact.
  const t = bindTranslate(ctx)

  // The controller rides in as `card`, NOT as `form`: the host renderer merges
  // an entry's props as `...injected, ...slotInjected.props, ...ownerProps`, and
  // `plugins.item` owner props are `PluginConfigViewProps` — whose `form` key is
  // the HOST's `{state, mutate}` handle. Owner wins, so an injected `form` would
  // be replaced by that handle, `form.subscribe(...)` would throw, and the slot
  // error boundary would abdicate this entry for the rest of the page load.
  // `view` is the one name we DO want the owner to win: the manager passes the
  // real view for its list row and panel, while the settings tab hands over an
  // empty prop bag and has to be told `'page'` by the inject face.

  // Two settings surfaces can host a plugin's configuration, and a deployment
  // mounts one of them:
  //  - the BUILT-IN PLUGINS section renders one TAB per `settings.plugins.tab`
  //    entry (this deployment ships no plugin-manager page, so this is where a
  //    plugin's config page actually appears), and hands the tab an EMPTY prop
  //    bag — the view has to be stated by the inject face;
  //  - a Plugin Manager deployment renders a one-line `view: 'summary'` row and
  //    the `view: 'page'` panel per `plugins.item` entry.
  // Registering in both keeps the page reachable either way: each `slots.inject`
  // waits for its own slot declaration, so the one that never appears costs
  // nothing. Both claims sit behind `whileServed`, so disabling or uninstalling
  // the entry leaves no dead tab/row behind.
  ctx.effect(() => forms.whileServed([TAVILY_SETTINGS_NAMESPACE], () => {
    const offTab = ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
      {
        name: 'settings.plugins.tab',
        id: TAVILY_SETTINGS_NAMESPACE,
        order: 40,
        // A thunk, so the label follows a language switch without re-registering
        // the entry (the slot owner resolves it at read time).
        label: () => t('title'),
        // Declaring the namespace also puts the framework's own `t` seat on the
        // props; ours wins the merge and carries the interpolation fallback.
        locale: TAVILY_SETTINGS_NAMESPACE,
        inject: () => ({ card: form, view: 'page', t }),
      },
      ConfigCard,
    ))
    const offItem = ctx.slots.inject('plugins.item', () => ctx.slots.register(
      {
        name: 'plugins.item',
        id: TAVILY_SETTINGS_NAMESPACE,
        order: 40,
        label: () => t('title'),
        locale: TAVILY_SETTINGS_NAMESPACE,
        inject: () => ({ card: form, t }),
      },
      ConfigCard,
    ))
    // The callback must return a function: `whileServed` keys its "already
    // registered" guard on it, so returning void would re-register on every sync.
    return () => { offTab?.(); offItem?.() }
  }), 'tavily: config page')
}

// ---- Locale seam ----

/**
 * Substitute `{name}` placeholders in one template.
 *
 * The Client locale runtime already interpolates the params of `t(key, params)`,
 * so on a real host this runs as a no-op; it exists because the second argument
 * is the one part of the `t` seat no runtime check covers, and a raw `{tool}`
 * reaching the card would be a visible defect. Substituting again is safe: our
 * params are constants (namespace, credential ref, tool ids), never text that
 * could itself contain braces.
 * @param text - dictionary template, already interpolated or still raw.
 * @param params - placeholder values; absent means nothing to substitute.
 * @returns the text with every KNOWN placeholder replaced.
 */
function interpolate(text: string, params?: Record<string, unknown>): string {
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => (
    Object.hasOwn(params, name) ? String(params[name]) : placeholder
  ))
}

/**
 * Bind this plugin's namespace to a translate function, keeping the `{name}`
 * fallback at the same seam so every call site just calls `t(key, params)`.
 * @param ctx - the browser plugin context (a `locale` provider is injected).
 * @returns the namespace-bound translate function.
 */
function bindTranslate(ctx: Context): TranslateLike {
  const bound = ctx.locale.bind(TAVILY_SETTINGS_NAMESPACE)
  return (key, params) => interpolate(bound(key, params), params)
}

// ---- Card UI ----

/** Props the slot injects into {@link ConfigCard}. */
interface ConfigCardProps {
  /** Namespace-bound translate, present in both registrations' inject faces. */
  t: TranslateLike
  /**
   * The staged-form controller this card drives. It is spelled `card` rather
   * than `form` because `plugins.item`'s owner props already own that name —
   * see the registration comment above.
   */
  card?: CardForm
  /** Which rendering the manager asked for: a one-line list row or the full panel. */
  view?: 'summary' | 'page'
}

/**
 * The one-line row the manager shows inside its plugin list.
 * @param form - the controller.
 * @param shell - the card projection.
 * @param t - namespace-bound translate.
 * @returns the row element.
 */
function summaryRow(form: CardForm, shell: CardShell, t: TranslateLike): React.ReactElement {
  const key = form.keyState()
  const notes = [
    t('description'),
    key.configured ? t('summary.secretSet') : t('summary.secretUnset'),
    ...shell.dirty ? [t('summary.dirty')] : [],
    ...shell.failed ? [t('summary.failed')] : [],
    // `writable` is `false` in the host's initial snapshot (status 'loading'), so
    // testing it alone would make the first summary line claim "read-only" before
    // the host has answered anything. Only a settled, non-writable document is
    // actually read-only.
    ...shell.status === 'ready' && !shell.writable ? [t('summary.readOnly')] : [],
  ]
  return React.createElement('span', { className: 'dstav-summary' }, notes.join(' · '))
}

/**
 * Render the card. Every hook is declared above every early return: switching
 * from "loading" to "ready" re-renders, and React would throw "Rendered more
 * hooks than during the previous render" if a hook sat below one.
 * @param props - the controller and translate injected by the slot registration,
 *   plus the view.
 * @returns the card element.
 */
function ConfigCard({ t, card, view }: ConfigCardProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  // MCP hand-off confirmation flow: 'asking' when the user flips useMcp on,
  // 'guide' after they answer "not configured yet" (shows the patch snippet).
  const [mcpConfirm, setMcpConfirm] = React.useState<'idle' | 'asking' | 'guide'>('idle')
  // `useSyncExternalStore` rather than subscribe-in-an-effect: a publish landing
  // between the first render and the effect would otherwise be lost, leaving the
  // card on "loading" until the next user input. `shell()` returns a cached
  // object, so React's identity check re-renders only on a real change.
  const subscribe = React.useCallback(
    (notify: () => void) => card?.subscribe(notify) ?? (() => {}),
    [card],
  )
  const shell = React.useSyncExternalStore(subscribe, () => card?.shell() as CardShell)

  // The controller is read through a local alias so the render helpers below can
  // keep their `form` parameter name; only the PROP key had to change.
  const form = card
  if (form === undefined) {
    return statusCard(t('state.unmounted.title'), t('state.unmounted.body'))
  }
  if (view === 'summary') return summaryRow(form, shell, t)
  if (!shell.available) {
    if (shell.status === 'unavailable') {
      return statusCard(
        t('state.unavailable.title', { ns: TAVILY_SETTINGS_NAMESPACE }),
        t('state.unavailable.body'),
        t('state.unavailable.remedy'),
      )
    }
    return statusCard(t('state.loading.title'), t('state.loading.body'))
  }

  const key = form.keyState()
  const onMcpToggled = (checked: boolean) => setMcpConfirm(checked ? 'asking' : 'idle')

  // A `div`, not the `li` this card started as: BOTH hosts mount an item inside a
  // non-list container (`div.panel`, `div[role=tabpanel]`, `section`), where a
  // list item is invalid structure and is announced oddly by assistive tech. The
  // class names are unchanged — every rule in `styles.ts` is a `.dstav-*` class.
  return React.createElement(
    'div',
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
        React.createElement('span', { className: 'dstav-name' }, t('title')),
        React.createElement('span', { className: 'dstav-description' }, t('description')),
      ),
      shell.dirty || key.dirty
        ? React.createElement('span', { className: 'dstav-badge' }, t('badge.unsaved'))
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
            t('readOnly.note'),
          ),
        React.createElement(KeyField, { form, keyState: key, t }),
        // Field order is the model's; the toggle that opens the MCP guide is the
        // only field the view reacts to beyond staging its draft.
        FIELDS.map(spec => React.createElement(FieldRow, {
          key: spec.field,
          form,
          spec,
          shell,
          t,
          onBooleanToggle: spec.field === 'useMcp' ? onMcpToggled : undefined,
        })),
        React.createElement(McpPanel, { state: mcpConfirm, set: setMcpConfirm, form, t }),
        footer(shell, form, key.dirty, t),
      )
      : null,
  )
}

/** Props of {@link KeyField}. */
interface KeyFieldProps {
  form: CardForm
  /**
   * The credential plane's state. Spelled `keyState`, not `key`: React reserves
   * the `key` prop name and would swallow the value as a reconciliation hint.
   */
  keyState: ReturnType<CardForm['keyState']>
  /** Namespace-bound translate. */
  t: TranslateLike
}

/**
 * The API-key control. It reads and writes the credentials domain, not the
 * settings document, so the literal never rides a settings response.
 *
 * A component rather than a render helper so it can own its `useId`: an id has
 * to be derived from a hook, and a hook called from a helper that the card only
 * reaches past its early returns would change the card's hook count between
 * renders.
 * @param props - the form controller, the credential state and translate.
 * @returns the control row.
 */
function KeyField({ form, keyState: key, t }: KeyFieldProps): React.ReactElement {
  // Instance-unique ids, so two cards in one document (a tab AND a manager row,
  // or two plugin entries) cannot collide on `id`/`htmlFor`.
  const inputId = React.useId()
  const hintId = React.useId()
  const statusLabel = key.saving
    ? t('key.saving')
    : key.dirty
      ? t('key.dirty')
      : key.configured
        ? t('key.configured')
        : t('key.unconfigured')
  const statusClass = key.configured || key.dirty || key.saving ? 'dstav-badge' : 'dstav-badge-muted'
  return React.createElement(
    'div',
    { className: 'dstav-field' },
    React.createElement(
      'div',
      { className: 'dstav-field-head' },
      React.createElement('label', { className: 'dstav-label', htmlFor: inputId }, t('key.label')),
      React.createElement(
        'span',
        { className: 'dstav-badges' },
        React.createElement('span', { className: statusClass }, statusLabel),
      ),
    ),
    React.createElement('input', {
      id: inputId,
      className: 'dstav-input',
      type: 'password',
      autoComplete: 'off',
      placeholder: key.configured ? t('key.placeholder.replace') : t('key.placeholder.enter'),
      disabled: !key.writable || key.saving,
      value: key.staged,
      // The hint is programmatically tied to the control, not just placed under it.
      'aria-describedby': hintId,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => form.editKey(event.target.value),
    }),
    React.createElement(
      'p',
      { id: hintId, className: 'dstav-hint' },
      t('key.hint', { ref: key.ref }),
    ),
  )
}

/**
 * The discard/save footer.
 * @param shell - the card-wide projection.
 * @param form - the form controller.
 * @param keyDirty - whether an API-key literal is staged.
 * @param t - namespace-bound translate.
 * @returns the footer element.
 */
function footer(
  shell: CardShell,
  form: CardForm,
  keyDirty: boolean,
  t: TranslateLike,
): React.ReactElement {
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
        t('footer.failed'),
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
      t('footer.discard'),
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dstav-save',
        disabled: !pending || shell.invalid || shell.saving,
        onClick: () => { void form.save() },
      },
      shell.saving ? t('footer.saving') : t('footer.save'),
    ),
  )
}

/** Props of {@link FieldRow}. */
interface FieldRowProps {
  form: CardForm
  /** The field's declaration. */
  spec: FieldSpec
  /** The card-wide projection. */
  shell: CardShell
  /** Namespace-bound translate (labels, hints and invalid copy are keys on the
   * spec, so the model stays language-free). */
  t: TranslateLike
  /** Notified when a `boolean` field flips (used by MCP). */
  onBooleanToggle?: (checked: boolean) => void
}

/**
 * Render one settings field.
 *
 * A component rather than a render helper so it can own its `useId` calls — see
 * {@link KeyField} for why a hook in a helper would be a hook-order hazard.
 * @param props - the form controller, the field's declaration, the card-wide
 *   projection, translate, and the boolean-toggle callback.
 * @returns the field row.
 */
function FieldRow({ form, spec, shell, t, onBooleanToggle }: FieldRowProps): React.ReactElement {
  const state = form.fieldState(spec.field)
  // Editing during a save would stage an edit the in-flight plan knows nothing
  // about; lock the controls for the duration instead.
  const disabled = !shell.writable || shell.saving
  // Instance-unique ids: the label points at the control, and the control points
  // back at the single message under it, so a screen reader reads the hint (or
  // the refusal) as the control's description.
  const inputId = React.useId()
  const messageId = React.useId()
  const inputClass = state.invalid ? 'dstav-input dstav-input-invalid' : 'dstav-input'
  // The `useMcp` hint names the tool the switch hands off to; tool ids are the
  // shared host vocabulary, so they ride in as an interpolation param.
  const hintParams = spec.field === 'useMcp' ? { tool: TAVILY_MCP_TOOLS.search } : undefined
  return React.createElement(
    'div',
    { className: 'dstav-field' },
    React.createElement(
      'div',
      { className: 'dstav-field-head' },
      React.createElement('label', { className: 'dstav-label', htmlFor: inputId }, t(spec.labelKey)),
      state.overridden
        ? React.createElement(
          'span',
          { className: 'dstav-badges' },
          React.createElement('span', { className: 'dstav-badge' }, t('badge.overridden')),
          React.createElement(
            'button',
            { type: 'button', className: 'dstav-reset', disabled, onClick: () => form.clear(spec.field) },
            t('badge.reset'),
          ),
        )
        : null,
    ),
    fieldControl(form, spec, state, inputId, messageId, inputClass, disabled, t, onBooleanToggle),
    React.createElement(
      'p',
      { id: messageId, className: state.invalid ? 'dstav-invalid' : 'dstav-hint' },
      state.invalid
        ? t(spec.invalidKey ?? 'invalid.fallback')
        : t(spec.hintKey, hintParams),
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
 * @param inputId - the control's instance-unique DOM id (also the label's `htmlFor`).
 * @param messageId - id of the hint/invalid message describing this control.
 * @param inputClass - class for text-like controls.
 * @param disabled - whether writes are impossible right now.
 * @param t - namespace-bound translate (the "(not set)" states).
 * @param onBooleanToggle - notified when a `boolean` field flips.
 * @returns the control element.
 */
function fieldControl(
  form: CardForm,
  spec: FieldSpec,
  state: ReturnType<CardForm['fieldState']>,
  inputId: string,
  messageId: string,
  inputClass: string,
  disabled: boolean,
  t: TranslateLike,
  onBooleanToggle?: (checked: boolean) => void,
): React.ReactElement {
  if (spec.kind === 'select') {
    return React.createElement(
      'select',
      {
        id: inputId,
        className: inputClass,
        'aria-describedby': messageId,
        ...state.invalid ? { 'aria-invalid': true } : {},
        value: state.text,
        disabled,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => form.edit(spec.field, event.target.value),
      },
      // The empty value is a real choice — "inherit the layer below" — so it needs
      // a label of its own, not a blank option.
      React.createElement('option', { value: '' }, t('field.unset')),
      (spec.options ?? []).map(option => React.createElement('option', { key: option, value: option }, option)),
    )
  }
  if (spec.kind === 'boolean') {
    // A native checkbox already carries role/checked semantics; it only needs the
    // description wired up, never a redundant `role`/`aria-checked`.
    return React.createElement('input', {
      id: inputId,
      className: 'dstav-checkbox',
      type: 'checkbox',
      'aria-describedby': messageId,
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
    'aria-describedby': messageId,
    ...state.invalid ? { 'aria-invalid': true } : {},
    value: state.text,
    placeholder: spec.placeholder ?? (spec.kind === 'number' ? t('field.unset') : ''),
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
 * reliable form. That placeholder is the snippet's ONE translated part — the rest
 * is verbatim YAML the user pastes (and the copied text is exactly the text on
 * screen, because both come from this one call).
 * @param t - namespace-bound translate.
 * @returns the snippet shown in the guide panel and copied to the clipboard.
 */
function mcpPatchSnippet(t: TranslateLike): string {
  return `- insert:
    - id: mcp-tavily
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: streamable-http
        serverName: tavily
        url: https://mcp.tavily.com/mcp/?tavilyApiKey=<${t('mcp.guide.snippetPlaceholder')}>
        toolCallTimeoutMs: 60000
        failOnStartupError: false`
}

/** Props of {@link McpPanel}. */
interface McpPanelProps {
  state: 'idle' | 'asking' | 'guide'
  set: (next: 'idle' | 'asking' | 'guide') => void
  form: CardForm
  /** Namespace-bound translate, forwarded from the card. */
  t: TranslateLike
}

/**
 * The MCP hand-off guide under the `useMcp` toggle.
 *
 * Three states: 'asking' (the user flipped the toggle on), 'guide' (they
 * answered "not configured yet" — show the snippet), and hidden once they
 * confirm the server is already configured. It is a component, not a helper
 * called from a branch, so it may legitimately own state (the copy feedback) and
 * cannot become a conditional-hook bug later.
 * @param props - panel state, its setter, the form controller and translate.
 * @returns the panel, or `null` when it does not apply.
 */
function McpPanel({ state, set, form, t }: McpPanelProps): React.ReactElement | null {
  const [copy, setCopy] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  if (state === 'idle') return null
  // The panel only makes sense while a `useMcp: true` draft is staged; a discard
  // (or flipping the toggle back) collapses it.
  if (form.booleanField('useMcp') !== true) return null

  if (state === 'asking') {
    return React.createElement(
      'div',
      { className: 'dstav-mcp-panel', role: 'status' },
      React.createElement('p', { className: 'dstav-mcp-title' }, t('mcp.asking.title')),
      React.createElement(
        'div',
        { className: 'dstav-mcp-actions' },
        React.createElement('button', { type: 'button', className: 'dstav-mcp-yes', onClick: () => set('idle') }, t('mcp.asking.yes')),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dstav-mcp-no',
            // Entering the guide starts a fresh visit, so the copy feedback must
            // not carry over: the panel is not unmounted between phases, and a
            // stale "Copied" would claim a clipboard write from a previous visit.
            onClick: () => { setCopy('idle'); set('guide') },
          },
          t('mcp.asking.no'),
        ),
      ),
    )
  }

  const snippet = mcpPatchSnippet(t)
  const copyLabel = copy === 'copied'
    ? t('mcp.guide.copied')
    : copy === 'failed' ? t('mcp.guide.copyFailed') : t('mcp.guide.copy')
  return React.createElement(
    'div',
    { className: 'dstav-mcp-panel' },
    React.createElement(
      'p',
      { className: 'dstav-mcp-title' },
      t('mcp.guide.title'),
    ),
    React.createElement('pre', { className: 'dstav-mcp-snippet' }, snippet),
    React.createElement(
      'div',
      { className: 'dstav-mcp-actions' },
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dstav-mcp-copy',
          onClick: () => {
            // `navigator.clipboard` is absent outside a secure context (plain
            // `http://<lan-ip>:3080`), where `navigator.clipboard?.writeText(...)`
            // would short-circuit the WHOLE chain: no rejection to catch and no
            // `.then` to run, so the button would report nothing at all. A write
            // can also reject (permission, non-secure origin). Both paths must
            // land on the visible failure state. `snippet` is the very text
            // rendered above — never a second copy of it.
            const clipboard = navigator.clipboard
            if (clipboard === undefined) { setCopy('failed'); return }
            clipboard.writeText(snippet).then(() => setCopy('copied'), () => setCopy('failed'))
          },
        },
        copyLabel,
      ),
      React.createElement('button', { type: 'button', className: 'dstav-mcp-back', onClick: () => set('asking') }, t('mcp.guide.back')),
    ),
    React.createElement(
      'p',
      { className: 'dstav-mcp-note' },
      // The tool list is host vocabulary (`../shared.ts`), so it interpolates
      // instead of living duplicated inside the dictionary.
      t('mcp.guide.note', { tools: Object.values(TAVILY_MCP_TOOLS).join(' / ') }),
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
 * Every string arrives already resolved through `t`, so this helper stays a
 * pure layout function.
 * @param title - the headline.
 * @param body - what happened.
 * @param remedy - optional next step.
 * @returns the card element.
 */
function statusCard(title: string, body: string, remedy?: string): React.ReactElement {
  return React.createElement(
    // Same reasoning as the editable card: the hosts mount an item in a
    // non-list container, so the root is a neutral `div`.
    'div',
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
