# Tavily search provider

为 DSH 的 `ctx.web` 提供 Tavily 搜索，复用现有 `web_search`。本包只提供插件，由 `packages/banso` 中的统一 Banso bundle 加载并选用；网页获取继续使用 DSH 自带的 HTTP provider。

当前以 DSH `0.2.0-rc.2` 为待验证的兼容目标，尚未执行类型检查、构建、测试或安装验证。

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKey` | `TAVILY_API_KEY` | 显式配置优先，否则读取 DSH 启动环境 |
| `baseURL` | `https://api.tavily.com` | Tavily API 地址 |
| `topic` | `general` | `general`、`news`、`finance` |
| `searchDepth` | `basic` | `basic`、`advanced`、`fast`、`ultra-fast` |

在 DSH 启动环境中设置 `TAVILY_API_KEY`。其他配置可写入 profile 的 `cordis.patch.yml`：

```yaml
- id: web-search-tavily
  config:
    topic: news
    searchDepth: basic
```

## 本地使用

使用 Node.js 24 和 pnpm 12.8.1，在仓库根目录执行以下步骤（尚待验证）：

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

## 当前范围

- 返回 URL、标题和摘要，保留来源顺序；请求数量默认 20，最多 20，最终裁剪由 `ctx.web` 负责。
- 复用 DSH 的取消和超时机制，不额外重试；错误转换为 `WEB_PROVIDER_ERROR` 或 `WEB_ABORTED`。
- 暂不支持时间、地区和域名筛选，不输出生成式回答、网页正文、发布日期及 score、publisher、usage 等额外元数据。
- 旧版 `BANSO_TAVILY_*` 环境变量不自动读取。
