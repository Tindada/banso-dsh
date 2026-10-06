# Jina Reader fetch provider

`banso-dsh-web-fetch-jina` 向 DSH `ctx.web` 注册 ID 为 `jina` 的 fetch provider。通过 [Jina Reader](https://jina.ai/reader/) 获取 Markdown，以 `body.kind: text` 返回，不重复进行 HTML 转换。不依赖 Banso 工具或资料插件。

## 配置

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKey` | `JINA_API_KEY` | 显式配置优先；空字符串或未提供 key 时使用匿名请求，配置值不自动去除空白 |
| `baseURL` | `https://r.jina.ai` | HTTP(S) 服务地址，不带末尾 `/`，不含查询参数或 fragment |
| `timeoutMs` | `30000` | provider 超时，正整数毫秒，最大 2147483647 |
| `maxBodyChars` | `100000` | 提取后正文的字符上限，正整数 |

插件配置示例：

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    fetchProvider: jina
- name: banso-dsh-web-fetch-jina
  config:
    timeoutMs: 30000
    maxBodyChars: 100000
```

请求使用 `GET https://r.jina.ai/{目标URL}`、`Accept: application/json` 和 `X-No-Cache: true`。仅在有 key 时发送 Authorization。匿名调用的服务限制以 Jina 官方说明为准。

Banso bundle 默认选择 `jina`，同时注册原生 HTTP provider；将 web 插件的 `fetchProvider` 改为 `http` 即可切回。没有自动 fallback 或重试。

## 结果与失败

返回地址取自 Reader 的 `data.url`，缺失时使用请求地址。正文去掉首尾空白，超过字符上限时截断并设置 `truncated`。成功的 `statusCode: 200` 表示 Reader 成功，不保证是目标站原始 HTTP 状态；`truncated: false` 仅表示本 provider 未截断，不保证 Reader 提取完整。

Reader warning 包含 `Target URL returned error NNN` 且状态非 2xx 时，返回该状态和 warning 文本。Jina 服务非 2xx、网络异常、无效响应或空正文作为 `WEB_PROVIDER_ERROR` 抛出；外部取消和 provider 超时为 `WEB_ABORTED`。外层工具自身的超时策略仍然生效。

## 验证

仓库根目录执行：

```sh
pnpm build
pnpm --filter banso-dsh-web-fetch-jina test
```

测试使用本地 HTTP 服务，验证请求与响应映射、失败、截断、取消和注册生命周期，不调用 Jina 在线服务。与工具及资料插件的组合测试位于 [banso](../banso/README.md)。
