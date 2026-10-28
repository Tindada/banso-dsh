# Banso DSH

基于 DeepSeek Harness 的搜索研究助手，在多步搜索与阅读中提取证据、整理资料并管理上下文，可通过 Web 聊天或 Python SDK 使用。

已有官方 DSH Web 时，可在前端的插件安装界面输入 `banso-dsh-preset` 安装。
安装后，在新任务中选择 **Banso** 即可使用。

## 官方 Web 快速开始

准备 **Node.js 24、pnpm 12.8.1 和 DeepSeek API key**。

下载源码并构建：

```sh
git clone https://github.com/Tindada/banso-dsh.git
cd banso-dsh
pnpm install --frozen-lockfile
pnpm build
```

在仓库根目录创建 `.env`：

```dotenv
DEEPSEEK_API_KEY=你的DeepSeek密钥
```

加载 Banso preset 并启动官方 Web：

```sh
pnpm run dsh plugin --profile web add "link:$PWD/packages/preset"
pnpm run dsh --profile web
```

在新任务中选择 **Banso**，并选择模型，即可开始研究。上述命令将配置与会话保存在仓库内 `.dsh`。

配置见 [preset 说明](packages/preset/README.md)，开发与测试见 [开发文档](docs/development.md)。

## 更多

- [npm 安装（官方 Web / Python SDK）](docs/install-npm.md)
- [源码开发与测试](docs/development.md)
- [打包与发布](docs/releasing.md)
- [入口包配置与行为](packages/banso/README.md)
- [Materials 插件](packages/materials/README.md)
- [官方 DSH 的 Banso preset](packages/preset/README.md)
- [GISA 测评](evaluation/README.md)
- [项目规划与验证范围](docs/plan.md)

本项目独立维护，非 DeepSeek 官方发行包。原创代码采用 [MIT 许可证](LICENSE)；DSH 基础配置和 GISA 评分代码保留各自许可，详见[第三方许可说明](THIRD_PARTY_NOTICES.md)。
