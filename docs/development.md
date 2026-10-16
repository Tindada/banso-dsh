# 源码开发

本文说明源码构建、调试、实现接口和测试。命令均在本仓库根目录执行，除非另有说明；无需检出 DSH 源码仓库。

## 文档分工

[根 README](../README.md) 提供安装与启动步骤；各包 README 说明配置、公共接口和使用限制，跨包链接使用完整仓库 URL。实现细节放在本文，发布流程见 [打包与发布](releasing.md)，进度与历史验证见 [迁移规划](plan.md)，待定事项见 [TODO](todos.md)。包 README 不记录发布进度或维护过程。

## 构建与源码 profile

使用 Node.js 24 和 pnpm 12.8.1：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

构建编译功能插件和 UI，并由 banso 的构建脚本从 base 复制 `base.patch.yml`、生成第三方许可声明。基础配置只修改 `packages/base/cordis.patch.yml`；复制产物不手工维护。修改源码后重新构建，修改 patch 后重启；修改基础 patch 时还需重新构建入口包。

调试 SDK 组合时，用源码链接创建 profile。将示例中的绝对路径替换为本仓库路径；安装、配置检查和 SDK 启动应使用同一个 `DSH_HOME`：

```sh
pnpm exec dsh plugin --profile banso-dsh add 'link:/absolute/path/to/banso-dsh/packages/banso'
pnpm exec dsh plugin --profile banso-dsh exec npm pkg set --json 'dsh.profile.bundles=["banso-dsh"]'
pnpm exec dsh --profile banso-dsh --dump-config
```

单独调试基础 bundle 时，将上述三条命令中的 profile 改为 `banso-base`，链接目标改为 `packages/base`，bundle 列表改为 `["banso-dsh-base"]`。密钥和调用方式分别见 [入口包](../packages/banso/README.md) 与 [基础包](../packages/base/README.md)；由 SDK 启动 DSH 时无需提前启动服务。

## Web 开发与调试

先完成上面的源码构建，再创建链接到源码的 Web profile；将路径替换为本仓库绝对路径：

```sh
pnpm exec dsh plugin --profile banso-web add 'link:/absolute/path/to/banso-dsh/packages/banso' 'link:/absolute/path/to/banso-dsh/packages/web'
pnpm exec dsh plugin --profile banso-web exec npm pkg set --json 'dsh.profile.bundles=["banso-dsh","banso-dsh-web"]'
```

