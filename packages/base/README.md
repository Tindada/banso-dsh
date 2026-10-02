# Banso 基础 SDK bundle

`banso-dsh-base` 从同级项目 `try-minimal` 迁入，保留 17 个启用插件和默认 `ReactLoopAgent`。通过单个 `insert` 提供完整 Cordis 配置树，不依赖 `dsh-base` 或 `dsh-sdk-minimal`。这是纯配置包，无需编译。

## 能力与边界

运行链路为：DSH 源码 CLI → profile → 本 bundle → SDK stdio JSON-RPC → 默认 loop → DeepSeek 模型；会话事件保存为 JSONL。

- 保留 Agent、LLM、Session、工具注册、提示词、会话投影、模型重试和运行时规则检查。
- 没有具体工具、Shell、搜索、抓取或 Web UI。
- `agents: []` 表示启动时不预建 agent，由 SDK 客户端创建。
- `session-title` 配置保留为注释，依赖清单仍按原实验保留该包。
- 凭据通过 `DEEPSEEK_API_KEY` 提供；`DSH_SYSTEM_PROMPT` 可覆盖默认提示词。

相对迁入时的实验 patch，仅修改两项：诊断用 profile 名为 `banso-base`，会话目录为 `dshHomePath('sessions-banso-base')`，默认对应 `~/.dsh/sessions-banso-base`。原实验目录、profile 和会话未迁移或删除。

## 安装依赖

依赖已声明在本包的 `package.json` 中，版本沿用原实验：DSH 为 `0.2.0-rc.2`，Cordis peer 为 `4.0.4`。共享根 workspace 的锁文件、`koffi` 构建许可和现有 DSH 类型依赖补丁。

本次新增基础包后，在 **banso-dsh 仓库根目录**安装依赖并更新锁文件：

```sh
pnpm install
```

更新后的锁文件提交后，后续可使用 `pnpm install --frozen-lockfile` 进行可重复安装。不复制实验目录的锁文件或 node_modules。

## 创建独立 profile

完成依赖安装后，在已准备好的 **deepseek-harness 源码仓库目录**执行。将示例路径替换为实际绝对路径：

```sh
pnpm dsh plugin --profile banso-base add 'link:/absolute/path/to/banso-dsh/packages/base'
pnpm dsh plugin --profile banso-base exec npm pkg set --json 'dsh.profile.bundles=["banso-dsh-base"]'
pnpm dsh --profile banso-base --dump-config
pnpm dsh --profile banso-base
```

第二条命令只修改 profile manifest，不使用 npm 安装依赖。新 profile 自动初始化时会加入 dsh-base，因此将 bundle 列表设为仅含本包。这些命令适用于新建的专用 `banso-base` profile，不应覆盖现有业务 profile。

启动后是 SDK stdio JSON-RPC 服务，不是终端聊天界面。Python SDK 脚本选择 `banso-base` profile；若脚本自行启动 DSH，无需预先运行服务命令。修改 patch 后需重新启动。

## 与 Banso 业务层的关系

`packages/banso` 保持现有组合，假定宿主已经提供 web 服务。当前不能直接把它叠加到本基础包：后续需在业务层显式加入 web、HTTP Fetch 和 web 工具。本次只引入独立底座，不改动现有 banso-web 的组合方式。

## 验证状态

- 原 try-minimal 文档记录配置检查、Python SDK 真实多轮对话已通过；依赖清理后未确认复测。
- 迁入配置已静态对照，除 profile 名和会话目录外与实验一致，共 17 个启用条目。
- package.json 已包含完整依赖声明，根锁文件已更新。
- 用户提供的 banso-base 配置输出确认仅加载本 bundle 的 17 个插件，并确认运行 DSH 源码仓库的 `python/sdk/call_dsh.py` 正常。
- 重试触发、重启后的会话恢复及 npm CLI 安装版兼容性未单独验证。`--dump-config` 不能替代运行验证。
