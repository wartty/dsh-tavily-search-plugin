/**
 * 无宿主冒烟测试：直接 import 构建产物，把本插件的**纯逻辑**与 seam 契约逐条钉住。
 *
 * 宿主半（lib/index.js）：
 *   1. `Config` schema 的默认值与约束（默认值必须在 schema 里，非法配置要响亮）；
 *   2. `toProviderOptions` 的投影（section → provider 选项，字段不缺不漏）；
 *   3. `buildSearchBody` 的请求体规则（结果数封顶、timeRange 优先于 days、
 *      空域名列表不出现在请求里）；
 *   4. `toSearchResult` 的响应归一化（无 URL 的结果丢弃、snippet 截断、
 *      answer 加标签、truncated 由 seam 拥有）；
 *   5. `validateSection` 的写入期拒绝规则；
 *   6. MCP 让位模式的行为（available 恒真、search 不联网只返回引导文案）。
 *
 * 卡片模型（lib/card-model.js，无 React）：
 *   7. 字段表与宿主 schema/词汇表是单一事实源（选项数组是同一引用）；
 *   8. 草稿校验与强转规则；
 *   9. `CardForm` 的写入器 —— 用 stub 服务驱动，回归"凭证域挂错服务"那类事故。
 *
 * 运行前提：先 `pnpm run build`。加 `--live` 且环境里有 TAVILY_API_KEY 时，
 * 额外打一次真实请求验证端到端（会消耗 1 个 Tavily credit），默认不跑。
 */

import {
  buildSearchBody,
  Config,
  mcpHandoffText,
  TAVILY_MCP_TOOLS,
  TAVILY_SEARCH_DEPTHS,
  TAVILY_SETTINGS_NAMESPACE,
  TAVILY_TIME_RANGES,
  TAVILY_TOPICS,
  TavilySearchProvider,
  toProviderError,
  toProviderOptions,
  toSearchResult,
  validateSection,
} from '../lib/index.js'
import {
  booleanText,
  CardForm,
  coerceDraft,
  credentialRefIn,
  credentialRefOf,
  FIELDS,
  fieldSpec,
  isValidDraft,
  stringOf,
} from '../lib/card-model.js'

let failed = 0
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++ }
const throws = (fn, label) => {
  try { fn(); check(false, `${label}（预期抛错但通过了）`) } catch { check(true, label) }
}

// ---- 1) schema：默认值与约束 ----
const defaults = Config({})
check(defaults.baseURL === 'https://api.tavily.com', 'schema 提供 baseURL 默认值')
check(defaults.searchDepth === 'advanced', 'schema 提供 searchDepth 默认值')
check(defaults.maxResults === 7, 'schema 提供 maxResults 默认值')
check(defaults.topic === 'general', 'schema 提供 topic 默认值')
check(defaults.days === 0, 'schema 提供 days 默认值')
check(defaults.includeAnswer === false, 'schema 提供 includeAnswer 默认值')
check(defaults.snippetMaxChars === 600, 'schema 提供 snippetMaxChars 默认值')
check(defaults.useMcp === false, 'schema 提供 useMcp 默认值')
check(defaults.apiKeyEnv === 'TAVILY_API_KEY', 'apiKeyEnv 默认指向 TAVILY_API_KEY')
check(Array.isArray(defaults.includeDomains) && defaults.includeDomains.length === 0, 'domain 列表默认空数组')
check(defaults.timeRange === undefined && defaults.startDate === undefined, '无默认的时间窗字段保持未设置')
throws(() => Config({ searchDepth: 'nope' }), '非法 searchDepth 被拒绝')
throws(() => Config({ topic: 'sport' }), '非法 topic 被拒绝')
throws(() => Config({ maxResults: 99 }), 'maxResults 超上限被拒绝')
throws(() => Config({ maxResults: 0 }), 'maxResults 低于下限被拒绝')
throws(() => Config({ snippetMaxChars: 4 }), 'snippetMaxChars 过小被拒绝')
throws(() => Config({ startDate: '2026/01/01' }), '非 YYYY-MM-DD 日期被拒绝')
throws(() => Config({ chunksPerSource: 4 }), 'chunksPerSource 超范围被拒绝')

