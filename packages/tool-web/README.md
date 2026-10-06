# 网页搜索与证据读取

`banso-dsh-tool-web` 为原生 `web_search` 提供 agent scope 短回执包装，并独立注册 `web_read`。依赖 `tools`、`agents`、`sessionProjections`、`web` 和 `llm`；需要资料投影 `bansoMaterials`。Banso 组合关闭原生 `web_fetch` 注册，抓取仍通过 DSH 的 `ctx.web.fetch()` 使用已配置 provider。

## 读取

```json
{"target": "S1", "focus": "项目的开源范围和许可证"}
```

`target` 也可以是完整 HTTP(S) URL，`focus` 为非空字符串。每次读取一个页面，多页使用多个调用，沿用 DSH 默认并发调度。handle 和直接 URL 都查询当前 session：已有成功正文就复用，否则抓取并保存格式化文本，再按 focus 提取。新 URL 在结果入库后分配 handle。

提取使用一次无工具的 LLM 调用，输入仅为 focus、来源标题和正文；最终 URL 已包含在正文页头中。结果是一段紧凑证据文本，空文本表示无相关证据。每次成功提取追加一个 focus 证据组；追问可以对同一来源再次读取，不重新抓取。首版不提供刷新、过期、证据去重或长文分块。

## 配置

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `provider`、`model` | 当前 session 最新请求的模型路由 | 必须成对覆盖；没有路由时提取失败 |
| `maxInputBytes` | 200,000 | 提取系统提示词与序列化输入的 UTF-8 字节上限，超限报错而不截取 |
| `maxOutputTokens` | 2,048 | 提取输出上限；达到上限不保存残缺证据 |
| `timeoutMs` | 120,000 | read 整体超时，单位毫秒 |

Banso 组合加载 `@deepseek-ai/dsh-tool-call-timeout-policy` 执行整体超时。单独组合本插件时也需加载该策略；仅声明 `timeoutMs` 不会启动计时器。抓取和提取都转发执行取消信号。

## 结果协议

search 的短回执包含来源数量、截断状态和可选 answer；metadata 保留原生结构。

read 的执行结果与 metadata 使用同一结构：

- `requestUrl`、`focus`：请求地址与本次提取目标。
- `content`、`finalUrl`、`truncated`：仅在本次成功抓取时提供；复用已保存正文时省略。
- `evidence`：提取完成时提供，空字符串表示没有相关证据。
- `error`：失败原因，区分抓取或提取失败；HTTP 非 2xx 的错误文本包含状态码。

所有结果使用同一个扁平 schema，不再按抓取和提取分别定义状态枚举。
正文复用 DSH 的 `formatFetchOutput(result, Infinity)`，包括页头与提示，不是原始 HTML；provider 的截断仍然有效。模型工具回执仅报告状态，正文与证据经 metadata 保存，证据集中在下一步资料快照展示。

抓取成功后提取失败仍保存正文。抓取异常／非 2xx 不调用提取器。未知 handle、非法参数、缺少 agent／投影使用普通工具错误。整体取消或超时不提交阶段 metadata，不保证保存本次尚未入库的正文。

本包仅通过类型依赖读取 materials 投影，不在运行时导入 materials，也不直接修改资料。当前协议替换旧 fetch 协议，不做兼容或迁移。

## 注册与验证

read 是独立工具，支持 DSH 常规作用域限制和卸载。search 包装继续处理已有／新建 agent、原生工具后加载、局部覆盖、限制变更和卸载恢复，不修改全局原生定义。

```sh
pnpm --filter banso-dsh-tool-web test
```

测试使用数据夹具、模拟 web／LLM provider 和 DSH 超时策略，不加载 materials 插件或访问在线服务。覆盖正文复用、输入与输出错误、分阶段失败、取消／超时和工具生命周期。跨包验证见 [Banso 组合层测试](../banso/README.md#组合层测试)。当前支持 DSH `0.2.0-rc.2` 的直接工具调用，不保证嵌套复合传输兼容。
