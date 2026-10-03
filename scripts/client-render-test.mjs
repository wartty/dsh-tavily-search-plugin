/**
 * 客户端**视图层**渲染回归测试（无浏览器、无网络、无外部依赖）。
 *
 * `lib/client.js` 是给浏览器模块加载器用的 CJS 工厂：加载时调用
 * `window.__ModuleLoader__.load({ id, factory })` 注册自己，factory 的 `require`
 * 只依赖 `react`。因此这个脚本自带三件替身，就能在 Node 里真正渲染出组件树：
 *   1. 假 `window`（接住 factory）与假 `document`（样式注入用）；
 *   2. 极简 React：`createElement` + `useState` / `useSyncExternalStore` /
 *      `useCallback` / `useId`，加上一个"setState 后整树同步重渲染"的渲染器，
 *      元素树就是普通对象（`{ type, props, children }`），不需要 DOM；
 *   3. stub cordis 服务：`slots` / `configForms` / `locale` / `remote`。
 *
 * 然后真的调用 `apply(ctx)`，把插槽注册拿到的组件按**宿主的 props 合并顺序**
 * （`...injected, ...ownerProps`，owner 胜出，见
 * `dsh-client-ui-renderer/lib/client.js:771-777`）渲染出来。覆盖的缺陷：
 *   F1 prop 撞名（owner 的 `form` 顶掉控制器 → 崩溃 + entry 被除名）
 *   F2 日期草稿必须在视图里可见地标红
 *   F4 clipboard 缺失 / 写失败都要进失败态，且重进 guide 要复位
 *   F5 根元素不是 `li`
 *   F6 加载期 summary 不得谎报"只读"
 *   F8 label/aria-describedby 的程序化关联、实例内唯一 id、双卡片不撞 id
 *
 * 运行前提：先构建（`pnpm run build` / `./node_modules/.bin/tsdown`）。
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++ }

/** 运行 `fn`，把"不该抛却抛了"记成一条失败断言而不是让整个脚本崩掉。 */
function noThrow(fn, label) {
  try {
    const value = fn()
    check(true, label)
    return value
  } catch (error) {
    check(false, `${label}（抛错：${error?.message ?? error}）`)
    return undefined
  }
}

// ---- 1) 极简 React ----

const isElement = node => typeof node === 'object' && node !== null && !Array.isArray(node)

/** 元素树的全部文本（按作者顺序用空格拼接）。 */
function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!isElement(node)) return ''
  return (node.children ?? []).map(textOf).join(' ')
}

/** 深度优先找出所有满足条件的**宿主元素**。 */
function findAll(nodes, predicate) {
  const hits = []
  const walk = list => {
    for (const node of list) {
      if (!isElement(node)) continue
      if (predicate(node)) hits.push(node)
      walk(node.children ?? [])
    }
  }
  walk(Array.isArray(nodes) ? nodes : [nodes])
  return hits
}

const classList = node => String(node.props?.className ?? '').split(/\s+/).filter(Boolean)
const byClass = (nodes, name) => findAll(nodes, node => classList(node).includes(name))

/**
 * 造一个 React 替身。每个 `mount()` 拥有自己的 hook 表，所以同一进程里可以同时
 * 挂多份卡片（F8 的"双卡片 id 不冲突"就靠这个）；`useId` 的计数器是模块级的，
 * 与真实 React 一样在整篇文档内唯一。
 */
