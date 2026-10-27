# 源码开发

本文说明源码构建、调试、实现接口和测试。命令均在本仓库根目录执行，除非另有说明；无需检出 DSH 源码仓库。

## 文档分工

[根 README](../README.md) 提供官方 Web 源码快速开始，[npm 安装文档](install-npm.md) 提供发布包安装与 SDK 调用步骤；各包 README 说明配置、公共接口和使用限制，跨包链接使用完整仓库 URL。实现细节放在本文，发布流程见 [打包与发布](releasing.md)，进度与历史验证见 [迁移规划](plan.md)，待定事项见 [TODO](todos.md)。包 README 不记录发布进度或维护过程。

## 构建与源码 profile

使用 Node.js 24 和 pnpm 12.8.1：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

构建编译功能插件，并由 banso 的构建脚本从 base 复制 `base.patch.yml`、生成第三方许可声明。基础配置只修改 `packages/base/cordis.patch.yml`；复制产物不手工维护。修改源码后重新构建，修改 patch 后重启；修改基础 patch 时还需重新构建入口包。

各包通过 `engines.dsh` 声明兼容范围 `>=0.2.1-rc.2 <0.3.0-0`，DSH 运行时依赖和 peers 使用相同范围；根 CLI、开发依赖和当前锁文件仍固定在 `0.2.1-rc.2`。preset 使用宿主 DSH peers，完整 bundle 保留所组合插件的普通依赖。范围声明不代表 rc.3 等其他版本已经验证。

调试 SDK 组合时，用源码链接创建 profile。将示例中的绝对路径替换为本仓库路径；安装、配置检查和 SDK 启动应使用同一个 `DSH_HOME`：

```sh
pnpm exec dsh plugin --profile banso-dsh add 'link:/absolute/path/to/banso-dsh/packages/banso'
pnpm exec dsh plugin --profile banso-dsh exec npm pkg set --json 'dsh.profile.bundles=["banso-dsh"]'
pnpm exec dsh --profile banso-dsh --dump-config
```

单独调试基础 bundle 时，将上述三条命令中的 profile 改为 `banso-base`，链接目标改为 `packages/base`，bundle 列表改为 `["banso-dsh-base"]`。密钥和调用方式分别见 [入口包](../packages/banso/README.md) 与 [基础包](../packages/base/README.md)；由 SDK 启动 DSH 时无需提前启动服务。

## 官方 Web 开发与调试

Web 使用官方界面和 Banso preset。完成上述构建后，在仓库根目录创建 `.env`，配置 `DEEPSEEK_API_KEY`（`JINA_API_KEY` 可留空），然后执行：

```sh
pnpm run dsh plugin --profile web add "link:$PWD/packages/preset"
pnpm run dsh --profile web
```

这些命令使用仓库内 `.dsh` 的官方 `web` profile。preset 配置与限制见 [包说明](../packages/preset/README.md)；修改功能插件后重新构建，修改 patch 后重启。检查合成配置：

```sh
pnpm run dsh --profile web --dump-config
```

旧 `banso-web` profile 及会话文件保留，但其中的源码链接随自建 Web 删除而失效。使用新的 `web` profile，不自动接续旧 Web 会话；历史 npm 包不会因源码清理而改变。

## 内部实现

### Materials 集成

Banso 通过 workspace 依赖加载 `packages/materials/`，由自己的 patch 注册插件。协议和配置见 [materials README](../packages/materials/README.md)。若要在官方 Web 中单独调试 materials，完成根目录构建后执行：

```sh
pnpm exec dsh plugin --profile web add "link:$PWD/packages/materials"
pnpm exec dsh --profile web
```

Banso 组合测试导入本地 materials，沿用默认 loop 和 JSONL 后端。materials 的独立 bundle 测试检查 pnpm tarball、许可证及标准 Web 配置合成，复用已安装依赖，不执行隔离安装或启动 Web。具体测试命令见下表。

### 提示词与参考时间

`packages/prompt/src/index.ts` 使用 DSH 的 `systemPrompt` 服务和 agent 事件，研究策略文本位于 `src/prompts.ts`：

| 接口 | 用途 |
| --- | --- |
| `ctx.systemPrompt.section()` | 注册 `banso:research`，`order: 1000`，使用配置覆盖或内置文本，`interpolate: false` 禁用插值 |
| `ctx.on('agent/inbox/claimed', …)` | 同步记录该 agent 当前 turn 首次领取输入的 UTC 时间；同轮不重复生成 |
| `ctx.systemPrompt.context()` | 注册 `banso:reference-time`，`order: 0`，按当前 agent 读取已记录时间 |

选择 `agent/inbox/claimed` 是因为它发生在提示词组装之前；在 `agent/pre-step` 中才记录时间会太晚。状态保存在插件实例内按 agent 隔离的 WeakMap 中，context 回调只读取，不生成时间。缺少 agent 或记录时返回空文本；状态不持久化，恢复后的新 turn 重新生成。

## 测试与验证范围

先完成 `pnpm typecheck` 和 `pnpm build`，再按改动范围运行：

| 范围 | 命令 | 主要覆盖 |
| --- | --- | --- |
| Preset | `pnpm --filter banso-dsh-preset test` | 打包、官方配置合成、研究流程、工具列表及其他 preset 共存 |
| Materials | `pnpm --filter banso-dsh-materials test` | 资料状态重放、快照、阅读、隐藏、预算、取消与超时、搜索作用域；pnpm tarball、许可证及标准 Web 配置合成 |
| Banso 组合 | `pnpm --filter banso-dsh test` | 真实插件、默认 loop、JSONL 恢复；handle、并发读取、正文复用、两种阅读模式及参考时间；真实 Jina provider 对接本地 HTTP 服务 |
| Prompt | `pnpm --filter banso-dsh-prompt test` | 真实 loop、模拟 LLM 与可控时钟；同轮固定、跨轮更新、agent 隔离及重载 |
| Jina | `pnpm --filter banso-dsh-web-fetch-jina test` | 本地 HTTP 服务验证请求、响应、错误、截断、取消及生命周期 |
| Python 测评 | 在 `evaluation/` 执行 `uv run pytest` | 模拟 SDK、批量续跑和离线评分；准备步骤见 [测评文档](../evaluation/README.md) |

这些测试使用模拟模型、模拟 provider 或本地 HTTP 服务，不验证在线服务可用性或研究质量。Banso 组合测试手动加载插件；preset 集成测试检查官方配置合成、真实 preset loader 和默认 loop，不包含自动化浏览器测试。官方页面的手动验收使用临时 profile，结果见 preset README。历史在线与发布安装验证见 [迁移规划](plan.md)。