// ---- 2) 投影 ----
const project = (patch) => toProviderOptions(Config(patch))
const base = project({})
check(base.maxResults === 7 && base.searchDepth === 'advanced', '投影保留默认值')
check(base.apiKey === undefined, '未配置字面 key 时投影不含 apiKey')
check(base.apiKeyEnv === 'TAVILY_API_KEY', '投影带出 credential 引用')
check(project({ apiKey: '' }).apiKey === undefined, '空字符串字面 key 视为未设置')
check(project({ apiKey: 'tvly-x' }).apiKey === 'tvly-x', '字面 key 被投影')
check(project({ timeRange: 'week' }).timeRange === 'week', 'timeRange 被投影')
check(project({ snippetMaxChars: 120 }).snippetMaxChars === 120, 'snippetMaxChars 被投影')

// ---- 3) 请求体 ----
const body = (request, patch) => buildSearchBody(request, project(patch))
check(body({ query: 'q' }, {}).max_results === 7, '请求未给上限时用配置值')
check(body({ query: 'q', maxResults: 3 }, {}).max_results === 3, '请求要更少时尊重请求')
check(body({ query: 'q', maxResults: 20 }, { maxResults: 7 }).max_results === 7, '请求要更多时被配置封顶')
check(body({ query: 'q' }, { timeRange: 'month', days: 3 }).time_range === 'month', 'timeRange 优先于 days')
check(body({ query: 'q' }, { timeRange: 'month', days: 3 }).days === undefined, 'timeRange 生效时不发 days')
check(body({ query: 'q' }, { days: 3 }).days === 3, '仅配置 days 时发出 days')
check(body({ query: 'q' }, { days: 0 }).days === undefined, 'days=0 表示不设窗口，不出现在请求里')
check(body({ query: 'q' }, {}).include_domains === undefined, '空 includeDomains 不出现在请求里')
check(body({ query: 'q' }, { includeDomains: ['a.com'] }).include_domains?.[0] === 'a.com', 'includeDomains 有值时发出')
check(body({ query: 'q' }, { excludeDomains: ['b.com'] }).exclude_domains?.[0] === 'b.com', 'excludeDomains 有值时发出')
check(body({ query: 'q' }, { includeAnswer: true }).include_answer === true, 'include_answer 跟随配置')
check(body({ query: 'q' }, {}).include_raw_content === false, 'raw content 恒为 false')
check(body({ query: 'hello' }, {}).query === 'hello', 'query 原样透传')

// ---- 4) 响应归一化 ----
const options = project({ snippetMaxChars: 16 })
const mapped = toSearchResult({
  answer: 'summary',
  results: [
    { url: 'https://a.example', title: 'A', content: 'x'.repeat(20) },
    { url: '', title: 'no url', content: 'dropped' },
    { title: 'also dropped' },
    { url: 'https://d.example', content: 'short' },
  ],
}, options)
check(mapped.sources.length === 2, '无 URL 的结果被丢弃（4 条进 2 条出）')
check(mapped.sources[0].url === 'https://a.example', '源 URL 原样保留')
check(mapped.sources[0].snippet.length === 16 && mapped.sources[0].snippet.endsWith('…'), 'snippet 按 snippetMaxChars 截断并带省略号')
check(mapped.sources[1].title === undefined, '空 title 不出现')
check(mapped.sources[1].snippet === 'short', '短 snippet 不被改动')
check(mapped.content === '**Answer:** summary', 'answer 加 **Answer:** 标签')
check(mapped.truncated === false, 'truncated 由 seam 拥有，provider 恒为 false')
const noAnswer = toSearchResult({ results: [] }, options)
check(noAnswer.content === undefined, '无 answer 时 content 不出现')
check(toSearchResult({ answer: '' }, options).content === undefined, '空 answer 视为无 answer')