function createReact() {
  let hookRecord = null
  let hookSchedule = null
  let idSeq = 0

  function useSlot() {
    if (hookRecord === null) throw new Error('dsh-tavily-search-plugin test: hook called outside a component render')
    const index = hookRecord.cursor++
    if (hookRecord.slots[index] === undefined) hookRecord.slots[index] = { value: undefined }
    return { slot: hookRecord.slots[index], schedule: hookSchedule }
  }

  function useState(initial) {
    const { slot, schedule } = useSlot()
    if (slot.value === undefined) slot.value = typeof initial === 'function' ? initial() : initial
    const setState = next => {
      const value = typeof next === 'function' ? next(slot.value) : next
      if (Object.is(value, slot.value)) return
      slot.value = value
      schedule()
    }
    return [slot.value, setState]
  }

  function useCallback(fn, deps) {
    const { slot } = useSlot()
    const changed = slot.deps === undefined || deps === undefined
      || deps.length !== slot.deps.length
      || deps.some((dep, index) => !Object.is(dep, slot.deps[index]))
    if (changed) {
      slot.value = fn
      slot.deps = deps === undefined ? undefined : [...deps]
    }
    return slot.value
  }

  function useSyncExternalStore(subscribe, getSnapshot) {
    const { slot, schedule } = useSlot()
    if (slot.subscribe !== subscribe) {
      if (typeof slot.unsubscribe === 'function') slot.unsubscribe()
      slot.subscribe = subscribe
      const stop = subscribe(() => schedule())
      slot.unsubscribe = typeof stop === 'function' ? stop : undefined
    }
    return getSnapshot()
  }

  function useId() {
    const { slot } = useSlot()
    if (slot.value === undefined) slot.value = `:r${idSeq++}:`
    return slot.value
  }

  function createElement(type, props, ...children) {
    const next = { ...(props ?? {}) }
    const key = next.key ?? null
    delete next.key
    next.children = children
    return { type, props: next, key, children }
  }

  function mount(type, props) {
    const records = new Map()
    let rendering = false
    let dirty = false
    let tree = []

    function walk(node, parentPath, index, out) {
      if (node === null || node === undefined || typeof node === 'boolean') return
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) walk(node[i], `${parentPath}.${index}`, i, out)
        return
      }
      if (typeof node === 'string' || typeof node === 'number') {
        out.push(String(node))
        return
      }
      const keySuffix = node.key === null || node.key === undefined ? '' : `#${String(node.key)}`
      const nodePath = `${parentPath}.${index}${keySuffix}`
      if (typeof node.type === 'function') {
        let record = records.get(nodePath)
        if (record === undefined) {
          record = { slots: [], cursor: 0 }
          records.set(nodePath, record)
        }
        const previousRecord = hookRecord
        const previousSchedule = hookSchedule
        hookRecord = record
        hookSchedule = schedule
        record.cursor = 0
        let rendered
        try {
          rendered = node.type({ ...node.props })
        } finally {
          hookRecord = previousRecord
          hookSchedule = previousSchedule
        }
        walk(rendered, nodePath, 0, out)
        return
      }
      const host = { type: node.type, props: node.props, children: [] }
      out.push(host)
      const children = Array.isArray(node.children) ? node.children : []
      for (let i = 0; i < children.length; i++) walk(children[i], nodePath, i, host.children)
    }

    function build() {
      const out = []
      rendering = true
      try {
        walk({ type, props: { ...props }, key: null, children: [] }, 'root', 0, out)
      } finally {
        rendering = false
      }
      return out
    }

    function flush() {
      tree = build()
      // 渲染期 setState（React 的 render-phase update）会在 build 期间置 dirty。
      let guard = 0
      while (dirty && guard++ < 100) {
        dirty = false
        tree = build()
      }
    }

    function schedule() {
      if (rendering) {
        dirty = true
        return
      }
      flush()
    }

    flush()
    return {
      get tree() { return tree },
      get text() { return textOf(tree) },
      rerender: flush,
    }
  }

  return { createElement, useState, useCallback, useSyncExternalStore, useId, mount }
}

// ---- 2) 加载构建产物：假 window / document + factory 握手 ----

const CLIENT_BUNDLE = new URL('../lib/client.js', import.meta.url)
if (!existsSync(fileURLToPath(CLIENT_BUNDLE))) {
  console.error('缺少 lib/client.js —— 请先构建（./node_modules/.bin/tsdown）')
  process.exit(1)
}

const loadCalls = []
globalThis.window = {
  __ModuleLoader__: {
    load(entry) { loadCalls.push(entry) },
  },
}
// 样式注入会碰这几个 API；测试不关心 CSS，只要不炸。
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {} }),
  head: { appendChild() {} },
}

await import(CLIENT_BUNDLE.href)

const react = createReact()
check(loadCalls.length === 1 && loadCalls[0].id === 'dsh-tavily-search-plugin', '构建产物通过 window.__ModuleLoader__.load 注册自己')
const clientModule = loadCalls[0].factory(name => {
  if (name === 'react') return react
  throw new Error(`测试替身没有提供模块 "${name}"`)
})
check(typeof clientModule.apply === 'function' && Array.isArray(clientModule.inject), 'factory 导出 apply 与 inject 服务清单')

