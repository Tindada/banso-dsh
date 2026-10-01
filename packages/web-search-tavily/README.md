# Tavily search provider

为 DSH 的 `ctx.web` 提供 Tavily 搜索，复用现有 `web_search`。本包只提供插件，由 `packages/banso` 中的统一 Banso bundle 加载并选用；网页获取继续使用 DSH 自带的 HTTP provider。

开发依赖对齐 DSH `0.2.0-rc.2`。用户已确认构建通过，并在本地 DSH 源码宿主中完成 profile 加载及真实搜索；尚未验证 npm CLI 安装版或执行自动化测试。

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKey` | `TAVILY_API_KEY` | 显式配置优先，否则读取 DSH 启动环境 |
| `baseURL` | `https://api.tavily.com` | Tavily API 地址 |
| `topic` | `general` | `general`、`news`、`finance` |
| `searchDepth` | `basic` | `basic`、`advanced`、`fast`、`ultra-fast` |
| `maxResults` | `20` | 请求未指定数量时使用；现有 `web_search` 会传入自己的数量上限 |

在 DSH 启动环境中设置 `TAVILY_API_KEY`。其他配置可写入 profile 的 `cordis.patch.yml`：

```yaml
- id: web-search-tavily
  config:
    topic: news
    searchDepth: basic
```

## 本地使用

使用 Node.js 24 和 pnpm 12.8.1，在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

准备好 DSH CLI 后，链接 Banso bundle：

```sh
dsh plugin --profile banso-demo add ./packages/banso
dsh --profile banso-demo --dump-config
dsh --profile banso-demo
```

修改源码后需要重新构建并重启 DSH。当前采用 workspace 本地链接；Banso tarball 不会自动包含 Tavily 包，分发方案待定。
