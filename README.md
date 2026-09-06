<div align="center">

# dsh-tavily-search-plugin

**把 [Tavily](https://tavily.com) 接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 `web_search` 工具 —— 开箱即用、双面架构、完全外部插件。**

Wires [Tavily](https://tavily.com) into DeepSeek Harness's `web_search` tool as a drop-in `searchProvider`. Out-of-tree, dual-face Cordis plugin with a settings card.

</div>

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![DSH ≥ 0.1.0-rc.8](https://img.shields.io/badge/DSH-%E2%89%A5%200.1.0--rc.8-blueviolet)](https://github.com/deepseek-ai/deepseek-harness)
[![Node ≥ 20](https://img.shields.io/badge/Node-%E2%89%A5%2020-339933)](https://nodejs.org)
[![Tavily API](https://img.shields.io/badge/Tavily-API-FF6B35)](https://tavily.com)

</div>

---

## 这是什么 / What is this

DeepSeek Harness 自带的 `web_search` 工具默认走 DeepSeek 自己的搜索后端。**本插件把后端换成 [Tavily](https://tavily.com)** —— 一个给 AI agent 设计、支持 `include_answer` 自然语言总结、有免费额度、按搜索次数计费的搜索 API。

实现路径:写一个 Cordis 插件,向 `ctx.web.registerSearchProvider(...)` 注册 `TavilySearchProvider`;同时在浏览器半里向「设置 → 插件」页面贡献一张可编辑卡片,免去手动改 YAML。**全程不修改 DeepSeek Harness 任何源码**。

| 对比项 | 内置 DeepSeek 搜索 | 本插件 (Tavily) |
|--------|-------------------|-----------------|
| 计费 | DeepSeek 自己的搜索 API,具体计费策略按 DSH 文档 | 免费额度 1000 次/月;超出 $0.008/次 |
| `content` 总结 | 无(只返回链接) | ✓ `include_answer` 直接给模型一段自然语言段落 |
| 时间过滤 | 无 | ✓ `timeRange` / `startDate` / `endDate` 可按需限定时间窗(默认不限) |
| 离线/自托管 | 不支持 | ✓ 改 `baseURL` 即可指向自有 Tavily 兼容服务 |
| 配置入口 | DSH 内置 YAML | DSH 内置 YAML **或** UI 卡片 |

---

## 特性 / Features

- ✅ **完全外部插件**:`dsh.bundle.patch` 字段让 DSH 的 loader 识别本包,无需把插件塞进 DSH 单仓,也无需 PR。
- ✅ **双面架构 (dual-face)**:`host` 半(`src/index.ts`)注册搜索 provider + 安装 settings 命名空间;`client` 半(`src/client/`)在浏览器加载后注入配置卡片。
- ✅ **自带配置卡片**:与 DSH 自带的「Agent Loop / Bash / Web Search」卡片并列,3 行输入(`API key` / 接口地址 / 每次搜索最多结果数),保存后即时生效,无需重启。
- ✅ **三种 API Key 来源**(优先级递减):
  1. `cordis.patch.yml` 字面量
  2. 启动环境变量 `TAVILY_API_KEY`
  3. UI 卡片运行时写入
- ✅ **默认通用搜索**:`topic: 'general'` + `searchDepth: 'advanced'` 让技术/长尾查询返回高相关 snippet;要实时新闻就在卡片里把主题切成 `news` 并设时间范围。
- ✅ **默认 7 条结果**,UI 可覆盖;插件层做 `Math.min(requested, maxResults)` 硬封顶,防 Tavily 配额被滥用。
- ✅ **完整错误映射**:HTTP 错误 → `WEB_PROVIDER_ERROR`、abort → `WEB_ABORTED`、未配置 → `WEB_PROVIDER_CONFIGURED_MISSING` / `_UNAVAILABLE`,沿用 DSH 的 `WebError` 类型。
- ✅ **可逆**:卸载后 DSH 完全恢复(详见 §卸载)。

---

## 演示 / Demo

发到 DSH 聊天界面里的 prompt:

> 搜索 `DeepSeek Harness 的 web_search 怎么接 Tavily`(通用技术查询,默认配置)

实际打到 Tavily 的请求:

```http
POST https://api.tavily.com/search
Authorization: Bearer tvly-XXXXXXXXXXXX
Content-Type: application/json

{
  "query": "DeepSeek Harness 的 web_search 怎么接 Tavily",
  "topic": "general",
  "search_depth": "advanced",
  "max_results": 7,
  "chunks_per_source": 1,
  "include_answer": true,
  "include_raw_content": false,
  "include_images": false
}
```

返回(节选):

```jsonc
{
  "answer": "To wire web_search to Tavily, register a WebSearchProvider …",
  "results": [
    { "url": "https://deepseek-harness.github.io/...", "title": "web seam reference",      "content": "…" },
    { "url": "https://github.com/.../dsh-web-search-*", "title": "official provider example", "content": "…" },
    { "url": "https://docs.tavily.com/...",              "title": "Tavily Search API",       "content": "…" }
  ]
}
```

结果高度相关、无新闻混入,因为默认已是 `topic: 'general'` + `search_depth: 'advanced'` + `chunks_per_source: 1`。要搜**实时新闻**时,在卡片里把「主题类别」切成 `news`、设置「时间范围」,`topic`/`timeRange` 会据此在请求体里带上 `topic: "news"` 和 `time_range`。

---

## 目录 / Table of Contents

- [快速开始 / Quick Start](#快速开始--quick-start)
- [官方推荐安装 / Official install (DSH ≥ 0.1.1)](#官方推荐安装--official-install-dsh--0111)
- [安装流程 / Installation](#安装流程--installation)
  - [0. 前置条件](#0-前置条件--prerequisites)
  - [1. 安装插件](#1-安装插件--install-the-plugin)
  - [2. 提供 Tavily API Key](#2-提供-tavily-api-key--supply-the-tavily-api-key)
  - [3. 重启 Harness](#3-重启-harness--restart-the-harness)
- [验证安装](#验证安装--verify-the-install)
- [配置项](#配置项--configuration)
- [进阶用法](#进阶用法--advanced-usage)
- [工作原理](#工作原理--how-it-works)
- [常见问题 FAQ](#常见问题--faq)
- [故障排查](#故障排查--troubleshooting)
- [卸载](#卸载--uninstall)
- [开发与本地构建](#开发与本地构建--development)
  - [构建注意事项 / Build caveats](#构建注意事项--build-caveats)
- [兼容性矩阵](#兼容性矩阵--compatibility)
- [已知限制](#已知限制--known-limitations)
- [License](#license)

---

## 官方推荐安装 / Official install (DSH ≥ 0.1.1)

> **DSH 0.1.1+ 的现代 loader 会自动把 bundle 自带的 `cordis.patch.yml` 合入 profile** —— 不需要手动编辑 `~/.dsh/profiles/web/cordis.patch.yml`。这是当前推荐路径,与 [develop/basic](https://deepseek-harness.github.io/deepseek-harness/develop/basic/) 文档一致。DSH < 0.1.1 没有 `dsh.profile.bundles` 入口,回到 [§ 安装流程 / Installation](#安装流程--installation) 的手动 patch 合并方式。

两步:把插件装进 profile + 在 profile 的 `package.json` 里把它登记成 bundle。

### A. 安装到 profile

```bash
cd ~/.dsh/profiles/web

# 方式 1 — 从 GitHub(发布后)
pnpm add --save github:<your-org>/dsh-tavily-search-plugin

# 方式 2 — 本地开发,link: 软链(改源码即时生效,只需重启 DSH)
pnpm add --save "link:/absolute/path/to/dsh-tavily-search-plugin"

# 方式 3 — 本地开发,file: 复制(不推荐;见故障排查)
pnpm add --save "file:/absolute/path/to/dsh-tavily-search-plugin"
```

### B. 登记成 bundle

打开 `~/.dsh/profiles/web/package.json`,在 `dsh.profile.bundles` 数组末尾追加插件名:

```jsonc
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-tavily-search-plugin"   // ← 追加这一行
      ]
    }
  },
  "dependencies": {
    "dsh-tavily-search-plugin": "link:/absolute/path/to/dsh-tavily-search-plugin"
  }
}
```

> **为什么 `pnpm add` 之后还要登记?** loader 只扫描 `dsh.profile.bundles` 里列出的包 —— 仅靠 `dependencies` 字段不会触发加载,因为 node-half 的 `require.resolve('${name}/package.json')` 找不到 `dsh.bundle.patch`。这是单仓内 bundle 之外的「外部插件」必须走的一步,详见 [FAQ § `dsh.bundle.patch` 字段](#qdshbundlepatch-字段不是会让-cordispatchyml-自动合入吗) 与 [故障排查 § 搜索走了 DeepSeek 而不是 Tavily](#搜索走了-deepseek-而不是-tavily)。

### C. 验证 loader 已注册

DSH 启动时 `prepareProfile(...)` 会按顺序合入 `bundles` 数组里每个包的 `cordis.patch.yml`。三种方法(任选其一即可确认接通):

1. **看 `__DSH_BOOT__` 全局变量** —— 浏览器打开 DSH web,DevTools Console:
   ```js
   __DSH_BOOT__
   // entries[] 里应当出现:
   // { id: "dsh-tavily-search-plugin",
   //   url: "/plugins/dsh-tavily-search-plugin/client.js?rev=<hash>",
   //   rev: "<hash>", inject: ["slots"] }
   ```

2. **直接 GET client bundle**(HTTP 状态码即可):
   ```bash
   curl -fsS -o /dev/null -w "%{http_code}\n" \
     'http://127.0.0.1:3080/plugins/dsh-tavily-search-plugin/client.js'
   # 期望: 200
   ```

3. **CLI 导出合并后的 cordis 配置**:
   ```bash
   node apps/cli/lib/bin.js --profile web --dump-default-config
   ```
   输出里应看到 `# == dsh-tavily-search-plugin` 注释段,以及 `- id: web-search-tavily / name: dsh-tavily-search-plugin` 与 `- id: web config.searchProvider: tavily` 两段 patch 已合入。

### D. 配置 API Key + 重启

参见 [快速开始 §2 / §3](#快速开始--quick-start) 的环境变量 / UI 卡片 / 重启步骤。

---

## 快速开始 / Quick Start

> 假设你已经装好 DeepSeek Harness 并能 `pnpm dsh web` 起来。只需要 3 步:

```bash
# 1) 安装插件(从 GitHub 仓库)
cd ~/.dsh/profiles/web
pnpm add --save github:<your-org>/dsh-tavily-search-plugin
```

```bash
# 2) 把 cordis.patch.yml 内容合入 profile
#    编辑 ~/.dsh/profiles/web/cordis.patch.yml,追加:
cat >> ~/.dsh/profiles/web/cordis.patch.yml <<'YAML'
- insert:
    - id: web-search-tavily
      name: dsh-tavily-search-plugin
- id: web
  config:
    searchProvider: tavily
YAML
```

```bash
# 3) 配置 API Key(任选一种)
export TAVILY_API_KEY=tvly-XXXXXXXXXXXXXXXXXXXXXX   # 环境变量(推荐)
# 或在 DSH UI「设置 → 插件 → Tavily」卡片里直接输入并保存

# 4) 重启 DSH
pnpm dsh web
```

打开 DSH 聊天界面发:`今天的国际新闻有哪些?` —— 如果 Tavily 后台消耗 +1,就是装好了。

**没装好?** 跳到 [故障排查](#故障排查--troubleshooting)。

---

## 安装流程 / Installation

### 0. 前置条件 / Prerequisites

| 项目 | 要求 |
|------|------|
| DeepSeek Harness | ≥ 0.1.0-rc.8(更早的 0.1.0-rc.5 ~ rc.7 需要手动加 settings 白名单,见 [故障排查](#启动时报-web_settings_namespaces-not-found)) |
| Node.js | ≥ 20 |
| pnpm | ≥ 9 |
| Tavily 账号 + API Key | 注册 [tavily.com](https://tavily.com/),免费层 1000 次/月,控制台拿 `tvly-...` 形式的 key |

### 1. 安装插件 / Install the plugin

三种方式任选:

#### 方式 A — 从 GitHub 安装(推荐 / Recommended)

发布到 GitHub 后:

```bash
cd ~/.dsh/profiles/web
pnpm add --save github:<your-org>/dsh-tavily-search-plugin
```

`pnpm add` 会把插件解压到 `~/.dsh/profiles/web/node_modules/dsh-tavily-search-plugin/`。

#### 方式 B — 从本地目录安装(开发 / Dev install)

```bash
cd ~/.dsh/profiles/web
pnpm add --save "file:/absolute/path/to/dsh-tavily-search-plugin"
# 或 pnpm add --save "link:/absolute/path/to/dsh-tavily-search-plugin"  # 软链,改源码即生效
```

> ⚠️ **`file:` 会复制,`link:` 是软链。** 开发期间务必用 `link:`,否则你改了源码 + rebuild,但 `~/.dsh/profiles/web/node_modules/...` 还是旧版本。详见 [故障排查](#node-模块解析陷阱file-复制-vs-link-软链)。

#### 方式 C — 手动放入 node_modules(无网络环境)

```bash
git clone https://github.com/<your-org>/dsh-tavily-search-plugin
cd dsh-tavily-search-plugin
pnpm install
pnpm build
mkdir -p ~/.dsh/profiles/web/node_modules/dsh-tavily-search-plugin
cp -r lib cordis.patch.yml package.json \
      ~/.dsh/profiles/web/node_modules/dsh-tavily-search-plugin/
```

#### 合并 cordis.patch.yml(仅 DSH < 0.1.1 需要)

DSH ≥ 0.1.1 的现代 loader 会自动把 `cordis.patch.yml` 合入 profile,见 [§ 官方推荐安装](#官方推荐安装--official-install-dsh--0111);**这段手动合并步骤只在 DSH < 0.1.1 适用**。

`dsh.bundle.patch` 字段仅在 `dsh.profile.bundles` 没列出来时不被 loader 读取。对于 DSH < 0.1.1(无 `dsh.profile.bundles`),需要手动把本插件的 patch 内容追加到:

```
~/.dsh/profiles/web/cordis.patch.yml
```

追加内容:

```yaml
- insert:
    - id: web-search-tavily
      name: dsh-tavily-search-plugin
- id: web
  config:
    searchProvider: tavily
```

**这两条必须都有**:
- `- insert:` 把插件挂上 cordis loader(没有这一条,host 半根本不会执行)。
- `- id: web config.searchProvider: tavily` 把 web seam 切到本 provider(没有这一条,DSH 会抛 `WEB_PROVIDER_AMBIGUOUS`,因为它不做静默回退)。

### 2. 提供 Tavily API Key / Supply the Tavily API Key

三种方式任选,优先级递减:

#### A. 启动环境变量(推荐)

```bash
export TAVILY_API_KEY=tvly-XXXXXXXXXXXXXXXXXXXXXX
pnpm dsh web
```

DSH 启动时把这个变量注入 launch environment,插件通过 `launchEnvironmentOf(ctx).get('TAVILY_API_KEY')` 读取。

#### B. `cordis.patch.yml` 字面量

```yaml
- id: web-search-tavily
  config:
    apiKey: tvly-XXXXXXXXXXXXXXXXXXXXXX
```

`apiKey` 字段标了 `.role('secret')`,DSH 设置服务不会把它回传到前端响应里。**但会落到 git 历史**,生产环境慎用。

#### C. UI 卡片运行时写入

启动后,打开「设置 → 插件」,展开 Tavily 卡片,在 `API key` 那一栏输入新值并保存 —— 立即对下一次搜索生效,无需重启。

### 3. 重启 Harness / Restart the Harness

```bash
# 杀掉旧的 dsh web 进程,然后:
pnpm dsh web
```

> **关于 HMR**:`cordis.yml` / `package.json` 的修改不会通过 Vite HMR 自动应用 —— loader 是冷启动逻辑,必须重启。
>
> **而** UI 上编辑 `maxResults` / `baseURL` 等运行时配置,会在下一次 `web_search` 调用时立刻生效 —— provider 内部用 thunk 每次重新解析当前 section。

---

## 验证安装 / Verify the install

### 三条铁证(任一即说明接通了)

| # | 检查 | 怎么确认 |
|---|------|----------|
| 1 | **Tavily 后台消耗 +1** | 打开 [Tavily Dashboard](https://app.tavily.com/) → Usage,跑一次搜索后看计数 |
| 2 | **DevTools Network** | 看到 `POST https://api.tavily.com/search`,Authorization 是 `Bearer tvly-...` |
| 3 | **返回里有 `answer` 段落** | 这是 Tavily `include_answer` 的特性,内置 DeepSeek 搜索不带这种自然语言总结 |

### 数量上限

返回结果数 ≤ `maxResults`(默认 7)。把卡片里改到 10,下一次搜索就拿 10 条以内。

### 时间新鲜度

默认**不限时间窗**(`topic: 'general'` + `days: 0`),任意时间的页面都会进。要限定时效,在卡片里设置「时间范围」或「回溯天数」。

### UI 卡片验证

打开「设置 → 插件」,应当看到一张新的 **Tavily** 卡片,与内置的 `Agent Loop` / `Bash` / `Web Search` 并列。点开后:

```
┌─ Tavily ───────────────────────────────────────┐
│ Tavily 搜索提供方。                              │
│                                       ▼         │
├─────────────────────────────────────────────────┤
│ [API key      ]  ●●●●●●●●●●       [已配置]       │
│ 写入后仅存于 DSH 凭证域,不会随 settings 文档回传。 │
│                                                 │
│ [接口地址                                      ] │
│ [ https://api.tavily.com                       ] │
│ 默认 https://api.tavily.com,/search 由插件自动追加。│
│                                                 │
│ [每次搜索最多结果数                            ] │
│ [ 7                                            ] │
│ Tavily 每次搜索返回的结果数上限,默认 7。          │
│                                                 │
│                       [放弃]  [保存]              │
└─────────────────────────────────────────────────┘
```

---

## 配置项 / Configuration

### 完整字段表

| 字段 / Field | 类型 / Type | 默认 / Default | 说明 / Notes |
|--------------|-------------|----------------|--------------|
| `apiKey` | string | _(空)_ | 直接字面量,标 `.role('secret')`。**不要**写进 git。卡片可写。 |
| `apiKeyEnv` | string | `TAVILY_API_KEY` | 凭证引用名。卡片通过「API key」输入框编辑(固定 `TAVILY_API_KEY`)。 |
| `baseURL` | string | `https://api.tavily.com` | 端点。末尾的 `/search` 由插件自动追加,**不要带尾斜杠**。卡片可写。 |
| `maxResults` | number | `7` | 单次最多返回的搜索结果数(1–20,上限为 Tavily API 硬限制)。插件层硬封顶。卡片可写。 |
| `searchDepth` | `'basic'`\|`'advanced'`\|`'fast'`\|`'ultra-fast'` | `'advanced'` | Tavily 搜索深度。`advanced` 计 2 credit,其余计 1 credit。卡片可写(下拉)。 |
| `topic` | `'general'`\|`'news'`\|`'finance'` | `'general'` | Tavily 主题类别。`'general'` 通用/技术查询,`'news'` 实时新闻,`'finance'` 财经数据。卡片可写(下拉)。 |
| `days` | number | `0` | 仅返回最近 N 天的结果(`0` = 不限,默认)。仅 `topic: 'news'` 生效;**兼容旧配置的字段,`timeRange` 设置后优先**。卡片可写。 |
| `timeRange` | `'day'`\|`'week'`\|`'month'`\|`'year'`\|`'d'`\|`'w'`\|`'m'`\|`'y'` | _(空)_ | Tavily 现行时间窗形式。设置后优先于 `days`。卡片可写(下拉)。 |
| `startDate` | string | _(空)_ | 仅返回该日期(`YYYY-MM-DD`)之后发布/更新的结果。卡片可写。 |
| `endDate` | string | _(空)_ | 仅返回该日期(`YYYY-MM-DD`)之前发布/更新的结果。卡片可写。 |
| `includeDomains` | string[] | `[]` | 结果限定在这些域名(最多 300)。卡片可写(逗号分隔)。 |
| `excludeDomains` | string[] | `[]` | 从结果排除这些域名(最多 150)。卡片可写(逗号分隔)。 |
| `chunksPerSource` | number | `1` | 每个来源返回的内容块数(1–3,每块 ≤500 字符)。默认 `1` 让 snippet 更短更聚焦。卡片可写。 |
| `includeAnswer` | boolean | `true` | 让 Tavily 顺便返回一段自然语言 `answer`,模型能直接引用。**卡片未暴露,改用 `cordis.patch.yml`** |

### 三种注入方式(从高到低优先级)

1. **`cordis.patch.yml` / `cordis.yml` 的 `- id: web-search-tavily config:` 块** —— 冷启动生效
2. **启动环境变量 `TAVILY_API_KEY`** —— 冷启动生效,只覆盖 `apiKeyEnv`
3. **UI 卡片编辑** —— 运行时即时生效,无需重启

### 进阶示例:在 `cordis.patch.yml` 里覆盖所有字段

```yaml
- id: web-search-tavily
  config:
    apiKey: tvly-XXXXXXXXXXXXXXXXXXXXXX        # 仅限受控环境
    apiKeyEnv: MY_TAVILY_KEY                    # 用其他环境变量名
    baseURL: https://tavily-proxy.internal      # 自托管代理
    maxResults: 10
    searchDepth: advanced                       # basic|advanced|fast|ultra-fast
    topic: finance                              # general|news|finance
    timeRange: week                             # day|week|month|year;优先于 days
    # days: 0                                   # 旧版时间窗字段,timeRange 设置后忽略
    startDate: '2026-01-01'                     # 仅返回该日期之后
    endDate: '2026-12-31'                       # 仅返回该日期之前
    includeDomains: [news.site.org, example.com]
    excludeDomains: [spam.example]
    chunksPerSource: 2                          # 1–3
    includeAnswer: true
```

---

## 进阶用法 / Advanced Usage

### 自托管 Tavily 兼容代理

Tavily API 兼容 OpenAI function calling 风格,一些开源项目(比如 [tavily-mock](https://github.com))实现了兼容端点。把它指向你的代理:

```yaml
- id: web-search-tavily
  config:
    baseURL: http://localhost:8787
```

注意:插件硬编码了 `/search` 路径和 `Authorization: Bearer` 头,所以代理必须遵循 Tavily 的 `/search` endpoint 契约。

### 调试:看 Tavily 实际收到的请求

```bash
# 1. 启动 DSH(默认日志输出)
pnpm dsh web

# 2. 浏览器打开 DSH,DevTools → Network,过滤器打 "tavily"

# 3. 触发一次搜索,点开请求看:
#    Payload:
#    {
#      "query": "...",
#      "topic": "general",
#      "search_depth": "advanced",
#      "max_results": 7,
#      "chunks_per_source": 1,
#      "include_answer": true,
#      "include_raw_content": false,
#      "include_images": false
#    }
```

### 切换回 DeepSeek 自带搜索

把 `cordis.patch.yml` 里 `- id: web config.searchProvider: tavily` 改成 `searchProvider: deepseek`(或 DSH 默认的 id),然后重启。**插件本身不需要卸**,它会继续注册但不被选中。

完全卸载见 [卸载](#卸载--uninstall)。

---

## 工作原理 / How it works

### 整体架构

```
                    ┌─────────────────────────────────────────┐
                    │          DeepSeek Harness               │
                    │                                         │
   DSH chat  ─────► │   web_search tool                       │
                    │      └─► ctx.web.search()               │
                    │             └─► resolveProvider()       │
                    │                    ├─ DeepSeek (内置)     │
   install  ──────► │                    └─ Tavily ◄──────────┼──── ┌──────────────────┐
                    │                         (本插件)         │     │ dsh-tavily-      │
                    │                              │           │     │  search-plugin   │
                    │                              ▼           │     │                  │
                    │                     TavilySearchProvider │     │  src/index.ts    │
                    │                         .search()        │     │   │              │
                    │                              │           │     │   ├─ register   │
                    │                              ▼           │     │   │  provider   │
                    │                     POST api.tavily.com  │     │   │              │
                    │                              │           │     │   └─ install   │
                    │                              │           │     │      settings   │
                    │                              ▼           │     │      section    │
                    │                     { results, answer } │     │                  │
                    │                              │           │     │  src/client/    │
                    │                              ▼           │     │   │              │
                    │              ┌─────────────┴────────┐    │     │   └─ inject    │
                    │              │                      │    │     │      settings   │
                    │              ▼                      ▼    │     │      card       │
                    │       模型引用 answer        模型选 links │     └──────────────────┘
                    └─────────────────────────────────────────┘
```

### 双面插件机制

DSH 0.1.0-rc.5+ 的插件系统允许一个 npm 包同时承担两种角色:

| 角色 | 入口 | 加载时机 | 作用 |
|------|------|----------|------|
| **Host 半** | `lib/index.js` 导出 `apply(ctx, config)` | DSH 服务端冷启动,`cordis loader` 加载 | 注册 provider、安装 settings namespace |
| **Client 半** | `lib/client.js` 通过 `window.__ModuleLoader__.load` 加载 | 浏览器渲染「插件」标签页前 | 向 `settings.plugin.item` 插槽注入 UI 卡片 |

两边通过 `settings` 服务通信:host 半用 `installSettingsSection(...)` 声明一个 namespace,client 半通过 `ctx.settingsScope.bind({namespace})` 读 / 写同一个 namespace。

### Host 半(`src/index.ts`)

```ts
export function apply(ctx: Context, config: TavilyConfig): void {
  let current: TavilyConfig = config

  // 把默认 maxResults=7 注入 base 层,这样新装插件的卡片打开就显示 7,不是空白
  const base: TavilyConfig = { maxResults: TAVILY_DEFAULT_MAX_RESULTS, ...config }

  // 装 settings 命名空间 → UI 卡片可以编辑它
  installSettingsSection(ctx, TAVILY_SETTINGS_NAMESPACE, Config, base, {
    setSource: (source) => { current = source },
    onChange: () => {},
  })

  // 注册 provider 到 web seam
  ctx.web.registerSearchProvider(
    new TavilySearchProvider(() => resolveOptions(ctx, current))
  )
}
```

每次 `web_search` 调用时:

1. **`Math.min(requested, options.maxResults)`** 做硬封顶 —— 工具层可以要求少,但不能超过配置上限。
2. **解析 API Key**(优先级:literal → credentials.resolve(env) → 环境变量)。
3. **POST 到 Tavily**:
   ```http
   POST {baseURL}/search
   Authorization: Bearer <key>
   {
     "query": request.query,
     "topic": options.topic,             // 'general'
     "search_depth": options.searchDepth, // 'advanced'
     "max_results": maxResults,          // 7
     "chunks_per_source": options.chunksPerSource, // 1
     "include_answer": options.includeAnswer, // true
     ...
   }
   ```
4. **解析响应**:`payload.answer` → `content`(模型引用的自然语言总结),`payload.results[]` → 标准化为 `{url, title, snippet}`,`snippet` 截断 600 字防污染上下文。
5. **错误映射**:HTTP 非 2xx → `WEB_PROVIDER_ERROR`,abort → `WEB_ABORTED`,未配 key → `WEB_PROVIDER_ERROR` with detail。

### Client 半(`src/client/`)

```ts
// src/client/index.ts
export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  injectStyles()                            // 注入主题化的 .dstav-* CSS
  registerConfigCard(ctx)                   // 注册卡片到 settings.plugin.item 插槽
}

// 关键:keyed slot 必须用 key: 不是 id:
ctx.slots.register(
  { name: 'settings.plugin.item', key: NAMESPACE, order: 30, label: NAMESPACE },
  () => React.createElement(ConfigCard, { form }),
)
```

`client.js` bundle 的构建特殊性:

- **externals 只有 `react`** —— 浏览器只需要 React 本身,其他都内联。
- **所有 `@deepseek-ai/*` 类型声明、React 组件依赖** 通过 `noExternal` 内联到 bundle。
- **CJS 输出 + `__ModuleLoader__.load` 握手协议** —— 顶层 banner 注入 `window.__ModuleLoader__.load({id, factory: (require) => {...}})`,factory 内调 `apply(ctx)`。
- **典型大小**:26 KB(gzip 8 KB)。

### 不修改 DSH 的关键

| 风险点 | 怎么避开的 |
|--------|-----------|
| `ui-settings-plugins` 内部组件变了 → 卡片崩 | 卡片 UI 是手写的最小复刻,**不 import** `@deepseek-ai/dsh-client-ui-settings-plugins` 任何模块 |
| 客户端 host API 变了 | 卡片只用 `ctx.settingsScope` 这个由 DSH 公共包暴露的服务;不依赖 DSH 内部 API |
| Vite manifest hash 变了 | client bundle 是独立 CJS,不走 Vite 解析 |
| DSH 重命名 / 移除 namespace | settings namespace 用插件名 + 命名空间前缀(`web-search-tavily`),DSH 0.1.0-rc.8+ 开放所有 namespace 到 UI |
| monorepo purity gate | client bundle 的所有 DSH 内部依赖全部 `noExternal` 内联,独立构建通过 |

---

## 常见问题 / FAQ

### Q:为什么不用内置的 DeepSeek 搜索?
A:Tavily 有三件事是 DeepSeek 自带搜索做不到的:
1. **`include_answer`** —— Tavily 直接给模型一段自然语言总结,不用模型自己再读 7 个网页拼接。
2. **时间过滤** —— `timeRange` / `startDate` / `endDate` 可按需限定时间窗;默认不限,搜技术资料不会被"最近 7 天"误过滤。
3. **成本可控** —— 免费层 1000 次/月,适合日常开发;超出按 $0.008/次,可预测。

### Q:能用其他搜索服务(Exa / SerpAPI / Brave)吗?
A:可以,照着 `src/index.ts` 写一个新的 `XxxSearchProvider` 注册到 `ctx.web.registerSearchProvider(...)` 即可。`id` 不要和 `tavily` 撞就行。本仓库专注于 Tavily,不做多后端。

### Q:卡片和 DSH 内置的 WebSearchCard 长一样吗?
A:基本字段(API key + endpoint + 结果上限)与内置卡片一致;在此之上新增了下拉/输入项覆盖 Tavily 的完整可调面:`searchDepth` / `topic` / `timeRange` / `days` / `startDate` / `endDate` / `chunksPerSource` / `includeDomains` / `excludeDomains`。唯一未暴露的是 `includeAnswer`(保持 YAML-only),要关掉自然语言总结就在 `cordis.patch.yml` 写 `includeAnswer: false`。

### Q:DSH 升级后卡片会不会消失?
A:不会。本插件的所有 UI 代码都自己带,不依赖 DSH `ui-settings-plugins` 包内部的组件。DSH 升级只要不破坏 `@deepseek-ai/cordis` 的 `ctx.slots` 接口,卡片就还在。

### Q:`dsh.bundle.patch` 字段不是会让 cordis.patch.yml 自动合入吗?
A:**DSH ≥ 0.1.1 会**,只要插件名出现在 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 数组里 —— `prepareProfile(...)` 会按顺序读取每个 bundle 的 `cordis.patch.yml` 并合入 profile 的 `cordis.yml`。所以官方推荐路径是 [§ 官方推荐安装](#官方推荐安装--official-install-dsh--0111),不需要手动 patch 合并。

**DSH < 0.1.1 不会自动合入** —— 那时还没有 `dsh.profile.bundles`,外部插件通过 `pnpm add` 装进 profile 后,DSH 不会读插件自带的 `cordis.patch.yml`,必须手动把 patch 内容追加到 `~/.dsh/profiles/web/cordis.patch.yml`。这是已知 footgun,见 [§ 安装流程 / Installation](#安装流程--installation) 与 [故障排查](#搜索走了-deepseek-而不是-tavily)。

### Q:可以用本插件的 host 半但用自己写的 UI 卡片吗?
A:可以,host 半 (`src/index.ts` → `lib/index.js`) 完全独立。`installSettingsSection` 安装的 `web-search-tavily` namespace 是公共的,任何 client 半插件都可以 `ctx.settingsScope.bind({namespace: 'web-search-tavily'})` 读取并编辑它。

### Q:`maxResults` 卡片写 10,Tavily 会扣几次配额?
A:**一次**。`max_results` 是单次请求里的结果数,Tavily 按 **search 调用次数**计费,不是按返回的结果数。所以 `maxResults: 20` 和 `maxResults: 3` 在配额消耗上没区别。

---

## 故障排查 / Troubleshooting

### 卡片没有出现在「插件」页

按顺序检查:

1. **包是否真的装上了**?
   ```bash
   cat ~/.dsh/profiles/web/package.json | grep dsh-tavily-search-plugin
   # 应该看到 "dsh-tavily-search-plugin": "..." 或 "link:..."
   ```

2. **`lib/` 构建产物是否存在**?
   ```bash
   ls ~/.dsh/profiles/web/node_modules/dsh-tavily-search-plugin/lib/
   # 应该看到 index.js + client.js + index.d.ts
   # 如果只有 src/ 没有 lib/,说明安装时没跑 prepare 钩子
   ```
   修法:
   ```bash
   cd dsh-tavily-search-plugin && pnpm build
   cp -r lib/ ~/.dsh/profiles/web/node_modules/dsh-tavily-search-plugin/
   ```

3. **Node 模块解析陷阱:`file:` 复制 vs `link:` 软链**
   - **症状**: `pnpm dsh web` 启动不报错,Tavily 后台有消耗,但「设置 → 插件」里没有 Tavily 卡片。
   - **原因**: `pnpm add file:/path` 把包**复制**到 `web/node_modules/...`;你后续修改源码 + rebuild,副本不会同步 —— 包括 `package.json` 的 `dsh.client` 字段(老副本没有这个字段,导致 client 半被跳过)。
   - **修法 1(开发期推荐)**:用 `link:` 创建软链:
     ```bash
     dsh plugin --profile web remove dsh-tavily-search-plugin
     cd ~/.dsh/profiles/web
     pnpm add --save "link:/absolute/path/to/dsh-tavily-search-plugin"
     ```
   - **修法 2(临时绕过)**:删掉 web/node_modules 副本,让 Node 走 fallback symlink:
     ```bash
     rm -rf ~/.dsh/profiles/web/node_modules/dsh-tavily-search-plugin
     ```
     (每次 `pnpm install` 都会复发。)

4. **`dsh.client` 字段**:插件的 `package.json` 必须有:
   ```json
   "dsh": {
     "client": { "platform": "web", "inject": ["slots"] }
   }
   ```
   老版本(0.1.x)的副本没有这个字段,会跳过 client 加载。

### 启动时报 `WEB_SETTINGS_NAMESPACES not found` / namespace 被隐藏

- **DSH ≥ 0.1.0-rc.8** 已经开放所有 settings namespace 到 UI,**不需要**任何 host 端修改。
- **DSH 0.1.0-rc.5 ~ 0.1.0-rc.7** 仍然有 `WEB_SETTINGS_NAMESPACES` 白名单。你需要在 DSH 仓库的 `packages/host/apiproxy/src/api-proxy.ts` 里:
  ```ts
  const WEB_SETTINGS_NAMESPACES = [
    'agent-loop', 'shell', 'locale', 'permission', 'ui-conversation', 'ui-theme', 'web-search-deepseek',
    'web-search-tavily',  // ← 加上这一行
  ] as const
  ```
  改完后重建 host 包并重启 DSH:
  ```bash
  pnpm --filter @deepseek-ai/dsh-host-apiproxy build
  pnpm dsh web
  ```

### 启动时报 `keyed slot "settings.plugin.item" requires options.key`

`settings.plugin.item` 是 `kind: 'keyed'` 的插槽(slot 定义在 `packages/client/ui-settings-plugins/src/client/slot-contract.ts`),`ctx.slots.register(...)` **必须**带 `key:` 字段(namespace 字符串),**不能**用 `id:`。

正确写法:
```ts
ctx.slots.register(
  { name: 'settings.plugin.item', key: 'web-search-tavily', order: 30 },
  ConfigCard,
)
```

错误写法:
```ts
ctx.slots.register(
  { name: 'settings.plugin.item', id: 'web-search-tavily', order: 30 },
  ConfigCard,
)
// 启动错误: keyed slot "settings.plugin.item" requires options.key
```

参考 `packages/client/ui-settings-plugins/src/client/index.ts:146` 的官方注册方式。

### 搜索走了 DeepSeek 而不是 Tavily

按顺序检查:

1. **`searchProvider` 真的设上了吗?**
   ```bash
   grep -A1 "searchProvider" ~/.dsh/profiles/web/cordis.yml
   # 应该看到 searchProvider: tavily
   ```
   如果是通过 `dsh plugin add` 或 `pnpm add` 装的外部插件,需要**手动**把本插件 `cordis.patch.yml` 的内容合入 —— 参见 §安装 / 合并 cordis.patch.yml。

2. **DevTools Network 看实际 URL**
   - 看到 `POST https://api.tavily.com/search` → 没问题
   - 看到 `https://api.deepseek.com/...` → 没切到 Tavily,回到第 1 步

3. **cordis patch 的 `config` 字段是整体替换**
   ```yaml
   - id: web
     config:                    # ← 整体替换,不要在已有的 web 节点下追加
       searchProvider: tavily
   ```
   如果 DSH 默认 `web` 节点有别的字段(`apiBase` 等),会被一并清掉。需要保留的话,把它们的值一起写进来。

### 报错 `WEB_PROVIDER_CONFIGURED_MISSING`

插件没成功注册。检查:

```bash
pnpm ls --filter web dsh-tavily-search-plugin
# 应该能解析到一个版本号 + 路径

ls ~/.dsh/profiles/web/node_modules/dsh-tavily-search-plugin/lib/index.js
# 文件应当存在
```

如果是 symlink,把 symlink 替换成真实路径再确认。

### 报错 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`

插件注册了,但 `available()` 返回 false。最常见原因:

- **API Key 没配**(检查 env / UI / patch)。
- **`baseURL` 不是合法 URL** —— 比如写成了 `https://api.tavily.com/` 带尾斜杠,`/search` 会被拼成 `//search` 触发 Tavily 404。

### 报错 `Tavily API error (HTTP 401)`

API Key 不正确或已过期。在 [Tavily Dashboard](https://app.tavily.com/) 重新生成。

### 报错 `Tavily API error (HTTP 432)` / 其他 4xx

`HTTP 432` 是 Tavily 的「超出配额」信号。免费层 1000 次/月到顶了,在 Dashboard 升级或等下个月。

### 改完 `cordis.yml` 后没生效

DSH 的 loader 只在启动时跑,必须**重启 harness**。`package.json` 改动也要 `pnpm install` 再重启。

### 改完 `lib/client.js` 后浏览器没更新

客户端 bundle 有 content-hash 缓存,需要硬刷新:

- macOS: `⌘ + Shift + R`
- Windows / Linux: `Ctrl + Shift + R`

开发期可以在 `~/.dsh/profiles/web/cordis.yml` 里把缓存关掉(DSH 的 `web.cache` 字段),或者改完直接 `rm -rf ~/.dsh/profiles/web/.cache`。

---

## 卸载 / Uninstall

```bash
# 1. 移除插件
dsh plugin --profile web remove dsh-tavily-search-plugin
# 或: pnpm remove --filter web dsh-tavily-search-plugin

# 2. 从 ~/.dsh/profiles/web/cordis.patch.yml 删掉手动合入的两段:
#    - insert:
#        - id: web-search-tavily
#          name: dsh-tavily-search-plugin
#    - id: web
#      config:
#        searchProvider: tavily

# 3. 重启 DSH
pnpm dsh web
```

DSH 会回到使用内置 DeepSeek 搜索的状态。**不会**留下任何残留。

---

## 开发与本地构建 / Development

### 仓库结构

```
dsh-tavily-search-plugin/
├── package.json             # 双面声明:exports["./client"], dsh.client, peer deps
├── cordis.patch.yml         # 用户 profile 需要手动合入的 patch
├── tsdown.config.ts         # 双构建:lib (ESM Node) + client (CJS 浏览器)
├── tsconfig.json            # 严格类型检查
├── src/
│   ├── index.ts             # ── HOST 半 ──
│   │                         #   apply(ctx, config) → ctx.web.registerSearchProvider(...)
│   │                         #              + installSettingsSection("web-search-tavily", ...)
│   └── client/              # ── CLIENT 半 ──
│       ├── index.ts         #   apply(ctx) → ctx.slots.inject("settings.plugin.item", ...)
│       ├── config-card.ts   #   卡片 UI(staged form + 字段编辑 + 保存/放弃)
│       ├── types.ts         #   ctx.slots / ctx.settingsScope 最小类型(声明合并到 cordis)
│       ├── constants.ts     #   NAMESPACE, DISPLAY_NAME
│       └── styles.ts        #   一次性 CSS 注入(主题变量)
└── lib/                     # 构建产物 (gitignored)
    ├── index.js             #   Cordis 加载器 import 的 host 半
    ├── index.d.ts           #   host 半的类型导出
    └── client.js            #   __ModuleLoader__.load 加载的 browser bundle
```

### 本地构建

```bash
# 1. 安装依赖
cd dsh-tavily-search-plugin
pnpm install

# 2. 类型检查 + 构建
pnpm typecheck
pnpm build       # 等价于 tsdown,产出 lib/index.js + lib/client.js

# 3. 装到 DSH profile(link: 软链,改源码即时生效,只需重启 DSH)
cd ~/.dsh/profiles/web
pnpm add --save "link:/absolute/path/to/dsh-tavily-search-plugin"

# 4. 合并 cordis.patch.yml(见 §安装 / 合并 cordis.patch.yml)

# 5. 重启 DSH
pnpm dsh web     # 在 DSH 仓库根目录
```

### 修改后的迭代流程

```bash
# 改 src/
vim src/index.ts        # 或 src/client/config-card.ts
pnpm build              # 重新构建

# 如果是 host 半改动 → 重启 DSH
# 如果只是 client 半改动 → 浏览器硬刷新就够了

# DSH 日志(排查问题用)
pnpm dsh web --verbose  # 或 --log-level=debug
```

### 构建注意事项 / Build caveats

踩过两次坑,记录下来省新人再走一遍:

- **`pnpm prepare` 会自动跑 `tsdown`** —— `package.json` 里 `"prepare": "tsdown"` 触发时机是 `pnpm install` / `pnpm add` 之后。所以从 GitHub 安装(方式 1)不需要手动 `pnpm build`,装完 `lib/` 就已经在包里了。本地开发时改完 `src/` 还是要手动 `pnpm build`。

- **TypeScript 5.4 不识别 `target: ES2024` / `lib: ['ES2024']`** —— `peerDependencies` 锁的是 `^5.4.0`,该版本只到 `ES2023` / `ESNext`。如果 `tsconfig.json` 写了 `ES2024`,TS 会**静默丢弃** lib 选项,导致 `tsdown` 的 dts 插件报:
  ```
  error TS4033: Property 'resolveApiKey' of exported interface has or is using
                private name 'Promise'.
  error TS4055: ...
  ```
  解决方式:**根 `tsconfig.json` 维持 `ES2024`/`DOM`(给 IDE 用),另起一个 `tsconfig.dts.json`** 只用于 dts emit:
  ```jsonc
  // tsconfig.dts.json
  {
    "extends": "./tsconfig.json",
    "compilerOptions": {
      "target": "ESNext",
      "module": "ESNext",
      "lib": ["ES2023", "DOM", "DOM.Iterable"],
      "noEmit": false
    }
  }
  ```
  然后在 `tsdown.config.ts` 里把 host 配置改成:
  ```ts
  dts: { tsconfig: './tsconfig.dts.json',
         compilerOptions: { target: 'ESNext',
                            lib: ['ES2023', 'DOM', 'DOM.Iterable'],
                            noEmit: false } }
  ```
  客户端 bundle 不走 dts emit(`dts: false`),不受这个坑影响。

- **典型产物大小**:host `lib/index.js` ~9.6 KB(host 半 + d.ts ~6.3 KB),client `lib/client.js` ~26 KB(gzip ~8 KB),全在 DSH `<plugins>` 静态服务允许范围内。

- **`@deepseek-ai/dsh-*` peer deps 标 `*`** —— 这意味着不锁版本,跟当前 DSH 一起发版就行。如果改用新 DSH 后 host 类型报错,先 `pnpm install` 让 pnpm 拉取 workspace 中最新的 DSH 包,再 `pnpm build`。

- **client bundle 的 external 只有 `react`** —— `noExternal` 把所有 `@deepseek-ai/*` 内联进 bundle,这是官方 `dsh-plugin-template` 的同款做法;浏览器模块表已经暴露 `react` + 4 个平台模块(`@deepseek-ai/cordis` 等),剩下的 inline 才能被独立构建而不走 Vite 解析。

### 发布到 GitHub

```bash
# 1. 在 GitHub 上创建空仓库(不要初始化 README)
#    https://github.com/new

# 2. 推上去
git init
git add .
git commit -m "feat: initial dual-face Tavily search plugin"
git branch -M main
git remote add origin git@github.com:<your-org>/dsh-tavily-search-plugin.git
git push -u origin main

# 3. 打 tag(可选)
git tag v0.2.0
git push --tags

# 4. 用户安装
pnpm add --save github:<your-org>/dsh-tavily-search-plugin
```

---

## 兼容性矩阵 / Compatibility

| DSH 版本 | 是否支持 | 备注 |
|----------|----------|------|
| 0.1.0-rc.5 ~ 0.1.0-rc.7 | ⚠️ 需要手动加 settings 白名单 | 见 [故障排查](#启动时报-web_settings_namespaces-not-found) |
| 0.1.0-rc.8 ~ rc.9 | ✅ 直接装 | 但需要显式设 `searchProvider: tavily` |
| ≥ 0.1.0-rc.10 | ✅ 直接装 | 本插件开箱即用 |
| ≥ 0.1.1 | ✅ 直接装 | `dsh.profile.bundles` 路径生效,`cordis.patch.yml` 由 loader 自动合入 —— 走 [§ 官方推荐安装](#官方推荐安装--official-install-dsh--0111) |
| Node ≥ 20 | ✅ | DSH 自身要求 |
| Node 18 | ❌ | DSH 已不支持 |
| Tavily API v1 | ✅ | 本插件用 `/search` endpoint,标准 v1 协议 |
| 自托管 Tavily 兼容服务 | ✅ | 改 `baseURL` 即可 |

### 已测试平台

| OS | Node | pnpm | DSH |
|----|------|------|-----|
| macOS 14 | 20.x | 9.x | 0.1.0-rc.10 |
| Ubuntu 22.04 | 20.x | 9.x | 0.1.0-rc.10 |
| Windows 11 | 20.x | 9.x | 0.1.0-rc.10 |
| Ubuntu 24.04 | 24.x | 11.x | **0.1.1-rc.2**(本次安装实测) |

---

## 已知限制 / Known limitations

- **`maxResults` 是插件层硬封顶**:即便 `web_search` 工具本身请求了更多结果,Tavily 也不会收到超过 `options.maxResults` 的 `max_results`。这是为了让免费额度可控;如果你想突破这个上限,直接修改 `src/index.ts` 的 `Math.min(...)` 行。
- **`includeAnswer` 不通过 UI 卡片暴露**:它仍是 host 半的合法 schema 字段(写进请求体的 `include_answer`),只是 UI 不渲染。要关掉自然语言总结,在 `cordis.patch.yml` 里写 `includeAnswer: false`。
- **`include_images` / `include_raw_content` 写死 `false`**:如需图片或原始 HTML,自行放开 `search()` 里的对应字段(同时考虑上下文窗口)。
- **没有重试逻辑**:HTTP 5xx 直接抛 `WEB_PROVIDER_ERROR`。DSH 上层会决定是否重试。
- **`cordis.yml` 是冷启动配置** —— HMR 不适用,改完必须重启。
- **`cordis.patch.yml` 字段是整体替换**,不要尝试在已有 `web:` 节点下追加。

---

## Roadmap / 路线图

- [ ] 多 provider 支持(允许用户同时启用 Tavily + Exa,按 query routing)
- [ ] 流式 answer(目前是单段返回)
- [ ] Per-query cost estimate(读 Tavily Dashboard 的配额 API)

---

## 致谢 / Credits

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —— `ctx.web` seam 设计
- [kun2-5code/dsh-plugin-template](https://github.com/kun2-5code/dsh-plugin-template) —— out-of-tree 插件架构范式
- [Tavily](https://tavily.com/) —— 搜索 API

---

## License

MIT — 同 DeepSeek Harness 主仓库。