// ---- 3) stub cordis 服务 ----

const DEFAULTS = Object.freeze({
  apiKeyEnv: 'TAVILY_API_KEY',
  baseURL: 'https://api.tavily.com',
  maxResults: 7,
  searchDepth: 'advanced',
  topic: 'general',
  chunksPerSource: 1,
  snippetMaxChars: 600,
  useMcp: false,
})

/**
 * 造一个假的浏览器 cordis 上下文。
 * @param locale 初始语言。
 * @param snapshot 初始配置快照（F6 用它伪造 loading / 只读）。
 * @param services 传 false 模拟设置服务缺失的 profile。
 */
function createHarness({ locale = 'zh', snapshot: snapshotOverrides = {}, services = true } = {}) {
  const state = {
    registrations: [],
    warnings: [],
    dictionaries: new Map(),
    listeners: new Set(),
    setCalls: [],
    locale,
    credentialWrites: [],
  }
  const snapshot = {
    status: 'ready',
    value: { ...DEFAULTS },
    user: {},
    writable: true,
    ...snapshotOverrides,
  }
  const publish = () => { for (const listener of [...state.listeners]) listener() }
  const interpolate = (text, params) => params === undefined
    ? text
    : text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))

  // 宿主 ConfigFormLike 的最小子集：写入落到 user 层，正好是卡片保存后复读的那层。
  const configForm = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      state.listeners.add(listener)
      return () => { state.listeners.delete(listener) }
    },
    async set(field, value) {
      state.setCalls.push([field, value])
      snapshot.user = { ...snapshot.user, [field]: value }
      snapshot.value = { ...snapshot.value, [field]: value }
      publish()
    },
    async unset(field) {
      state.setCalls.push([field, undefined])
      const next = { ...snapshot.user }
      delete next[field]
      snapshot.user = next
      publish()
    },
  }
  const remote = {
    $on() { return () => {} },
    credentials: {
      async describe(refs) { return { ok: true, value: { [refs[0]]: { configured: true, writable: true } } } },
      async set(ref, value) { state.credentialWrites.push([ref, value]) },
    },
  }
  const configForms = {
    get() { return configForm },
    whileServed(namespaces, register) { register(); return () => {} },
  }

  const ctx = {
    effect(fn) { const result = fn(); return typeof result === 'function' ? result : () => {} },
    logger: { warn: message => state.warnings.push(String(message)), info() {} },
    get(name) {
      if (!services) return undefined
      if (name === 'configForms') return configForms
      if (name === 'remote') return remote
      return undefined
    },
    slots: {
      inject(name, register) {
        // 宿主在插槽声明后调用回调；这里立刻调用，等价于"两个宿主都在场"。
        const dispose = register()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      register(options, component) {
        state.registrations.push({ options, component })
        return () => {}
      },
    },
    locale: {
      register(namespace, dicts) {
        state.dictionaries.set(namespace, dicts)
        return () => { state.dictionaries.delete(namespace) }
      },
      bind(namespace) {
        return (key, params) => {
          const table = state.dictionaries.get(namespace)?.[state.locale] ?? {}
          return interpolate(table[key] ?? key, params)
        }
      },
    },
  }

  return { ctx, state, snapshot, publish, registration: name => state.registrations.find(entry => entry.options.name === name) }
}

/** 宿主合并顺序：`...kit, ...injected, ...slotInjected.props, ...ownerProps`（owner 胜出）。 */
const mergeProps = (registration, ownerProps = {}) => ({ ...registration.options.inject(), ...ownerProps })

/** 按 label 文案找到它指向的控件 —— 顺便验证 `htmlFor`/`id` 是通的。 */
function controlForLabel(tree, labelText) {
  const label = findAll(tree, node => node.type === 'label' && textOf(node).trim() === labelText)[0]
  if (label === undefined) return undefined
  return findAll(tree, node => node.props?.id === label.props?.htmlFor)[0]
}

