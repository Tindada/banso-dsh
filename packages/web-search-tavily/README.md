# Tavily search provider

为 DSH 的 `ctx.web` 提供 Tavily 搜索，复用现有 `web_search`。本包只提供插件，由 `packages/banso` 中的统一 Banso bundle 加载并选用；网页获取继续使用 DSH 自带的 HTTP provider。

接口与依赖对齐 DSH `0.2.0-rc.2`。

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

## 开发与使用

在仓库根目录执行 `pnpm typecheck` 检查类型，`pnpm build` 编译插件。修改源码后需重新构建并重启 DSH。

安装和 profile 操作统一见 [Banso bundle](../banso/README.md)，验证进度见 [迁移规划](../../docs/plan.md)。
