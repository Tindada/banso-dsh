# Banso DSH

基于 DeepSeek Harness 的研究助手，支持网页搜索、阅读和证据提取。通过 Python SDK 使用，无需下载 DSH 或 Banso 源码。

可通过 [Python SDK](#python-sdknpm-安装) 或 [Web 聊天](#web-聊天源码安装) 使用。以下 SDK 安装步骤使用 `banso-dsh@0.1.0`。

## Python SDK（npm 安装）

### 1. 安装

准备 **Node.js 24、pnpm、Python 3.12 和 uv**。以下为 macOS / Linux 命令，默认使用 `~/.dsh` 存放配置和会话。若此前设置过 `DSH_HOME`，先执行 `unset DSH_HOME`。

创建工作目录并安装 DSH：

```bash
mkdir banso-demo
cd banso-demo

pnpm add @deepseek-ai/dsh@0.2.0-rc.2
```

若提示 `ERR_PNPM_IGNORED_BUILDS`，执行 `pnpm approve-builds`，选择提示中的依赖并确认构建，再继续安装 Banso：

```bash
pnpm exec dsh plugin --profile banso-dsh add banso-dsh@0.1.0
```

只需安装入口包，其他 Banso 插件自动安装。若此步提示 `koffi` 构建被拦截，执行并批准：

```bash
pnpm exec dsh plugin --profile banso-dsh exec pnpm approve-builds
```

最后启用 Banso：

```bash
pnpm exec dsh plugin --profile banso-dsh exec \
  npm pkg set --json 'dsh.profile.bundles=["banso-dsh"]'
```

profile 中的 missing peer 提示可能来自 DSH 的宿主依赖机制，不需逐个补装；以实际启动结果为准。

### 2. 配置密钥

在当前目录创建 `.env`：

```dotenv
DEEPSEEK_API_KEY=你的 DeepSeek API key
TAVILY_API_KEY=你的 Tavily API key
JINA_API_KEY=
```

Jina 密钥可选。不要分享或提交 `.env`，也不要在其中填写 `DSH_BIN`、`DSH_HOME` 等启动配置。

#### 备选：不使用 Tavily

可改用 DSH 官方搜索 provider，复用 `DEEPSEEK_API_KEY`，无需填写 `TAVILY_API_KEY`。安装 Banso 后执行：

```bash
pnpm exec dsh plugin --profile banso-dsh add @deepseek-ai/dsh-web-search-deepseek@0.2.0-rc.2
```

编辑 `~/.dsh/profiles/banso-dsh/cordis.patch.yml`，将初始的 `[]` 替换为以下内容；若已有配置，合并到现有列表中：

```yaml
- id: web
  config:
    searchProvider: deepseek-official
    fetchProvider: jina

- insert:
    - id: web-search-deepseek
      name: '@deepseek-ai/dsh-web-search-deepseek'
      config:
        apiKeyEnv: DEEPSEEK_API_KEY
```

`config` 会整体替换，因此须保留 `fetchProvider: jina`。若使用自定义 `DSH_HOME`，修改该目录下对应的 profile 文件。保存后重新运行 SDK 即可；切回 Tavily 时将 `searchProvider` 改回 `tavily` 并提供其密钥。

官方搜索会额外调用模型，产生相应 token 消耗和延迟；辅助搜索模型沿用该 provider 的默认值，与主模型独立。

### 3. 发起问答

安装 Python SDK：

```bash
uv venv --python 3.12
uv pip install --python .venv/bin/python \
  'deepseek-harness-sdk==0.1.5rc1' python-dotenv
```

保存为 `ask.py`：

```python
from pathlib import Path
from dotenv import load_dotenv
from deepseek_harness import DeepSeekHarness

root = Path(__file__).resolve().parent
load_dotenv(root / ".env", override=True)
harness = DeepSeekHarness(
    dsh_bin=str(root / "node_modules/.bin/dsh"),
    dsh_home=str(Path.home() / ".dsh"),
    profile="banso-dsh",
    cwd=str(root),
    model="deepseek-flash",
)
try:
    harness.start()
    result = harness.run("请搜索 DeepSeek 官网，阅读一个结果，再简短介绍并附来源链接。")
    print(result.finish_reason)
    print(result.final_response)
finally:
    harness.close()
```

运行（会消耗 API 额度）：

```bash
.venv/bin/python ask.py
```

SDK 会自动启动和关闭 DSH，正常结束时输出 `completed` 和回答。macOS 长时间运行可使用 `caffeinate -i .venv/bin/python ask.py`，并保持开盖。

## Web 聊天（源码安装）

Web 界面支持单会话文字聊天、连续追问、流式回答、停止和错误提示。使用独立的 `banso-web` profile，无需 Python SDK。执行期间显示搜索、阅读状态及可折叠详情，本轮结束后隐藏；模型伴随工具调用的说明临时显示，回答保留。

没有历史列表和刷新恢复，刷新后下一次发送会创建新会话。刷新或关闭页面不保证停止服务端任务，需要终止时请先点击停止。

### 1. 安装

准备 Node.js 24、pnpm 12.8.1 和 Git。Web 目前通过源码安装，在终端执行；已有仓库时直接进入仓库目录：

```sh
git clone https://github.com/Tindada/banso-dsh.git
cd banso-dsh
pnpm install
pnpm build
```

后续命令均在仓库根目录执行。以下示例使用默认的 `~/.dsh`；若终端已设置 `DSH_HOME`，安装和启动都会使用该目录，应保持一致。

创建并启用 Web profile，将 `/absolute/path/to/banso-dsh` 替换为仓库绝对路径：

```sh
pnpm exec dsh plugin --profile banso-web add 'link:/absolute/path/to/banso-dsh/packages/banso'
pnpm exec dsh plugin --profile banso-web add 'link:/absolute/path/to/banso-dsh/packages/web'
pnpm exec dsh plugin --profile banso-web exec npm pkg set --json 'dsh.profile.bundles=["banso-dsh","banso-dsh-web"]'
```

### 2. 配置密钥

在仓库根目录创建 `.env`；已有文件时编辑并保留其他配置：

```dotenv
DEEPSEEK_API_KEY=你的 DeepSeek API key
JINA_API_KEY=
```

Web 默认使用官方搜索 provider `deepseek-official`，与主模型复用 `DEEPSEEK_API_KEY`，无需 `TAVILY_API_KEY`。阅读使用 Jina，密钥可选。默认主模型为 `deepseek-official / deepseek-flash`；官方搜索额外调用辅助模型，搜索超时为 60 秒。不要提交或分享 `.env`。

### 3. 启动

```sh
pnpm exec dsh --profile banso-web
```

在浏览器中打开终端输出的 `Banso Web:` 完整地址，包括本次进程的访问 token。默认仅监听 `127.0.0.1:3080`，不会自动打开浏览器。聊天会调用真实服务并消耗 API 额度。

可通过 `--port <端口号>` 指定未被占用的监听端口，下面的 `3081` 仅为示例；`--help` 查看帮助：

```sh
pnpm exec dsh --profile banso-web --port 3081
pnpm exec dsh --profile banso-web --help
```

组合要求和存储位置见 [Web 包说明](packages/web/README.md)，界面行为和限制见 [UI 说明](packages/ui/README.md#展示与限制)；修改源码后的构建与调试见 [开发文档](docs/development.md#web-开发与调试)。

## 更多

- [源码开发与测试](docs/development.md)
- [打包与发布](docs/releasing.md)
- [入口包配置与行为](packages/banso/README.md)
- [GISA 测评](evaluation/README.md)
- [项目规划与验证范围](docs/plan.md)

本项目独立维护，非 DeepSeek 官方发行包。原创代码采用 [MIT 许可证](LICENSE)；DSH 基础配置和 GISA 评分代码保留各自许可，详见[第三方许可说明](THIRD_PARTY_NOTICES.md)。
