# Banso 基础 SDK bundle

`banso-dsh-base` 提供 DeepSeek 模型调用、默认 agent loop、Python SDK 接入、会话持久化、请求重试和 Session 工作目录服务。不包含搜索、网页阅读工具或 Web UI。

工作目录服务通过文件系统验证目录，并提供必需的模型上下文；不加载面向模型的目录切换工具。

使用完整研究功能请安装 [Banso bundle](https://github.com/Tindada/banso-dsh/blob/main/packages/banso/README.md)，无需额外加载本包。

## 独立使用

在已安装 DSH `0.2.0-rc.2` 的目录执行：

```sh
pnpm exec dsh plugin --profile banso-base add banso-dsh-base@0.1.1
pnpm exec dsh plugin --profile banso-base exec npm pkg set --json 'dsh.profile.bundles=["banso-dsh-base"]'
```

设置 `DEEPSEEK_API_KEY`，在 Python SDK 中选择 `profile="banso-base"`，由 SDK 启动和关闭 DSH。环境准备与 SDK 调用示例见 [项目安装说明](https://github.com/Tindada/banso-dsh/blob/main/README.md)，其中的 profile 替换为 `banso-base`。

## 本包的身份提示词配置

`DSH_SYSTEM_PROMPT` 通过 DSH 进程的启动环境变量传入，也可通过 Python SDK 的 `env` 参数传入。它设置身份提示词前缀（`personaPrefix`），不是替换整个系统提示词。未设置时使用 `You are a helpful software engineer assistant.`。

此配置用于独立加载本包的场景；`banso-dsh` 入口包会另行设置研究助手身份。

## DSH 通用启动配置

`DSH_HOME` 指定 DSH 配置、profile 和会话数据的根目录，属于 DSH 通用启动配置。本包的会话保存在该目录下的 `sessions-banso-base/`。

- 直接使用 DSH CLI 时，在启动前设置环境变量 `DSH_HOME`；未设置时默认使用 `~/.dsh`。
- 使用 Python SDK `0.1.5rc1` 时，通过 `dsh_home` 参数指定，也可通过启动环境变量或 SDK 的 `env` 传入 `DSH_HOME`。SDK 不会隐式使用 `~/.dsh`；同时提供时，`dsh_home` 参数优先。

安装插件、启用 profile 和运行 SDK 时应使用同一个 DSH home。上面的安装命令默认使用 `~/.dsh`；如果使用其他目录，在执行安装命令前先设置 `DSH_HOME`。

### Python SDK 传入示例

在已安装 DSH 的工作目录中使用以下配置；`DEEPSEEK_API_KEY` 需预先设置到启动环境中：

```python
from pathlib import Path
from deepseek_harness import DeepSeekHarness

harness = DeepSeekHarness(
    dsh_bin=str(Path("node_modules/.bin/dsh").resolve()),
    profile="banso-base",
    dsh_home=str(Path.home() / ".dsh"),
    env={"DSH_SYSTEM_PROMPT": "你是一名研究助手。"},
)
```

SDK 会继承 Python 进程的环境变量，再应用 `env` 中的覆盖值。以上示例只展示配置；启动、调用和关闭步骤见 [项目安装说明](https://github.com/Tindada/banso-dsh/blob/main/README.md)。

## 来源与许可

基础配置改编自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 `sdk-minimal` bundle，采用 [MIT 许可证](LICENSE)，保留上游 `Copyright (c) 2026 DeepSeek` 声明。本包由 Banso 项目独立维护，非 DeepSeek 官方发行包。