密钥配置和启动见 [Web 聊天](../README.md#web-聊天npm-安装)，开发时在仓库根目录放置 `.env` 并启动。修改 UI 后运行 `pnpm build`，重启服务并刷新页面；当前没有开发热更新。修改 Web patch 后也需重启。

```sh
pnpm exec dsh --profile banso-web --dump-config
```

浏览器测试的准备步骤见 [测试与验证范围](#测试与验证范围)。

## 内部实现

### Materials 注册与阅读链路

以下文件路径相对于 `packages/materials/src/`。工具执行只读取资料状态，更新通过工具结果事件提交：

| 环节 | 源码入口与依赖接口 | 职责 |
| --- | --- | --- |
| 注册 | `index.ts`：`ctx.sessionProjections.register()`、`ctx.tools.register()` | 注册资料和快照投影、隐藏工具，以及由 `readMode` 选择的阅读工具 |
| 搜索包装 | `tools/search.ts` | 保留原生搜索参数和 metadata，将模型回执改为简短输出 |
| 正文获取 | `tools/page.ts`：`ctx.web.fetch()`、`formatFetchOutput(result, Infinity)` | 解析 handle、复用正文，或调用 provider 并格式化正文；保留 provider 截断 |
| 证据提取 | `extraction/extract.ts`：`ctx.llm.stream()`、`BlockAssembler` | 单次无工具调用；输入 focus、标题和正文，解析含 `text` 字段的 JSON，保存证据和用量 |
| 结果提交 | `tools/read.ts`、`tools/fetch.ts`、`tools/hide.ts` | 返回短回执与 metadata，由框架提交工具结果事件 |
| 状态更新 | `state/projection.ts` | 从事件维护 `bansoMaterials`，不从短回执猜测内容 |
| 上下文注入 | `context/context.ts`、`state/snapshot.ts` | 渲染资料，跟踪并替换旧快照 |

`readMode` 由入口传给工具和渲染层，各模块不自行读取环境变量。提取模型路由使用成对覆盖的 provider/model，否则读取 `session.requestHeader()?.config`；推理固定为 `off`。抓取与提取均传递取消信号。公共配置、资料类型及只读访问方式见 [包 README](../packages/materials/README.md)。

### Materials 工具日志协议

search 沿用原生 metadata；read/fetch 的执行结果作为 metadata 保存。正文和证据经投影进入快照，耗时和 token 用量只保存在日志中。

| 字段 | read | fetch | 保存规则 |
| --- | --- | --- | --- |
| `requestUrl` | 有 | 有 | 请求地址 |
| `focus` | 有 | 无 | 本次提取目标 |
| `content`、`finalUrl`、`truncated` | 可选 | 可选 | 仅本次成功抓取时提供；复用正文时省略 |
| `evidence` | 可选 | 无 | 提取完成时提供，空字符串表示无相关证据 |
| `error` | 可选 | 可选 | 阶段失败原因；HTTP 非 2xx 错误包含状态码 |
| `fetchMs` | 可选 | 可选 | 抓取及格式化耗时，单位毫秒；复用时省略 |
| `extractMs` | 可选 | 无 | 提取耗时，单位毫秒；未进入提取时省略 |
| `usage` | 可选 | 无 | 模型实际报告的 token 用量，不估算 |

不维护单独的抓取／提取状态枚举。抓取失败不调用提取器；抓取成功后提取失败仍可提交正文和诊断。未知 handle、非法参数、缺少 agent／投影按普通工具错误处理。整体取消和超时不提交阶段 metadata，因此不保证保存本次尚未入库的内容。原生 DSH fetch 的结果不作为本插件协议使用。

### Materials 投影更新与恢复

`pendingCalls` 通过事件 seq、callId、turn 关联调用和结果。仅原始追加且 metadata 有效的结果更新资料；处理后删除 pending，turn 结束清理残留。隐藏工具默认独占调度，正常提交的 `tool/result` 驱动 `hidden: true`，不直接改写资料或消息。

抓取阶段失败可按请求 URL 创建条目；普通工具错误或整体取消没有有效 metadata 时不更新资料。正文和证据时间取自各自入库的结果事件，复用正文不更新时间或重复记录全文。

资料投影纯同步，不访问网络或时钟，支持 JSONL 重放、后加载和卸载重载。`stateVersion` 保持 `1`，新增 fetch 解析兼容现有 read 日志，不增加迁移或检查点缓存。阅读模式不写入投影，恢复时由调用方保持配置一致。

### Materials 快照与提示词

`context/context.ts` 的 `agent/pre-step` 中间件先等待后续检查结果，仅在允许进入 step 时读取投影并注入快照。`renderMaterials(state, readMode)` 负责渲染，展示规则见 [资料展示](../packages/materials/README.md#资料展示)。

快照内容不变时复用；变化时用短占位替换旧快照，再追加新快照。消息 source 为 `{ kind: 'banso-materials', form: 'snapshot' | 'placeholder' }`。全部材料隐藏时生成空快照，从未收集材料时不插入。`bansoMaterialsSnapshot` 保存最新快照的 `{ messageId, seq }` 或 `null`；发现快照被外部覆盖时，下步重新插入。包入口导出对应的 `MaterialsSnapshotState` 类型。卸载停止后续更新，不撤销已写入消息。

`context/guidance.ts` 使用 `ctx.systemPrompt.section()` 注册 `Materials snapshot:` 公共声明和工具指引，通过 `system-prompt/assemble` 中间件置空原生搜索指引；read/hide 的工具指引随作用域可见性生效。search/fetch 不重复添加系统指引；原生 `tool:web_search` 文本置空，快照语义由搜索 description 补充。卸载恢复原生描述与指引，并移除本插件声明。提取模型使用独立提示词，不受这些主 agent 指引影响。

### 提示词与参考时间

`packages/prompt/src/index.ts` 使用 DSH 的 `systemPrompt` 服务和 agent 事件，研究策略文本位于 `src/prompts.ts`：

| 接口 | 用途 |
| --- | --- |
| `ctx.systemPrompt.section()` | 注册 `banso:research`，`order: 1000`，使用配置覆盖或内置文本，`interpolate: false` 禁用插值 |
| `ctx.on('agent/inbox/claimed', …)` | 同步记录该 agent 当前 turn 首次领取输入的 UTC 时间；同轮不重复生成 |
| `ctx.systemPrompt.context()` | 注册 `banso:reference-time`，`order: 0`，按当前 agent 读取已记录时间 |

选择 `agent/inbox/claimed` 是因为它发生在提示词组装之前；在 `agent/pre-step` 中才记录时间会太晚。状态保存在插件实例内按 agent 隔离的 WeakMap 中，context 回调只读取，不生成时间。缺少 agent 或记录时返回空文本；状态不持久化，恢复后的新 turn 重新生成。

### UI 实现与构建

使用官方 `sessions.create/retain` 和 session 的 `beginSubmission/prompt/cancel`，订阅 snapshot 与 event source。`packages/ui/src/client/messages.ts` 投影用户文字、assistant 正文和实时片段；工具状态单独投影。卸载释放会话引用、样式和根插槽注册。展示行为见 [UI README](../packages/ui/README.md)。

TypeScript 和 esbuild 生成 DSH `__ModuleLoader__.load` 工厂，React 使用宿主共享模块；不依赖 DSH 源码仓库的构建脚本。

## 测试与验证范围

先完成 `pnpm typecheck` 和 `pnpm build`，再按改动范围运行：

| 范围 | 命令 | 主要覆盖 |
| --- | --- | --- |
| Banso 组合 | `pnpm --filter banso-dsh test` | 真实插件、默认 loop、JSONL 恢复；handle、并发读取、正文复用、两种阅读模式及参考时间；真实 Jina provider 对接本地 HTTP 服务 |
| Materials | `pnpm --filter banso-dsh-materials test` | 工具注册与卸载、投影重放、快照替换、隐藏恢复、预算与错误／取消／超时；direct 不调用提取模型 |
| Prompt | `pnpm --filter banso-dsh-prompt test` | 真实 loop、模拟 LLM 与可控时钟；同轮固定、跨轮更新、agent 隔离及重载 |
| Jina | `pnpm --filter banso-dsh-web-fetch-jina test` | 本地 HTTP 服务验证请求、响应、错误、截断、取消及生命周期 |
| UI | `pnpm --filter banso-dsh-ui test` | 消息与工具状态投影 |
| Web | `pnpm --filter banso-dsh-web test` | 真实 CLI、HTTP/WebSocket 与浏览器链路；流式回答、追问、取消、错误恢复、刷新及工具状态；`--help` 不绑定端口 |
| Python 测评 | 在 `evaluation/` 执行 `uv run pytest` | 模拟 SDK、批量续跑和离线评分；准备步骤见 [测评文档](../evaluation/README.md) |

Web 测试需先安装浏览器：

```sh
pnpm --filter banso-dsh-web exec playwright install chromium
```

也可设置 `BANSO_TEST_CHROMIUM=/absolute/path/to/chromium` 使用已有浏览器。测试使用临时 profile/home；截图输出到忽略提交的 `packages/web/lib/chat-smoke.png` 和 `tool-status-mobile.png`。

这些测试使用模拟模型、模拟 provider 或本地 HTTP 服务，不验证在线服务可用性或研究质量。Banso 组合测试手动加载插件，不经过 bundle/SDK 启动入口；Web 测试经过真实 CLI、会话接口和默认 loop，并检查 Banso 提示词及研究工具已加载。历史在线与发布安装验证见 [迁移规划](plan.md)。
