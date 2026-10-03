/**
 * Copy for the Tavily configuration page, routed through the Client locale
 * service (the in-box pages do the same — `ui-plugin.md`: "Route visible UI text
 * through the Client locale service").
 *
 * KEYS ARE FLAT, dotted strings: `t('field.maxResults.hint')` looks up the exact
 * key `field.maxResults.hint`, so no path-resolution semantics are assumed.
 * `card-model.ts` stores keys, never copy, which keeps the model free of language
 * and lets `pnpm test` assert that every field points at one.
 * @module dsh-tavily-search-plugin/client/locales
 */

const keys = {
  title: ['Tavily Web Search', 'Tavily 网页搜索'],
  description: [
    'Tavily-backed web search provider (free tier by default).',
    'Tavily API 搜索提供方(默认走免费额度)。',
  ],
  'summary.secretSet': ['key configured', '密钥已配置'],
  'summary.secretUnset': ['key not configured', '密钥未配置'],
  'summary.dirty': ['unsaved changes', '有未保存改动'],
  'summary.failed': ['last save did not fully apply', '上次保存未全部生效'],
  'summary.readOnly': ['read-only', '只读'],
  'state.unmounted.title': ['Settings services unavailable', '设置服务不可用'],
  'state.unmounted.body': [
    'The plugin did not receive configForms / remote, so the page cannot mount. Check that the profile mounts its settings surface (the web profile does).',
    '插件未拿到 configForms / remote 服务,配置页无法挂载。检查 profile 是否挂载了设置界面(web profile 默认挂载)。',
  ],
  'state.unavailable.title': ['Entry "{ns}" is not writable right now', '条目 "{ns}" 当前不可写'],
  'state.unavailable.body': [
    'Two causes: the entry is not served by the Host (plugin missing or disabled), or this connection keeps configuration in memory (a non-loopback page does not persist). The host half is unaffected — every search still reads this entry\'s config.',
    '两种成因:该条目没有被宿主服务(插件未安装或被禁用),或当前连接把配置保留在内存里(非 loopback 页面不落盘)。host 半不受影响,`ctx.web` 每次搜索仍会读取本条目配置。',
  ],
  'state.unavailable.remedy': [
    'Open the page from the address dsh web printed on the Host machine to get a persistable configuration surface; see the plugin README for whether the entry is served.',
    '在 DSH 主机本机用 dsh web 打印的地址打开页面,可以拿到可持久化的配置面;条目是否被服务见插件 README 的故障排查章节。',
  ],
  'state.loading.title': ['Reading configuration…', '正在读取配置…'],
  'state.loading.body': [
    'Waiting for the Host\'s first settings.describe answer; the form switches to editable as soon as it arrives.',
    '等待 host 端首次回答 settings.describe;到达后卡片会自动切换为可编辑状态。',
  ],
  'readOnly.note': [
    'This settings document is read-only (memory mode or a read-only provider); changes are not persisted.',
    '当前设置文档为只读(memory 模式或只读 provider),所有改动不会持久化。',
  ],
  'key.label': ['API key', 'API key'],
  'key.saving': ['saving…', '保存中…'],
  'key.dirty': ['unsaved', '未保存'],
  'key.configured': ['configured', '已配置'],
  'key.unconfigured': ['not configured', '未配置'],
  'key.placeholder.replace': ['Configured — type a new value to replace', '已配置——输入新值以替换'],
  'key.placeholder.enter': ['Enter a Tavily API key (tvly-...)', '输入 Tavily API Key (tvly-...)'],
  'key.hint': [
    'Stored in the DSH credential domain only (reference {ref}); never returned with the settings document.',
    '写入后仅存于 DSH 凭证域(引用 {ref}),不会随 settings 文档回传。',
  ],
  'footer.failed': [
    'The save did not fully apply; drafts that did not land are kept — fix and retry.',
    '保存未全部生效;未落盘的草稿已保留,请修正或重试。',
  ],
  'footer.discard': ['Discard', '放弃'],
  'footer.save': ['Save', '保存'],
  'footer.saving': ['Saving…', '保存中…'],
  'badge.unsaved': ['unsaved', '未保存'],
  'badge.overridden': ['overridden', '已覆盖'],
  'badge.reset': ['reset', '重置'],
  'invalid.fallback': ['Invalid value', '取值不合法'],
  'mcp.asking.title': ['Is the Tavily MCP server already configured?', '是否已经配置了 Tavily 的 MCP 服务器？'],
  'mcp.asking.yes': ['Yes, configured', '是，已配置'],
  'mcp.asking.no': ['No, not yet', '否，未配置'],
  'mcp.guide.title': [
    'No Tavily MCP server yet. Paste this into ~/.dsh/profiles/web/cordis.patch.yml and restart DSH:',
    '尚未配置 Tavily MCP 服务器。将以下配置粘贴到 ~/.dsh/profiles/web/cordis.patch.yml,然后重启 DSH:',
  ],
  'mcp.guide.copy': ['Copy config', '复制配置'],
  'mcp.guide.copied': ['Copied', '已复制'],
  'mcp.guide.copyFailed': ['Copy failed — select manually', '复制失败,请手动选择'],
  'mcp.guide.back': ['Back', '返回'],
  'mcp.guide.note': [
    'After pasting and restarting, the model sees {tools}; once this switch is saved, web_search hands off to MCP search and spends no REST credits.',
    '粘贴并重启后,模型会看到 {tools} 工具;本开关保存后,web_search 将让位给 MCP 搜索且不消耗 REST 配额。',
  ],
  // The one translated part of the patch snippet: the rest is verbatim YAML the
  // user pastes, and the README carries the same snippet for the Chinese reader.
  'mcp.guide.snippetPlaceholder': [
    'paste your key here — see ~/.dsh/.credentials.yaml',
    '把你的 key 粘到这里 — 见 ~/.dsh/.credentials.yaml',
  ],
  // The empty value of a control: an unset number input and the select option
  // whose value `''` means "inherit the layer below".
  'field.unset': ['(not set)', '(未设置)'],
  'field.baseURL.label': ['Endpoint', '接口地址'],
  'field.baseURL.hint': [
    'Defaults to https://api.tavily.com; /search is appended by the plugin.',
    '默认 https://api.tavily.com,/search 由插件自动追加。',
  ],
  'field.maxResults.label': ['Max results per search', '每次搜索最多结果数'],
  'field.maxResults.hint': [
    'Upper bound on results Tavily returns per search (1–20); default 7.',
    'Tavily 每次搜索返回的结果数上限(1–20),默认 7。',
  ],
  'field.maxResults.invalid': ['Must be an integer from 1 to 20', '必须是 1–20 的整数'],
  'field.searchDepth.label': ['Search depth', '搜索深度'],
  'field.searchDepth.hint': [
    'basic/fast/ultra-fast cost 1 credit, advanced costs 2.',
    'basic/fast/ultra-fast 计 1 credit,advanced 计 2 credits。',
  ],
  'field.topic.label': ['Topic', '主题类别'],
  'field.topic.hint': [
    'news favours fresh headlines, general is broad search, finance covers market data.',
    'news 偏向实时新闻;general 为通用搜索;finance 为财经数据。',
  ],
  'field.timeRange.label': ['Time range', '时间范围'],
  'field.timeRange.hint': [
    'Tavily\'s current time-window form; it wins over "days back".',
    'Tavily 较新的时间窗形式(优先于「回溯天数」)。',
  ],
  'field.days.label': ['Days back', '回溯天数'],
  'field.days.hint': [
    'Only effective with topic=news; 0 means no window (legacy field — prefer Time range).',
    '仅 topic=news 时生效;0 表示不限时间窗(旧版字段,建议改用「时间范围」)。',
  ],
  'field.days.invalid': ['Must be an integer ≥ 0', '必须是 ≥ 0 的整数'],
  'field.startDate.label': ['Start date', '起始日期'],
  'field.startDate.hint': [
    'Only results published/updated after this date, formatted YYYY-MM-DD.',
    '仅返回该日期之后发布/更新的结果,格式 YYYY-MM-DD。',
  ],
  'field.startDate.invalid': ['Must be a real date in YYYY-MM-DD form', '必须是 YYYY-MM-DD 形式的合法日期'],
  'field.endDate.label': ['End date', '截止日期'],
  'field.endDate.hint': [
    'Only results published/updated before this date, formatted YYYY-MM-DD.',
    '仅返回该日期之前发布/更新的结果,格式 YYYY-MM-DD。',
  ],
  'field.endDate.invalid': ['Must be a real date in YYYY-MM-DD form', '必须是 YYYY-MM-DD 形式的合法日期'],
  'field.chunksPerSource.label': ['Chunks per source', '每源内容块数'],
  'field.chunksPerSource.hint': [
    'Content fragments returned per source (1–3); controls the content length.',
    '每个来源返回的内容片段数(1–3),控制 content 长度。',
  ],
  'field.chunksPerSource.invalid': ['Must be an integer from 1 to 3', '必须是 1–3 的整数'],
  'field.snippetMaxChars.label': ['Snippet cap', '单条摘录上限'],
  'field.snippetMaxChars.hint': [
    'Character cap per source body, ellipsis included; default 600. This is the gate on context use.',
    '每个来源正文的字符上限(含末尾省略号),默认 600;这是控制上下文占用的闸门。',
  ],
  'field.snippetMaxChars.invalid': ['Must be an integer ≥ 16', '必须是 ≥ 16 的整数'],
  'field.includeDomains.label': ['Include domains', '包含域名'],
  'field.includeDomains.hint': [
    'Comma separated; restrict results to these domains (up to 300).',
    '逗号分隔,结果仅限定这些域名(最多 300 个)。',
  ],
  'field.excludeDomains.label': ['Exclude domains', '排除域名'],
  'field.excludeDomains.hint': [
    'Comma separated; drop results from these domains (up to 150).',
    '逗号分隔,从结果中排除这些域名(最多 150 个)。',
  ],
  'field.useMcp.label': ['Use the Tavily MCP server', '使用 Tavily MCP 服务器'],
  'field.useMcp.hint': [
    'web_search hands off to {tool} and friends once on (configure the MCP server first — the switch shows a snippet).',
    '开启后 web_search 让位给 {tool} 等 MCP 工具(需先配置 MCP 服务器,开关下方会给配置片段)。',
  ],
} as const

/** Every copy key, with its English and Simplified Chinese text. */
export type CopyKey = keyof typeof keys

/** English copy table (the Client locale service takes a flat key → text map). */
export const en: Record<string, string> = Object.fromEntries(
  Object.entries(keys).map(([key, pair]) => [key, pair[0]]),
)

/** Simplified Chinese copy table. */
export const zh: Record<string, string> = Object.fromEntries(
  Object.entries(keys).map(([key, pair]) => [key, pair[1]]),
)
