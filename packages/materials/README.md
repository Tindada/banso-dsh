# 会话资料与证据快照

`banso-dsh-materials` 统一提供网页搜索短回执、`web_read` 证据提取、`materials_hide` 和资料快照。依赖 `sessionProjections`、`agents`、`tools`、`web`、`llm` 和 `systemPrompt`。工具返回 metadata，由 host-only `bansoMaterials` 投影维护资料；主 agent 通过快照读取证据。沿用现有工具事件，不新增事件类型。

Banso 组合关闭原生 `web_fetch` 注册，保留原生 `web_search`；抓取通过 DSH 的 `ctx.web.fetch()` 使用已配置 provider。

原网页工具包已合并到本包。组合只注册 `banso-materials`，提取配置也放在此注册项的 `config` 下。

## 源码结构

```text
src/
├── index.ts                 # 插件注册与公共类型导出
├── types.ts                 # 材料和投影状态类型
├── context/
│   ├── context.ts           # 快照渲染、替换与上下文注入
│   └── guidance.ts          # 主 agent 的搜索、读取和隐藏指引
├── extraction/
│   └── extract.ts           # 独立 LLM 证据提取
├── state/
│   ├── projection.ts        # 从工具事件维护资料状态
│   └── snapshot.ts          # 跟踪最新已提交的快照消息
└── tools/
    ├── hide.ts              # materials_hide 工具
    ├── read.ts              # 正文抓取、复用和提取编排
    └── search.ts            # 搜索短回执包装及注册生命周期
```

## 工具提示词

`src/context/guidance.ts` 管理主研究模型的两段工具使用规则：在 `system-prompt/assemble` 阶段替换原生 `tool:web_search` 文本，并独立注册 `tool:web_read`。规则说明短回执、资料快照、handle、按 focus 提取及外部数据的信任边界；不负责整体研究策略或最终回答格式。

两段规则分别随对应工具在当前作用域的可见性生效。替换保留其他 section、工具 schema 和上下文。卸载插件后恢复原生搜索规则并移除阅读规则。不修改 DSH 源码，也不影响 read 内部独立提取模型的提示词。

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
| `maxOutputTokens` | 4,096 | 提取输出上限；达到上限不保存残缺证据 |
| `timeoutMs` | 120,000 | read 整体超时，单位毫秒 |

提取请求显式使用 `reasoningEffort: off`，不继承主对话的思考配置。

Banso 组合加载 `@deepseek-ai/dsh-tool-call-timeout-policy` 执行整体超时。单独组合本插件时也需加载该策略；仅声明 `timeoutMs` 不会启动计时器。抓取和提取都转发执行取消信号。

## 结果协议

search 的短回执包含来源数量、截断状态和可选 answer；metadata 保留原生结构。

read 的执行结果与 metadata 使用同一结构：

- `requestUrl`、`focus`：请求地址与本次提取目标。
- `content`、`finalUrl`、`truncated`：仅在本次成功抓取时提供；复用已保存正文时省略。
- `evidence`：提取完成时提供，空字符串表示没有相关证据。
- `error`：失败原因，区分抓取或提取失败；HTTP 非 2xx 的错误文本包含状态码。
- `fetchMs`、`extractMs`：抓取（含正文格式化）和提取阶段耗时，单位毫秒；复用正文时省略 `fetchMs`，未进入提取时省略 `extractMs`。
- `usage`：原样保存提取模型报告的 token 用量；未返回用量时省略，不做估算。

所有结果使用同一个 schema，不按抓取和提取分别定义状态枚举。诊断仅保存在结果日志中，不进入工具短回执或资料快照；已捕获的阶段失败保留可用诊断，整体取消和超时仍不提交 metadata。
正文复用 DSH 的 `formatFetchOutput(result, Infinity)`，包括页头与提示，不是原始 HTML；provider 的截断仍然有效。模型工具回执仅报告状态，正文与证据经 metadata 保存，证据集中在下一步资料快照展示。

抓取成功后提取失败仍保存正文。抓取异常／非 2xx 不调用提取器。未知 handle、非法参数、缺少 agent／投影使用普通工具错误。整体取消或超时不提交阶段 metadata，不保证保存本次尚未入库的正文。

读取工具通过包内类型读取 materials 投影，不直接修改资料。当前协议替换旧 fetch 协议，不做兼容或迁移。

## 状态与更新

```ts
const state = ctx.sessionProjections.stateOf(session, 'bansoMaterials')
const material = state?.items.S1
```

返回状态由框架持有，调用方不得修改。导出 `Material`、`MaterialsState`、`FetchedContent` 和 `Evidence` 类型。