// ---- 5) 写入期校验 ----
throws(() => validateSection({ baseURL: 'not-a-url' }), '相对 baseURL 被拒绝')
throws(() => validateSection({ startDate: '2026-02-01', endDate: '2026-01-01' }), '倒置日期窗口被拒绝')
validateSection({ baseURL: 'http://127.0.0.1:8080', startDate: '2026-01-01', endDate: '2026-02-01' })
check(true, '合法 section 通过校验')
check(TAVILY_SETTINGS_NAMESPACE === 'web-search-tavily', '命名空间保持 web-search-tavily')

// ---- 6) MCP 让位模式（不联网） ----
const mcpOptions = { ...project({ useMcp: true }), resolveApiKey: async () => 'unused' }
const mcpProvider = new TavilySearchProvider(() => mcpOptions)
check(mcpProvider.id === 'tavily', 'provider id 为 tavily')
check(mcpProvider.available(), 'useMcp 模式下即使 baseURL 非法也保持可用')
const handoff = await mcpProvider.search({ query: 'q' })
check(handoff.sources.length === 0 && handoff.truncated === false, 'useMcp 模式不返回任何来源')
check(handoff.content === mcpHandoffText(), 'useMcp 模式返回统一引导文案')
for (const tool of Object.values(TAVILY_MCP_TOOLS)) {
  check(mcpHandoffText().includes(tool), `引导文案包含 ${tool}`)
}

// ---- 可用性判定 ----
const withResolver = { ...project({}), resolveApiKey: async () => 'k' }
check(new TavilySearchProvider(() => withResolver).available(), '有解析器时可用')
check(new TavilySearchProvider(() => project({})).available() === false, '既无字面 key 也无解析器时不可用')
check(new TavilySearchProvider(() => ({ ...withResolver, baseURL: 'nope' })).available() === false, '相对 URL 时不可用')
check(new TavilySearchProvider(() => ({ ...withResolver, maxResults: 0 })).available() === false, '结果上限非法时不可用')

// ---- 错误分类 ----
const aborted = toProviderError(new DOMException('aborted', 'AbortError'), 'ctx')
check(aborted.code === 'WEB_ABORTED', '取消被映射为 WEB_ABORTED')
const failedError = toProviderError(new Error('boom'), 'Tavily search request failed')
check(failedError.code === 'WEB_PROVIDER_ERROR' && failedError.message.includes('boom'), '其它故障映射为 WEB_PROVIDER_ERROR 并保留原因')

// ---- 可选：真实请求 ----
if (process.argv.includes('--live') && process.env.TAVILY_API_KEY) {
  const live = new TavilySearchProvider(() => ({
    ...project({ maxResults: 2 }),
    resolveApiKey: async () => process.env.TAVILY_API_KEY,
  }))
  const result = await live.search({ query: 'DeepSeek Harness 插件开发', maxResults: 5 })
  check(result.sources.length > 0 && result.sources.length <= 2, `真实搜索返回 ${result.sources.length} 条（≤ 配置上限 2）`)
  check(typeof result.sources[0]?.url === 'string' && result.sources[0].url.startsWith('http'), '真实结果的 URL 可用')
} else {
  console.log('SKIP  真实请求（加 --live 且设置 TAVILY_API_KEY 时执行）')
}

