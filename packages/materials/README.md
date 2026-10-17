# 会话资料与证据快照

`banso-dsh-materials` 提供网页搜索、证据提取或正文读取、材料隐藏，以及供主 agent 阅读的资料快照。资料在同一会话中保存，可在后续追问中复用。

## 集成要求

需要 `sessionProjections`、`agents`、`tools`、`web`、`llm` 和 `systemPrompt` 服务，以及可用的搜索和抓取 provider。组合时保留原生 `web_search`，关闭原生 `web_fetch`，避免与本插件的阅读工具重复；Banso bundle 已完成这些配置。

在 Banso profile 中，插件配置放在 `banso-materials` 注册项的 `config` 下。阅读方式由每次工具调用的 `mode` 决定。

## 配置

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `provider`、`model` | 当前 session 最新请求的模型路由 | 必须成对覆盖；没有路由时提取失败 |
| `maxInputBytes` | 200,000 | 提取系统提示词与序列化输入的 UTF-8 字节上限，超限报错而不截取 |
| `maxOutputTokens` | 4,096 | 提取输出上限；达到上限不保存残缺证据 |
| `timeoutMs` | 120,000 | web_read 整体超时，单位毫秒 |

`provider`、`model`、`maxInputBytes` 和 `maxOutputTokens` 仅用于提取；直接模式仍保留配置合法性校验，但不调用提取器。direct 不额外裁剪正文，保留 provider 截断；超过主模型上下文上限时作为运行失败处理。

提取请求显式使用 `reasoningEffort: off`，不继承主对话的思考配置。

Banso 组合加载 `@deepseek-ai/dsh-tool-call-timeout-policy` 执行整体超时。单独组合本插件时也需加载该策略；仅声明 `timeoutMs` 不会启动计时器。


## 阅读模式

只提供 `web_read`，每次调用必须选择 `mode`，没有默认值或启动模式配置：

| 模式 | 阅读工具 | 主 agent 看到的内容 |
| --- | --- | --- |
| `extract` | `web_read({target, mode: "extract", focus})` | 按 focus 提取的证据 |
| `direct` | `web_read({target, mode: "direct"})` | 已保存的格式化正文 |

同一 session 可逐次切换；两种方式共用正文缓存，不需要单独调用 fetch。direct 仍通过当前 fetch provider 获取正文，不意味着切换到 HTTP provider。

## 工具行为

### 搜索

`web_search` 沿用 DSH 原生搜索参数。返回简短回执，包含来源数量、截断状态和可选 answer；来源资料进入快照，并获得当前会话内的 handle，例如 `S1`。

### 提取证据

`web_read` 接受以下参数：

```json
{"target": "S1", "mode": "extract", "focus": "项目的开源范围和许可证"}
```

`target` 为资料 handle 或完整 HTTP(S) URL，`focus` 为非空的提取目标。每次读取一个页面，多页使用多个调用。

已有成功正文时直接复用，否则抓取并保存格式化正文。每次读取根据本次 focus 提取证据，成功结果按 focus 追加保存；没有相关证据时不清除已有证据。可以对同一来源以不同 focus 追问，无需重新抓取。

工具返回状态或错误的简短回执，证据通过资料快照提供给主 agent，全文不会自动进入主模型上下文。证据只覆盖所指定的 focus，不能视为整篇网页的完整摘要。

### 直接读取正文

`web_read` 的 direct 模式接受以下参数，不需要 focus（传入时忽略）：

```json
{"target": "S1", "mode": "direct"}
```

`target` 同样支持完整 HTTP(S) URL。首次成功抓取后保存正文，后续调用复用已有正文，不刷新网页，也不调用提取模型。

工具返回获取或复用结果的简短回执，正文进入资料快照；同一材料只展示一份正文。保存的内容是带来源页头和提示的格式化文本，不是原始 HTML，仍可能被抓取 provider 截断。

### 批量隐藏材料

`materials_hide` 接受以下参数：

```json
{"handles": ["S3", "S7"]}
```

`handles` 为必填的非空字符串数组，重复值去重。结果包含 `hidden`、`alreadyHidden`、`unknown` 三个字符串数组，分别表示本次隐藏、已经隐藏和不存在的 handle。未知 handle 不阻止其他条目隐藏，重复隐藏没有额外副作用。此工具不调用网络或 LLM。

隐藏仅从主 agent 的资料快照中移除条目，不删除正文、证据或 handle。全部隐藏后，主 agent 会看到没有可见材料的快照。

没有独立恢复工具。再次搜索命中同一精确 URL，或通过 handle／URL 阅读，会重新展示材料。已识别材料的阅读即使返回抓取或提取失败，也会重新展示；非法输入、未知 handle、整体取消和超时不会改变可见性。

## 资料展示

快照只展示未隐藏的资料，并保留来源和正文截断提示。每条材料以最近一次成功阅读的模式展示，同一快照可混合两种模式：

- `extract` 模式：有证据时展示证据；尚无证据时展示搜索 snippet。提取失败不自动退回全文展示。
- `direct` 模式：有正文时展示正文，不展示提取证据；尚无正文时展示搜索 snippet。空正文也视为已保存。

失败或取消不切换展示模式；成功提取但无相关证据仍切换为 extract。正文和累计证据均保留，切换只改变展示；同一材料并发阅读以成功结果写入日志的顺序为准。尚未成功阅读时展示搜索 snippet（如有）。