const click = node => node.props?.onClick?.({})
const changeText = (node, value) => node.props?.onChange?.({ target: { value } })
const toggle = (node, checked) => node.props?.onChange?.({ target: { checked } })
const flushMicrotasks = () => new Promise(resolve => setImmediate(resolve))

/** 展开卡片（字段只在展开后才渲染，和真实宿主一致）。 */
function expand(view) {
  click(byClass(view.tree, 'dstav-header')[0])
  return view
}

/** 装/拆一个可用的 navigator.clipboard（Node 自带的 navigator 只有 userAgent）。 */
function setClipboard(clipboard) {
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true, writable: true })
}

// ---- 4) 注册契约 + F1 ----

const harness = createHarness({ locale: 'zh' })
noThrow(() => clientModule.apply(harness.ctx), 'apply(ctx) 在两个宿主槽位都注册成功')
// 让 CardForm 构造时的首次凭证 describe 落地，后面才读得到"已配置"。
await flushMicrotasks()
const tab = harness.registration('settings.plugins.tab')
const item = harness.registration('plugins.item')
check(tab !== undefined && item !== undefined, 'settings.plugins.tab 与 plugins.item 各注册一份')
check(tab?.options.id === 'web-search-tavily' && item?.options.id === 'web-search-tavily', '两个槽位都用设置命名空间作为条目 id')
check(tab?.options.locale === 'web-search-tavily' && tab?.options.label?.() === 'Tavily 网页搜索', 'tab 标签经 locale 服务解析为中文标题')

const tabInjected = tab.options.inject()
const itemInjected = item.options.inject()
check(!('form' in tabInjected) && !('form' in itemInjected), 'F1: inject face 不再占用 owner 保留名 form')
check('card' in tabInjected && 'card' in itemInjected, 'F1: 控制器改挂 card')
check(tabInjected.view === 'page' && !('view' in itemInjected), 'F1: 只有空 props 的 tab 注入 view=page，manager 的 view 仍由 owner 决定')

// owner props 就是宿主的 PluginConfigViewProps：view + form:{state,mutate}。
const ownerForm = { state: { value: {} }, mutate() {} }
const itemProps = mergeProps(item, { view: 'page', form: ownerForm })
const pageView = noThrow(() => react.mount(item.component, itemProps), 'F1: 传入 owner 的 form prop 渲染 view=page 不抛错')
check(itemProps.card !== undefined && itemProps.form === ownerForm, 'F1: 注入的控制器仍在 card 上，owner 的 form 原样不动')
check(pageView !== undefined && pageView.tree[0]?.type === 'div', 'F1: 渲染出真实的卡片根元素')
expand(pageView)
check(pageView?.text.includes('每次搜索最多结果数') === true, 'F1: 控制器仍生效（字段标签照常渲染）')
check(controlForLabel(pageView?.tree ?? [], '每次搜索最多结果数')?.props?.value === '7', 'F1: 控件初值来自控制器读到的快照（maxResults=7）')
// 控制器 publish 后视图必须跟着更新：证明 useSyncExternalStore 订阅的是我们自己的 form。
itemProps.card.edit('maxResults', '9')
check(controlForLabel(pageView?.tree ?? [], '每次搜索最多结果数')?.props?.value === '9', 'F1: 控制器 publish 后视图同步重渲染（订阅没被 owner prop 切断）')

// ---- 5) summary 视图 ----

const summaryProps = mergeProps(item, { view: 'summary' })
const summaryView = noThrow(() => react.mount(item.component, summaryProps), 'view=summary 渲染成功不抛错')
check(summaryView?.tree[0]?.type === 'span' && classList(summaryView.tree[0]).includes('dstav-summary'), 'summary 是 dstav-summary 一行')
check(summaryView?.text.includes('Tavily API 搜索提供方') === true, 'summary 文案来自描述')
check(summaryView?.text.includes('密钥已配置') === true, 'summary 带上凭证状态')

// ---- 6) t() 全链路 ----