- `items` 按 handle 保存资料，`urlIndex` 按精确请求 URL 索引；首次有效发现按日志顺序分配 `S1`、`S2`。重定向的最终 URL 不合并其他条目。
- `hidden` 缺省或为 `false` 时可见，为 `true` 时隐藏整个条目。再次搜索命中同一精确请求 URL 或收到有效阅读结果时设为 `false`；正文、证据及 handle 均保留。
- 资料保留标题、snippet、发布时间等搜索字段。搜索仅覆盖本次提供的字段，不清除正文或证据。
- `fetched` 保存最后成功的格式化正文、最终 URL、截断标记及正文入库时间。失败保留此前正文。
- `evidence` 为追加的证据组，每组保存 `focus`、`text` 和提取结果入库时间 `time`。失败和空结果不清除已有证据。
- 正文复用不更改入库时间，也不重复记录全文。正文和证据的时间均取自各自入库的结果事件，单位为 Unix 毫秒。

`pendingCalls` 仅保存工具名称与调用身份，通过事件 seq、callId、turn 关联结果；参数校验和目标解析由工具负责。仅原始追加且 metadata 有效的结果更新资料，处理后删除 pending，turn 结束清理残留。不会从短回执猜测正文或证据。操作成功、失败或无相关证据的状态保留在工具回执中，资料快照不重复展示。

抓取阶段失败可按请求 URL 创建条目。普通工具错误包含非法输入和整体取消，未提交有效 metadata 时不更新资料。提取失败的结果仍可保存本次成功正文。

## 批量隐藏工具

```ts
materials_hide({ handles: ["S3", "S7"] })
```

`handles` 为必填的非空字符串数组，重复值去重。结果为 `{ hidden: string[], alreadyHidden: string[], unknown: string[] }`：分别表示本次隐藏、已经隐藏和不存在的 handle。未知 handle 不阻止处理其他条目；重复隐藏没有额外副作用。工具默认独占调度，不调用网络或 LLM。

工具只读取当前会话状态并返回结果，由正常提交的 `tool/result` metadata 驱动投影设置 `hidden: true`，下一份快照生效；不会直接修改投影或消息。缺少 agent、材料投影、空数组以及取消按工具错误处理，不提交隐藏操作。

本包在系统提示的工具说明中引导模型收到搜索结果后检查最新快照，批量隐藏明显无关的材料后继续研究，保留支持结论、解释分歧或追查未决问题所需的材料。说明随 `materials_hide` 的工具可见性显示。

不提供独立恢复工具。再次搜索到同一 URL 或通过 handle／URL 阅读会自动重新展示材料。阅读正常返回有效 metadata 时，即使抓取或提取失败也重新展示已有材料；非法输入、未知 handle 和整体取消不改变可见性。

## 模型上下文

`renderMaterials()` 仅展示 `hidden !== true` 的条目，包括来源、已保存正文的信息、截断标记，以及各 focus 的证据文本。全文只保存在资料状态，不自动进入主模型上下文。没有有效证据时展示搜索 snippet，有证据后隐藏；底层始终保留 snippet。证据只覆盖所记录的 focus，追问可再次读取同一来源。

`agent/pre-step` 在允许进入 step 时将最新快照加入消息。资料按 handle 数字排序；内容不变时复用快照，发生变化时用短占位替换旧快照，再追加新快照。已有材料全部隐藏时生成“当前没有可见材料”的空快照并替换旧快照；从未收集材料时不插入快照。消息 source 为 `{ kind: 'banso-materials', form: 'snapshot' | 'placeholder' }`。

`bansoMaterialsSnapshot` 投影只保存最新快照的 `{ messageId, seq }` 或 `null`。快照被外部操作覆盖时，下步重新插入。卸载停止后续更新，不撤销已写入消息。

## 恢复与边界

资料跨 turn 保存，handle 仅在当前 session 内有效。纯同步投影不访问网络或读取时钟，支持 JSONL 重放、后加载和卸载重载。`stateVersion` 保持 `1`，不做旧版本兼容或历史迁移，不增加额外检查点缓存。

正文可能已被 provider 截断，无法恢复未保存内容。证据和历史日志仍会增长，本版不实现证据合并、总量控制、长期资料库或最终引用语义校验。

```sh
pnpm --filter banso-dsh-materials test
```

投影测试使用事件夹具；上下文测试加载统一插件和 Web 服务，使用真实 tools 服务、默认 loop 与模拟模型，不调用网页 provider。覆盖更新、失败、关联、隔离、确定性重放、快照替换、拒绝进入 step 及重载，以及批量隐藏的分类去重、输入校验、只读执行和数据保留。搜索及阅读结果重新展示材料，包含正常返回 metadata 的抓取／提取失败；全部隐藏后用空快照替换旧快照，恢复后重新展示。

完整读取链路与 JSONL 恢复见 [Banso 组合层测试](../banso/README.md#组合层测试)。测试不验证真实模型自主隐藏材料的效果。

网页工具单元测试通过包内注册函数与模拟 web／LLM provider 隔离工具行为，覆盖搜索包装与可见性、读取复用、提取输入预算、错误、取消、超时和配置校验。统一插件的注册、卸载、后加载及完整研究链路由上下文和 Banso 组合测试验证。