搜索 snippet 仍保存在资料中，显示证据或正文时只是暂不展示。资料变化会在后续模型步骤中反映到快照。

### 快照结构示意

材料快照是提供给主 agent 的文本内容，不是 Web 界面的资料面板。开头展示研究预算、调用尝试次数和剩余额度。材料区说明这是当前资料状态，并标明来源内容属于外部数据，不应当作指令。以下省略预算头，按 handle 展示未隐藏的材料：

- **来源**：handle 和请求 URL，以及可用的标题、发布时间。
- **已保存正文的信息**：抓取后的最终 URL、截断标记、保存时间（UTC）和字符数；仅在已有正文时出现。
- **阅读内容**：extract 模式按 focus 展示证据及提取时间；direct 模式展示正文。尚无相应内容时使用搜索 snippet（如有）。

以下为 extract 模式的简化示意，省略了部分字段，不是固定输出格式：

```text
Material: S1
URL: https://example.com/project
Title: 项目介绍
Saved page:
Final URL: https://example.com/project
Truncated: false
Evidence focus: 项目的开源范围和许可证
Evidence:
项目的核心代码采用 MIT 许可证。
```

同一材料可包含多组 focus 证据。direct 模式将证据部分换为 `Page text:` 正文；已隐藏的材料不出现在快照中。

## 失败与恢复限制

抓取失败时不进行证据提取；抓取成功但提取失败时仍保留正文和旧证据。未知 handle、非法参数或缺少所需服务时返回工具错误。整体取消或超时不保证保存本次尚未完成的正文和证据。

只支持当前工具协议的会话恢复，不兼容旧 `web_fetch` 或无 mode 的 `web_read` 日志；升级后使用新会话。资料跨 turn 保存，并支持会话恢复；handle 仅在所属 session 内有效。卸载插件不会撤销已经写入的会话内容。

不提供网页刷新或过期策略、证据去重与合并、长文分块、上下文总量控制、长期资料库或最终引用语义校验。无法恢复 provider 已截断的内容；证据和历史日志会继续增长。

## 读取资料状态（集成接口）

```ts
const state = ctx.sessionProjections.stateOf(session, 'bansoMaterials')
const material = state?.items.S1
```

返回状态由框架持有，调用方不得修改。导出 `Material`、`MaterialsState`、`FetchedContent`、`Evidence` 和 `ReadMode` 类型。

- `items` 按 handle 保存资料，`urlIndex` 按精确请求 URL 索引；首次有效发现按日志顺序分配 `S1`、`S2`。重定向的最终 URL 不合并其他条目。
- `hidden` 缺省或为 `false` 时可见，为 `true` 时隐藏整个条目。再次搜索命中同一精确请求 URL 或收到有效阅读结果时设为 `false`；正文、证据及 handle 均保留。
- 资料保留标题、snippet、发布时间等搜索字段。搜索仅覆盖本次提供的字段，不清除正文或证据。
- `displayMode` 为最近成功阅读的 `direct` 或 `extract`；尚未成功阅读时缺省。
- `fetched` 保存最后成功的格式化正文、最终 URL、截断标记及正文入库时间。失败保留此前正文。
- `evidence` 为追加的证据组，每组保存 `focus`、`text` 和提取结果入库时间 `time`。失败和空结果不清除已有证据。
- 正文复用不更改入库时间，也不重复记录全文。正文和证据的时间表示保存时间，单位为 Unix 毫秒。


实现使用的依赖接口、事件与日志协议、快照管理和测试见 [开发文档](https://github.com/Tindada/banso-dsh/blob/main/docs/development.md#materials-注册与阅读链路)。


## 共享研究预算

`researchBudget` 默认 `15`，接受非负安全整数；`0` 表示不提供研究工具。可在 profile patch 中覆盖：

```yaml
- id: banso-materials
  config:
    researchBudget: 10
```

每个 `turn/start` 将用量清零，已有材料继续保留。每条 `web_search` 或 `web_read` 的 `tool/call` 计一次尝试，包括参数错误、失败、取消和被预算拒绝的调用。direct、extract、缓存复用均计一次，内部重试不重复计数，`materials_hide` 不计数。因此尝试次数可以超过额度，获准执行的研究调用不会超过额度。

预算与材料一起进入快照，无材料时也显示总额度、尝试次数和非负剩余额度。额度耗尽后过滤模型请求中的 search/read，并通过 DSH `tools.guard()` 拒绝继续调用；不额外注入收尾指令。默认 loop 先记录调用，再按顺序完成前置检查，最后并发执行，因此 guard 使用已经包含当前调用的 `used <= researchBudget`。本功能仅覆盖默认 loop 的直接工具调用，不支持绕过 loop 的直接 dispatch 或嵌套工具调用计量。

预算复用 materials projection，`stateVersion` 保持 `2`，快照版本不变，不新增日志事件。完整 JSONL 重放根据既有 turn/tool 事件重建计数，包括旧日志中的研究调用。新版本不提供旧持久化 projection 缓存迁移；缺少 budget 字段的缓存不能当作零用量使用，应使用新会话或从完整日志重建。恢复后是否清零取决于是否产生新的 `turn/start`。修改配置不会改写调用历史，工具控制使用当前配置。