const dictionaries = harness.state.dictionaries.get('web-search-tavily')
check(dictionaries !== undefined && typeof dictionaries.en?.title === 'string' && typeof dictionaries.zh?.title === 'string', '字典以 namespace 注册，en/zh 两半在同一次注册里')
check(pageView?.text.includes('Tavily 网页搜索') === true, '中文文案经 locale.bind 出现在渲染结果里')
check(pageView?.text.includes('TAVILY_API_KEY') === true, 't(key, params) 的插值一路到视图（key.hint 的 {ref}）')
const englishHarness = createHarness({ locale: 'en' })
clientModule.apply(englishHarness.ctx)
const englishView = expand(react.mount(englishHarness.registration('plugins.item').component, mergeProps(englishHarness.registration('plugins.item'), { view: 'page' })))
check(englishView.text.includes('Tavily Web Search') === true, 'en 语言下标题切到英文')
check(englishView.text.includes('Endpoint') === true, 'en 语言下字段标签是英文')

// ---- 7) F4：复制配置的失败态与复位 ----

/** 走到 guide 态：展开卡片 → 打开 useMcp → 回答"未配置"。 */
function openGuide(view) {
  click(byClass(view.tree, 'dstav-header')[0])
  toggle(byClass(view.tree, 'dstav-checkbox')[0], true)
  click(byClass(view.tree, 'dstav-mcp-no')[0])
  return byClass(view.tree, 'dstav-mcp-panel')[0]
}

setClipboard(undefined)
const noClipboardView = react.mount(item.component, mergeProps(item, { view: 'page' }))
openGuide(noClipboardView)
check(noClipboardView.text.includes('复制配置') === true, 'guide 态渲染出"复制配置"按钮')
click(byClass(noClipboardView.tree, 'dstav-mcp-copy')[0])
check(noClipboardView.text.includes('复制失败,请手动选择') === true, 'F4: navigator.clipboard 缺失时进入失败态（不再是静默无反应）')

const clipboardCalls = []
setClipboard({ writeText: async text => { clipboardCalls.push(text) } })
const copiedView = react.mount(item.component, mergeProps(item, { view: 'page' }))
openGuide(copiedView)
click(byClass(copiedView.tree, 'dstav-mcp-copy')[0])
await flushMicrotasks()
check(copiedView.text.includes('已复制') === true, 'F4: 复制成功进入 copied 态')
check(clipboardCalls.length === 1 && clipboardCalls[0].includes('mcp-tavily'), '复制的是屏幕上那段 patch 片段')
click(byClass(copiedView.tree, 'dstav-mcp-back')[0])
click(byClass(copiedView.tree, 'dstav-mcp-no')[0])
check(copiedView.text.includes('复制配置') === true && copiedView.text.includes('已复制') === false, 'F4: 重新进入 guide 时复制状态复位')
setClipboard(undefined)

// ---- 8) F5：根元素不是 li ----

check(pageView?.tree[0]?.type !== 'li', 'F5: 可编辑卡片根元素不是 li')
const unmountedProps = { t: itemInjected.t, view: 'page' }
const unmountedView = noThrow(() => react.mount(item.component, unmountedProps), '缺少控制器时渲染不抛错（诊断分支）')
check(unmountedView?.tree[0]?.type === 'div' && unmountedView.tree[0].type !== 'li', 'F5: statusCard 根元素也不是 li')
check(unmountedView?.text.includes('设置服务不可用') === true, '缺少控制器时走 state.unmounted 诊断文案')
check(findAll(pageView?.tree ?? [], node => node.type === 'li').length === 0, 'F5: 整棵卡片树里没有 li')
check(findAll(unmountedView?.tree ?? [], node => node.type === 'li').length === 0, 'F5: 诊断卡片树里也没有 li')

// ---- 9) F2：日期草稿在视图里可见地标红 ----

// 独立的 harness：日期草稿不与前面几节的草稿互相污染。
const dateHarness = createHarness({ locale: 'zh' })
clientModule.apply(dateHarness.ctx)
const dateView = expand(react.mount(dateHarness.registration('plugins.item').component, mergeProps(dateHarness.registration('plugins.item'), { view: 'page' })))
const startInput = controlForLabel(dateView.tree, '起始日期')
check(startInput !== undefined && startInput?.props?.type === 'text', '起始日期渲染出文本控件')
changeText(startInput, '2026-1-1')
check(dateView.text.includes('必须是 YYYY-MM-DD 形式的合法日期') === true, 'F2: 非法日期草稿显示专用文案（不是通用页脚提示）')
check(controlForLabel(dateView.tree, '起始日期')?.props?.['aria-invalid'] === true, 'F2: 非法日期控件带 aria-invalid')
changeText(controlForLabel(dateView.tree, '起始日期'), '2026-01-01')
check(dateView.text.includes('必须是 YYYY-MM-DD 形式的合法日期') === false, 'F2: 改回合法日期后恢复提示')
check(controlForLabel(dateView.tree, '起始日期')?.props?.['aria-invalid'] === undefined, 'F2: 合法日期不再标 aria-invalid')

