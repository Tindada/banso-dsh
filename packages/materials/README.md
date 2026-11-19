# 会话资料与网页阅读

`banso-dsh-materials` 提供网页搜索包装、正文读取与证据提取、稳定会话内 handle（`S1`、`S2`），以及共享研究预算。资料在同一会话中保存，可在后续追问中复用，内容直接随工具结果尾部返回以保持前缀缓存命中。

## 独立 bundle 安装

通过顶层 `engines.dsh` 与 DSH peer 依赖声明兼容范围 `>=0.2.1-rc.2 <0.3.0-0`。开发依赖和现有验证基线仍为 `0.2.1-rc.2`，尚未完成 rc.3 的运行验证。安装并启用后，在标准 Web 中提供资料管理和网页阅读能力，保留原有界面。

### 从 workspace 源码加载

源码构建、加载和测试见 [开发文档](https://github.com/Tindada/banso-dsh/blob/main/docs/development.md#materials-集成)。

### 从 npm 安装

在已安装 DSH 的环境中，将插件安装到已有的标准 Web profile，再启动 Web：

```sh
dsh plugin --profile web add banso-dsh-materials@0.1.4
dsh --profile web
```

若 DSH 安装在当前项目中，可将上述 `dsh` 替换为 `npx dsh` 或 `pnpm exec dsh`。安装与启动使用相同的 `DSH_HOME`。

### 从 Web UI 安装

在标准 Web 的插件管理页选择“添加插件”，输入 `banso-dsh-materials@0.1.4`，完成安装后点击“立即启用”。新建会话使用插件。

### Profile 配置

独立 bundle 只加载 materials，搜索工具、网页 provider、模型凭据与超时策略仍由目标 profile 提供。自定义配置写在 profile 的 `cordis.patch.yml` 中，例如：

```yaml
- id: banso-materials
  config:
    researchBudget: 10
```

已有 Banso 用户无需单独安装或启用本 bundle，Banso 已包含 materials。

## 集成要求

目标环境需提供 `sessionProjections`、`agents`、`tools`、`web`、`llm` 和 `systemPrompt` 服务。搜索需启用原生 `web_search` 并配置搜索 provider；没有搜索工具时，仍可通过 `web_read` 读取已知 URL。网页阅读需要可用的抓取 provider。

插件支持从宿主或 preset 继承的 `web_search`，包括遵循 DSH 原生搜索结果协议的自定义实现；接管搜索描述并在 `tools/post-execute` 阶段将结果渲染为带 handle 的结构化文本，保留原生搜索执行逻辑。不能与直接注册在 agent 自身作用域的同名搜索工具共存。

搜索包装遵循插件加载时的作用域：在宿主层加载时处理所有 agent；在 preset 或 agent 内加载时，只处理该作用域及其后代中的 agent，不包装其他 preset 的搜索。空白会话切换 preset 后，包装范围随作用域关系更新。

启用后自动禁用 `web_fetch`，由 `web_read` 统一阅读网页，无需额外设置 `fetch: false`。底层抓取服务不受影响；卸载后恢复原配置允许的工具，不会开启原本已关闭的工具。禁用不取消已经开始的抓取，也不限制绕过工具执行流程的直接调用。

## 配置

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `researchBudget` | 15 | 每轮允许的 search/read 调用次数；非负安全整数，0 禁用这两种调用 |
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
| `extract` | `web_read({target, mode: "extract", focus})` | 按 focus 提取的证据（随工具结果返回） |
| `direct` | `web_read({target, mode: "direct"})` | 已保存的格式化正文（首次随工具结果返回，重复读取返回简短复用提示） |

同一 session 可逐次切换；两种方式共用正文缓存，不需要单独调用 fetch。direct 仍通过当前 fetch provider 获取正文，不意味着切换到 HTTP provider。

## 工具行为

### 搜索

`web_search` 沿用 DSH 原生搜索参数。结果直接随 `tool/result` 返回，包含来源数量、截断状态、外部非信任数据提示、本次返回的全部来源（附带会话内稳定 handle，例如 `S1`）及可选 answer。

再次搜索命中同一精确 URL 时，复用已有 handle（标注 `(existing)`），同时保留本次搜索返回的新 snippet 与元数据，不隐藏换词搜索带来的新片段。

### 提取证据

`web_read` 接受以下参数：

```json
{"target": "S1", "mode": "extract", "focus": "项目的开源范围和许可证"}
```

`target` 为资料 handle 或完整 HTTP(S) URL，`focus` 为非空的提取目标。每次读取一个页面，多页使用多个调用。

已有成功正文时直接复用，否则抓取并保存格式化正文。每次读取根据本次 focus 提取证据，成功结果按 focus 追加保存，并直接随工具结果返回给主 agent；全文不会进入主模型上下文。没有相关证据时不清除已有证据。可以对同一来源以不同 focus 追问，无需重新抓取。证据只覆盖所指定的 focus，不能视为整篇网页的完整摘要。

### 直接读取正文

`web_read` 的 direct 模式接受以下参数，不需要 focus（传入时忽略）：

```json
{"target": "S1", "mode": "direct"}
```

`target` 同样支持完整 HTTP(S) URL。首次成功抓取后保存正文，后续调用复用已有正文，不刷新网页，也不调用提取模型。

同一材料首次以 `direct` 模式阅读时，工具结果返回带 handle、最终 URL、截断标记的格式化正文（不是原始 HTML）；若同一材料此前已通过 `direct` 返回过正文，再次 `direct` 只返回简短复用提示，避免重复输出长正文。

## 失败与恢复限制

抓取失败时不进行证据提取；抓取成功但提取失败时仍保留正文和旧证据。未知 handle、非法参数或缺少所需服务时返回工具错误。整体取消或超时不保证保存本次尚未完成的正文和证据。

只支持当前工具协议的会话恢复，不兼容旧 `web_fetch` 或无 mode 的 `web_read` 日志；升级后使用新会话。资料跨 turn 保存，并支持会话恢复；handle 仅在所属 session 内有效。卸载插件不会撤销已经写入的会话内容。

不提供网页刷新或过期策略、证据去重与合并、长文分块、上下文总量控制、长期资料库或最终引用语义校验。无法恢复 provider 已截断的内容；证据和历史日志会继续增长。

## 读取资料状态（集成接口）

```ts
const state = ctx.sessionProjections.stateOf(session, 'bansoMaterials')
const material = state?.items.S1
```

返回状态由框架持有，调用方不得修改。`stateVersion` 为 `4`。导出 `Material`、`MaterialsState`、`FetchedContent`、`Evidence` 和 `ReadMode` 类型。

- `items` 按 handle 保存资料，`urlIndex` 按精确请求 URL 索引；首次有效发现按日志提交顺序分配 `S1`、`S2`。重定向的最终 URL 不合并其他条目。
- 资料保留标题、snippet、发布时间等搜索字段。搜索仅覆盖本次提供的字段，不清除正文或证据。
- `fetched` 保存最后成功的格式化正文、最终 URL、截断标记及正文入库时间。失败保留此前正文。
- `pageShown` 标记该材料是否已在 `direct` 模式下向模型返回过正文，用于避免重复输出长正文。
- `evidence` 为追加的证据组，每组保存 `focus`、`text` 和提取结果入库时间 `time`。失败和空结果不清除已有证据。
- 正文复用不更改入库时间，也不重复记录全文。正文和证据的时间表示保存时间，单位为 Unix 毫秒。

## 共享研究预算

`researchBudget` 控制每轮 search/read 的共享额度，配置示例见上方 Profile 配置。每轮开始时用量清零，已有材料继续保留。

每次 `web_search` 或 `web_read` 调用尝试都计数，包括参数错误、失败、取消和被预算拒绝的调用。direct、extract 和正文缓存复用均计数，内部重试不重复计数；被禁用的 `web_fetch` 不计数。因此尝试次数可以超过额度，但获准执行的研究调用不会超过额度。

研究预算的每轮上限通过静态系统提示词（`banso:research-budget`）说明，实时已用次数与剩余额度随每次 `web_search` / `web_read` 工具结果（含抛错失败调用）末尾返回，不占用动态 `runtime-context`。耗尽后，search/read 不再提供给模型，继续调用也会被拒绝。本功能仅覆盖默认 agent loop 的直接工具调用，不支持绕过 loop 的直接执行或嵌套工具调用计量。

完整会话日志可以重建用量；不提供旧持久化资料缓存的迁移，旧缓存版本不匹配时应使用新会话或从完整日志重建。恢复会话本身不会清零，新一轮开始时才会清零。修改额度不会改写调用历史，后续工具控制使用当前配置。
