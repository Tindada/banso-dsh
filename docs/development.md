# 源码开发

本文说明源码构建、调试、实现接口和测试。命令均在本仓库根目录执行，除非另有说明；无需检出 DSH 源码仓库。

## 文档分工

[根 README](../README.md) 提供源码快速开始，[npm 安装文档](install-npm.md) 提供发布包安装与 SDK 调用步骤；各包 README 说明配置、公共接口和使用限制，跨包链接使用完整仓库 URL。实现细节放在本文，发布流程见 [打包与发布](releasing.md)，进度与历史验证见 [迁移规划](plan.md)，待定事项见 [TODO](todos.md)。包 README 不记录发布进度或维护过程。

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

密钥配置和启动见 [Web 源码快速开始](../README.md#web-源码快速开始)，开发时在仓库根目录放置 `.env` 并启动。修改 UI 后运行 `pnpm build`，重启服务并刷新页面；当前没有开发热更新。修改 Web patch 后也需重启。

```sh
pnpm exec dsh --profile banso-web --dump-config
```

浏览器测试的准备步骤见 [测试与验证范围](#测试与验证范围)。

## 内部实现

### Materials 集成

Banso 从 npm 安装 `banso-dsh-materials@0.1.2`，由自己的 patch 注册插件，不额外启用 materials 独立 bundle。本仓库不维护 materials 源码、构建或单元测试；插件协议和配置见 [npm 包说明](https://www.npmjs.com/package/banso-dsh-materials/v/0.1.2)。

`packages/banso/tests/research.test.mjs` 通过包名导入已安装的 npm 包，覆盖默认 loop、工具 metadata、资料快照、共享研究预算、正文复用、两种阅读模式与 JSONL 恢复。组合关闭原生 fetch 工具并加载 DSH 工具超时策略，网页 provider、模型和凭据仍由 Banso 组合提供。测试使用模拟模型及 provider，Jina 集成使用本地 HTTP 服务，不代表真实在线服务已经验证。

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

会话选择保存在 URL 的 `session` 参数中，等待目录就绪后打开历史；切换时释放引用，并隔离过期异步结果。`loadOlder()` 加载更早消息并保持阅读位置，`refreshProjections()` 补齐未打开会话的标题。重命名通过 `sessions.using()` 持有目标会话至保存结束，复用 `rename()` 持久化；Web 加载标题服务，不加载模型标题 provider。

TypeScript 和 esbuild 生成 DSH `__ModuleLoader__.load` 工厂，React 使用宿主共享模块；不依赖 DSH 源码仓库的构建脚本。

## 测试与验证范围

先完成 `pnpm typecheck` 和 `pnpm build`，再按改动范围运行：

| 范围 | 命令 | 主要覆盖 |
| --- | --- | --- |
| Banso 组合 | `pnpm --filter banso-dsh test` | 真实插件、默认 loop、JSONL 恢复；handle、并发读取、正文复用、两种阅读模式及参考时间；真实 Jina provider 对接本地 HTTP 服务 |
| Prompt | `pnpm --filter banso-dsh-prompt test` | 真实 loop、模拟 LLM 与可控时钟；同轮固定、跨轮更新、agent 隔离及重载 |
| Jina | `pnpm --filter banso-dsh-web-fetch-jina test` | 本地 HTTP 服务验证请求、响应、错误、截断、取消及生命周期 |
| UI | `pnpm --filter banso-dsh-ui test` | 消息与工具状态投影、URL、标题及相对时间 |
| Web | `pnpm --filter banso-dsh-web test` | 真实 CLI、HTTP/WebSocket 与浏览器链路；聊天与工具状态、会话切换、分页、重命名、刷新／重连／重启恢复及操作菜单；`--help` 不绑定端口 |
| Python 测评 | 在 `evaluation/` 执行 `uv run pytest` | 模拟 SDK、批量续跑和离线评分；准备步骤见 [测评文档](../evaluation/README.md) |

Web 测试需先安装浏览器：

```sh
pnpm --filter banso-dsh-web exec playwright install chromium
```

也可设置 `BANSO_TEST_CHROMIUM=/absolute/path/to/chromium` 使用已有浏览器。测试使用临时 profile/home；截图输出到忽略提交的 `packages/web/lib/chat-smoke.png` 和 `tool-status-mobile.png`。

这些测试使用模拟模型、模拟 provider 或本地 HTTP 服务，不验证在线服务可用性或研究质量。Banso 组合测试手动加载插件，不经过 bundle/SDK 启动入口；Web 测试经过真实 CLI、会话接口和默认 loop，并检查 Banso 提示词及研究工具已加载。历史在线与发布安装验证见 [迁移规划](plan.md)。