// ---- 10) F8：label / aria-describedby 的程序化关联与唯一 id ----

const ariaTree = dateView.tree
const labels = findAll(ariaTree, node => node.type === 'label')
const controls = findAll(ariaTree, node => ['input', 'select'].includes(node.type))
check(labels.length === controls.length && labels.length > 0, `每个控件都有一个 label（${labels.length} 对）`)
check(
  labels.every(label => controls.some(control => control.props.id === label.props.htmlFor)),
  'F8: 每个 label 的 htmlFor 都指向本卡片的控件 id',
)
check(
  controls.every(control => {
    const described = control.props['aria-describedby']
    if (typeof described !== 'string' || described.length === 0) return false
    return findAll(ariaTree, node => node.props?.id === described).length === 1
  }),
  'F8: 每个控件都用 aria-describedby 指向唯一的提示/非法文案节点',
)
const checkbox = findAll(ariaTree, node => node.type === 'input' && node.props.type === 'checkbox')[0]
check(checkbox !== undefined && checkbox.props.role === undefined && checkbox.props['aria-checked'] === undefined && typeof checkbox.props['aria-describedby'] === 'string', 'F8: useMcp 保持原生 checkbox 语义（不加多余 role/aria-checked，只补 describedby）')
const idsInOneCard = findAll(ariaTree, node => typeof node.props?.id === 'string').map(node => node.props.id)
check(new Set(idsInOneCard).size === idsInOneCard.length, `F8: 单张卡片内 id 唯一（${idsInOneCard.length} 个）`)
check(idsInOneCard.some(id => id.includes(':r')) === true, 'F8: id 由 useId 派生，不再是写死的 dstav-api-key / dstav-<field>')

// 同一文档挂两份卡片（settings tab + manager 面板）时 id 不能撞。
const secondHarness = createHarness({ locale: 'zh' })
clientModule.apply(secondHarness.ctx)
const secondView = expand(react.mount(secondHarness.registration('plugins.item').component, mergeProps(secondHarness.registration('plugins.item'), { view: 'page' })))
const idsInSecondCard = findAll(secondView.tree, node => typeof node.props?.id === 'string').map(node => node.props.id)
check(idsInSecondCard.length > 0 && idsInSecondCard.every(id => !idsInOneCard.includes(id)), 'F8: 两份卡片同文档时 id 互不冲突')

// ---- 11) F6：加载期 summary 不谎报只读 ----

const loadingHarness = createHarness({ locale: 'zh', snapshot: { status: 'loading', writable: false } })
clientModule.apply(loadingHarness.ctx)
const loadingView = react.mount(loadingHarness.registration('plugins.item').component, mergeProps(loadingHarness.registration('plugins.item'), { view: 'summary' }))
check(loadingView.text.includes('只读') === false, 'F6: status=loading 的 summary 不显示"只读"')
loadingHarness.snapshot.status = 'ready'
loadingHarness.publish()
check(loadingView.text.includes('只读') === true, 'F6: status=ready 且不可写时 summary 才追加"只读"')

// ---- 12) 服务缺失：注册分支不抛错、不注册 ----

const emptyHarness = createHarness({ services: false })
noThrow(() => clientModule.apply(emptyHarness.ctx), 'configForms/remote 缺失时 apply 不抛错')
check(emptyHarness.state.registrations.length === 0, '服务缺失时不注册任何插槽条目')
check(emptyHarness.state.warnings.length === 1 && emptyHarness.state.warnings[0].includes('configForms'), '服务缺失时留下一条可诊断的 warn')

// ---- 结果 ----

if (failed > 0) {
  console.error(`\n${failed} 项检查未通过`)
  process.exit(1)
}
console.log('\n全部通过')
