# Banso DSH

基于 DeepSeek Harness 的搜索研究助手，在多步搜索与阅读中提取证据、整理资料并管理上下文，可通过 Web 聊天或 Python SDK 使用。

## 官方 Web 源码快速开始

准备 **Node.js 24、pnpm 12.8.1 和 DeepSeek API key**。以下为 macOS / Linux 命令。

```sh
# 下载源码
git clone https://github.com/Tindada/banso-dsh.git
cd banso-dsh

# 安装并构建
pnpm install --frozen-lockfile
pnpm build

# 向官方 Web profile 加载 preset，配置与会话保存在仓库内 .dsh
pnpm run dsh plugin --profile web add "link:$PWD/packages/preset"

# 在仓库根目录手动创建 .env，填写以下内容后再启动：
# DEEPSEEK_API_KEY=你的DeepSeek密钥
# JINA_API_KEY=
# Jina 密钥可留空，无需 Tavily 密钥。不要提交或分享 .env。

# 每次启动都在仓库根目录运行；浏览器会自动打开，按 Ctrl+C 停止
pnpm run dsh --profile web
```

在官方页面的新任务中选择 **Banso**，并配置或选择宿主模型。若浏览器未打开，访问终端输出的完整 `dsh web:` 地址。聊天会消耗 API 额度；preset 当前仅提供源码加载，未发布 npm。配置细节见 [preset 说明](packages/preset/README.md)。

## 更多

- [Python SDK 的 npm 安装](docs/install-npm.md)
- [源码开发与测试](docs/development.md)
- [打包与发布](docs/releasing.md)
- [入口包配置与行为](packages/banso/README.md)
- [Materials 插件](packages/materials/README.md)
- [官方 DSH 的 Banso preset](packages/preset/README.md)
- [GISA 测评](evaluation/README.md)
- [项目规划与验证范围](docs/plan.md)

本项目独立维护，非 DeepSeek 官方发行包。原创代码采用 [MIT 许可证](LICENSE)；DSH 基础配置和 GISA 评分代码保留各自许可，详见[第三方许可说明](THIRD_PARTY_NOTICES.md)。