// ---- 7) 卡片字段表与宿主是单一事实源 ----
const hostDefaults = Config({})
const NO_SCHEMA_DEFAULT = new Set(['apiKey', 'timeRange', 'startDate', 'endDate'])
for (const spec of FIELDS) {
  check(spec.label.length > 0 && spec.hint.length > 0, `字段 ${spec.field} 有标签与提示`)
  check(
    hostDefaults[spec.field] !== undefined || NO_SCHEMA_DEFAULT.has(spec.field),
    `字段 ${spec.field} 在宿主 schema 里有对应项`,
  )
  if (spec.kind === 'select') check((spec.options?.length ?? 0) > 0, `select 字段 ${spec.field} 有选项`)
}
throws(() => fieldSpec('nope'), '未知字段名立即报错(不漏渲染空控件)')
// Each half inlines `src/shared.ts`, so the halves are separate bundle copies:
// equality here is by VALUE (which is what catches a drifted copy), not identity.
const sameValues = (left, right) => JSON.stringify(left) === JSON.stringify(right)
check(sameValues(fieldSpec('searchDepth').options, TAVILY_SEARCH_DEPTHS), '搜索深度选项与宿主词汇表一致(同一份 shared 源)')
check(sameValues(fieldSpec('topic').options, TAVILY_TOPICS), '主题选项与宿主词汇表一致')
check(sameValues(fieldSpec('timeRange').options, TAVILY_TIME_RANGES), '时间范围选项与宿主词汇表一致')
check(fieldSpec('maxResults').min === 1 && fieldSpec('maxResults').max === 20, 'maxResults 上下限与 schema 一致')
check(fieldSpec('chunksPerSource').max === 3, 'chunksPerSource 上限与 schema 一致')
check(fieldSpec('snippetMaxChars').min === 16, 'snippetMaxChars 下限与 schema 一致')

// ---- 8) 草稿规则 ----
const numberSpec = fieldSpec('maxResults')
check(isValidDraft(numberSpec, '3') && !isValidDraft(numberSpec, '99') && !isValidDraft(numberSpec, 'x'), '数字草稿按上下限校验')
check(isValidDraft(numberSpec, ''), '空草稿 = 继承 base,始终合法')
check(isValidDraft(fieldSpec('searchDepth'), 'advanced') && !isValidDraft(fieldSpec('searchDepth'), 'nope'), '枚举草稿按选项校验')
check(coerceDraft(numberSpec, '5') === 5, '数字草稿转成 number')
check(JSON.stringify(coerceDraft(fieldSpec('includeDomains'), 'a.com, b.com ,')) === '["a.com","b.com"]', 'textlist 草稿去空白去空项')
check(coerceDraft(fieldSpec('useMcp'), 'true') === true, 'boolean 草稿转成 true')
check(booleanText(false) === 'false', 'booleanText 生成 wire 形式')
check(stringOf(['a', 'b']) === 'a, b' && stringOf(3) === '3' && stringOf(undefined) === '', 'stringOf 渲染各层值')
check(credentialRefIn({ status: 'ready', value: { apiKeyEnv: 'MY_KEY' }, user: {}, writable: true }) === 'MY_KEY', 'credentialRefIn 读取声明的引用')
check(credentialRefIn({ status: 'ready', value: {}, user: {}, writable: true }) === 'TAVILY_API_KEY', 'credentialRefIn 回落默认引用')
check(credentialRefOf('X') === 'X' && credentialRefOf({ ref: 'Y' }) === 'Y' && credentialRefOf({}) === undefined, 'credentialRefOf 兼容两种事件载荷')

// ---- 9) 卡片写入器（stub 服务）----
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

/**
 * Stub the two services the form binds. The scope models a host that persists:
 * `set`/`unset` update the snapshot's user layer, which is exactly what the form
 * re-reads to confirm a write landed. Each flag injects one failure mode.
 */
