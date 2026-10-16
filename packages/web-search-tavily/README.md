# Tavily search provider

为 DSH 的 `ctx.web` 提供 Tavily 搜索，复用现有 `web_search`。本包只提供插件，由 `banso-dsh` bundle 默认加载并选用。本包不负责网页获取。

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

安装与组合见 [Banso bundle](https://github.com/Tindada/banso-dsh/blob/main/packages/banso/README.md)，源码构建见 [开发文档](https://github.com/Tindada/banso-dsh/blob/main/docs/development.md)。
