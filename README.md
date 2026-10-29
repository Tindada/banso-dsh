# Banso DSH

基于 DeepSeek Harness 的网页研究助手，支持搜索、阅读网页和整理证据，可通过 Web 聊天或 Python SDK 使用。

## 已有 DSH：直接安装插件

在官方 DSH Web 中安装即可，无需下载或构建本仓库。

### 使用 Banso 网页研究助手

1. 打开插件管理页，选择“添加插件”，输入 `banso-dsh-preset@0.1.1`。
2. 安装完成后，点击“立即启用”。
3. 新建任务，选择 **Banso** 和模型，即可开始研究。

Banso 使用已有 DSH 环境中的模型、搜索和网页抓取服务，请先确保这些服务已配置可用。配置与行为见 [preset 说明](packages/preset/README.md)。

也可以通过命令行安装到 `web` profile，再启动 Web：

```sh
dsh plugin --profile web add banso-dsh-preset@0.1.1
dsh --profile web
```

若 DSH 安装在当前项目中，将 `dsh` 替换为 `pnpm exec dsh`。安装和启动使用同一个 `DSH_HOME`。

### 为已有 agent 添加资料管理能力

如果希望继续使用现有 agent，可在插件管理页安装并启用 `banso-dsh-materials@0.1.4`，然后新建任务。它提供网页阅读、证据提取，以及面向模型的会话内资料管理，让模型在后续追问中复用已获取的资料。宿主要求与工具变化见 [Materials 说明](packages/materials/README.md)。

**Banso preset 已包含 materials，无需再单独安装或启用 materials。**

尚未安装 DSH，可按 [npm 安装文档](docs/install-npm.md#官方-web)准备环境并安装 Banso；Python 用户可查看其中的 [SDK 使用步骤](docs/install-npm.md#python-sdknpm-安装)。

## 源码运行与开发

需要修改代码或从源码运行时，使用以下步骤。

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