function harness({
  configured = true,
  failSet = false,
  failDescribe = false,
  throwOnSet = false,
  silentDrop = false,
  gate = null,
} = {}) {
  const state = {
    writes: [], unsets: [], describeCalls: [], setCalls: [], listeners: [], scopeDisposed: 0, remoteDisposed: 0,
  }
  const snapshot = {
    status: 'ready',
    // A real section always carries the schema's defaults, so the stub does too.
    value: { apiKeyEnv: 'TAVILY_API_KEY', maxResults: 7, topic: 'general', useMcp: false, snippetMaxChars: 600 },
    user: {},
    writable: true,
  }
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { state.listeners.push(listener); return () => { state.scopeDisposed++ } },
    set: async (field, value) => {
      state.writes.push([field, value])
      if (gate !== null) await gate
      if (throwOnSet) throw new Error('transport down')
      if (silentDrop) return
      snapshot.user = { ...snapshot.user, [field]: value }
    },
    unset: async (field) => {
      state.unsets.push(field)
      if (gate !== null) await gate
      if (throwOnSet) throw new Error('transport down')
      if (silentDrop) return
      const next = { ...snapshot.user }
      delete next[field]
      snapshot.user = next
    },
  }
  const remote = {
    $on: (event, listener) => { state.listeners.push({ event, listener }); return () => { state.remoteDisposed++ } },
    credentials: {
      describe: async (refs) => {
        state.describeCalls.push(refs)
        if (failDescribe) throw new Error('credentials unavailable')
        return { ok: true, value: { [refs[0]]: { configured, writable: true } } }
      },
      set: async (ref, value) => { state.setCalls.push([ref, value]); if (failSet) throw new Error('write refused') },
    },
  }
  return { scope, remote, state }
}

const main = harness()
const form = new CardForm(main.scope, main.remote)
await tick()
check(main.state.describeCalls.length === 1 && Array.isArray(main.state.describeCalls[0]), '凭证读取用位置参数数组调用 remote.credentials.describe')
check(main.state.describeCalls[0]?.[0] === 'TAVILY_API_KEY', '读取的引用来自 section 的 apiKeyEnv')
check(form.keyState().configured === true, '徽标反映凭证域的 configured')
form.editKey('tvly-x')
check(form.keyState().dirty === true && form.shell().dirty === false, '密钥草稿只影响凭证平面,不污染设置 draft')
await form.save()
check(
  main.state.setCalls.length === 1 && main.state.setCalls[0][0] === 'TAVILY_API_KEY' && main.state.setCalls[0][1] === 'tvly-x',
  '保存走 remote.credentials.set(ref, value)（位置参数）',
)
check(form.keyState().staged === '' && form.keyState().dirty === false, '保存成功后清空密钥草稿')

form.edit('maxResults', '3')
check(form.shell().dirty === true && form.shell().invalid === false, '合法数字草稿进入 dirty')
check(JSON.stringify(form.plan()) === '[{"kind":"set","field":"maxResults","value":3}]', 'plan 给出待写入的具体值(纯数据)')
await form.save()
check(JSON.stringify(main.state.writes) === '[["maxResults",3]]', '保存把草稿强转后写入 scope.set')
check(form.shell().dirty === false && form.plan().length === 0, '保存成功后清空设置草稿')

form.clear('topic')
await form.save()
check(main.state.unsets[0] === 'topic', 'clear 走 scope.unset(字段)')

// 空文本 = 继承 base:必须规划成 clear（set(field, undefined) 会被 merge patch 跳过）
form.edit('topic', '')
check(JSON.stringify(form.plan()) === '[{"kind":"clear","field":"topic"}]', '空文本草稿规划为 clear')
await form.save()
check(main.state.unsets[1] === 'topic' && form.shell().dirty === false, '空文本保存走 unset')

// 非法草稿:整批拒绝(含凭证),不产生任何写入
form.edit('maxResults', '99')
check(form.shell().invalid === true && form.plan()[0]?.kind === 'refused', '非法草稿标记 refused 且 shell.invalid 为真')
const beforeMixed = { writes: main.state.writes.length, sets: main.state.setCalls.length }
form.editKey('tvly-late')
await form.save()
check(
  main.state.writes.length === beforeMixed.writes && main.state.setCalls.length === beforeMixed.sets,
  '任一草稿非法 → 整个保存被拒(设置与凭证都不写)',
)
check(form.shell().failed === true && form.keyState().staged === 'tvly-late', '被拒的保存标记 failed 并保留密钥草稿')
form.discard()
check(form.plan().length === 0 && form.keyState().staged === '', 'discard 同时清掉设置与密钥草稿')

