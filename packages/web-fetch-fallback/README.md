# Composite Fetch Fallback Provider

`banso-dsh-web-fetch-fallback` 向 DSH `ctx.web` 注册 ID 为 `fallback` 的复合 fetch provider，按顺序依次尝试：

1. `deepseek-fetch-api`（主抓取通道）
2. `jina`（Jina Reader 降级通道，未配置 `JINA_API_KEY` 时允许匿名访问）

## 架构说明与已知限制

本包是**不修改上游 `@deepseek-ai/dsh-web` 的折中实现**：

- 上游 `ctx.web` 仅支持按单个 `fetchProvider` ID 路由，且不对外暴露按 ID 获取或调用已注册 provider 的接口；
- 因此本包无法在运行时按 ID 复用其他插件已注册的实例，只能直接依赖并在内部组合实例化 `DeepSeekFetchApiProvider` 与 `JinaFetchProvider`，在实现上耦合了这两个具体 provider；
- 受此限制，本包内部额外维护了一段精简的 DeepSeek 凭据/端点组装逻辑（`resolveDeepSeekOptions`），如果自定义了 `web-deepseek-api` 的端点或凭据字段，需要同步在本包配置中指定。若后续上游 `dsh-web` 原生支持多 provider 降级链或按 ID 调用，可替代本包。

## 降级规则

- **立即返回**：`deepseek-fetch-api` 返回 2xx 结果时直接返回，不触发 Jina。
- **不降级、直接透传**：
  - 外部 `AbortSignal` 已取消（`WEB_ABORTED`）；
  - 非法 URL（非 HTTP(S)）；
  - 认证或凭据级错误（`WEB_PROVIDER_CREDENTIAL_MISSING`、`HTTP 401` / `HTTP 403`、账号登录态被拒）。
- **触发 Jina fallback**：主通道返回非 2xx、单跳超时、网络错误或目标页抓不到（如 `HTTP 404` / `429` / `5xx`、`failed to fetch URL`）。
- **两级均失败**：剥离上游端点排查模板，抛出精简汇总的 `WebError`（格式如 `deepseek-fetch-api: ...; jina: ...`）。

## 配置

所有字段均可选，默认零配置可用：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `deepseek.apiKey` | — | 字面量 DeepSeek API Key，优先于 `apiKeyEnv` |
| `deepseek.apiKeyEnv` | `DEEPSEEK_API_KEY` | 凭据引用名（依次查 `credentials` 服务与启动环境） |
| `deepseek.baseURL` | `https://api.deepseek.com/v1/tools` | DeepSeek Fetch API 前缀地址 |
| `deepseek.timeoutMs` | `30000` | 主通道单跳超时（毫秒） |
| `jina.apiKey` | `JINA_API_KEY` | Jina API Key，未配置或为空时走匿名通道 |
| `jina.baseURL` | `https://r.jina.ai` | Jina Reader 服务地址 |
| `jina.timeoutMs` | `30000` | Jina 单跳超时（毫秒） |
| `jina.maxBodyChars` | `100000` | Jina 提取正文字符上限 |

配置示例：

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    fetchProvider: fallback
- id: web-fetch-fallback
  name: banso-dsh-web-fetch-fallback
```
