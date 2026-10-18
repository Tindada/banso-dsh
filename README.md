# Banso DSH

基于 DeepSeek Harness 的搜索研究助手，在多步搜索与阅读中提取证据、整理资料并管理上下文，可通过 Web 聊天或 Python SDK 使用。

## Web 源码快速开始

准备 **Node.js 24、pnpm 12.8.1 和 DeepSeek API key**。以下为 macOS / Linux 命令。

```sh
# 下载源码
git clone https://github.com/Tindada/banso-dsh.git
cd banso-dsh

# 安装并构建
pnpm install --frozen-lockfile
pnpm build

# 配置 Web profile（配置和会话默认保存在 ~/.dsh）
pnpm exec dsh plugin --profile banso-web add \
  "link:$PWD/packages/banso" \
  "link:$PWD/packages/web"

pnpm exec dsh plugin --profile banso-web exec \
  npm pkg set --json 'dsh.profile.bundles=["banso-dsh","banso-dsh-web"]'

# 在仓库根目录手动创建 .env，填写以下内容后再启动：
# DEEPSEEK_API_KEY=你的DeepSeek密钥
# JINA_API_KEY=
# Jina 密钥可留空，无需 Tavily 密钥。不要提交或分享 .env。

# 每次启动都在仓库根目录运行；浏览器会自动打开，按 Ctrl+C 停止
pnpm exec dsh --profile banso-web
```

若浏览器未打开，访问终端输出的完整 `Banso Web:` 地址。聊天会消耗 API 额度。

## 更多

- [npm 安装（Python SDK / Web 聊天）](docs/install-npm.md)
- [源码开发与测试](docs/development.md)
- [打包与发布](docs/releasing.md)
- [入口包配置与行为](packages/banso/README.md)
- [GISA 测评](evaluation/README.md)
- [项目规划与验证范围](docs/plan.md)

本项目独立维护，非 DeepSeek 官方发行包。原创代码采用 [MIT 许可证](LICENSE)；DSH 基础配置和 GISA 评分代码保留各自许可，详见[第三方许可说明](THIRD_PARTY_NOTICES.md)。