form.edit('useMcp', 'true')
check(form.booleanField('useMcp') === true, 'booleanField 读取草稿')
form.discard()
check(form.booleanField('useMcp') === false, 'discard 后回到 section 的值')

const invalidation = main.state.listeners.find(entry => entry?.event === 'credentials/reference-updated')
const readsBefore = main.state.describeCalls.length
invalidation?.listener('TAVILY_API_KEY')
await tick()
check(main.state.describeCalls.length === readsBefore + 1, '凭证失效事件触发重读')
form.dispose()
check(main.state.scopeDisposed === 1 && main.state.remoteDisposed === 1, 'dispose 释放 scope 与 remote 订阅')

// 宿主"接受调用但没有落盘":必须判失败并保留草稿,绝不能显示成功
const silent = harness({ silentDrop: true })
const silentForm = new CardForm(silent.scope, silent.remote)
await tick()
silentForm.edit('topic', 'news')
await silentForm.save()
check(silentForm.shell().failed === true && silentForm.plan().length === 1, '宿主接受但未落盘 → 判失败并保留草稿')
silentForm.dispose()

// 写入 reject:不得逃逸成 unhandled rejection,且失败可见
const throwing = harness({ throwOnSet: true })
const throwingForm = new CardForm(throwing.scope, throwing.remote)
await tick()
throwingForm.edit('topic', 'news')
await throwingForm.save()
check(throwingForm.shell().failed === true && throwingForm.plan().length === 1, '写入 reject → 标记失败并保留草稿')
throwingForm.dispose()

// 并发 save 只执行一次
const concurrent = harness()
const concurrentForm = new CardForm(concurrent.scope, concurrent.remote)
await tick()
concurrentForm.edit('topic', 'news')
await Promise.all([concurrentForm.save(), concurrentForm.save()])
check(concurrent.state.writes.length === 1, '并发 save 只执行一次(重入保护)')
concurrentForm.dispose()

// 保存期间的新编辑不能被 save 清掉
let release = () => {}
const gate = new Promise(resolve => { release = resolve })
const gated = harness({ gate })
const gatedForm = new CardForm(gated.scope, gated.remote)
await tick()
gatedForm.edit('topic', 'news')
gatedForm.edit('maxResults', '3')
const inFlight = gatedForm.save()
await tick()
gatedForm.edit('chunksPerSource', '2')
release()
await inFlight
check(
  JSON.stringify(gatedForm.plan()) === '[{"kind":"set","field":"chunksPerSource","value":2}]',
  '保存期间的新编辑留在草稿里,不被 save 清掉',
)
gatedForm.dispose()

const refusedCredential = harness({ failSet: true })
const refusedCredentialForm = new CardForm(refusedCredential.scope, refusedCredential.remote)
await tick()
refusedCredentialForm.editKey('tvly-y')
await refusedCredentialForm.save()
check(refusedCredentialForm.shell().failed === true && refusedCredentialForm.keyState().staged === 'tvly-y', '凭证写入被拒时保留草稿并标记失败')
refusedCredentialForm.dispose()

const readFail = harness({ failDescribe: true })
const readFailForm = new CardForm(readFail.scope, readFail.remote)
await tick()
check(readFailForm.keyState().configured === false, '凭证读取失败不致命,卡片仍可用')
readFailForm.edit('topic', 'news')
await readFailForm.save()
check(JSON.stringify(readFail.state.writes) === '[["topic","news"]]', '凭证平面故障不影响设置写入')
readFailForm.dispose()

if (failed > 0) { console.error(`\n${failed} 项检查未通过`); process.exit(1) }
console.log('\n全部通过')
