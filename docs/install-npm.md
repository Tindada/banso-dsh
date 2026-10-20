# npm 安装

可通过 [Web 聊天](#web-聊天npm-安装) 或 [Python SDK](#python-sdknpm-安装) 使用。以下步骤使用 `banso-dsh@0.1.1` 和 `banso-dsh-web@0.1.0`。

## Web 聊天（npm 安装）

Web 界面支持单会话文字聊天、连续追问、流式回答、停止和错误提示。使用独立的 `banso-web` profile，无需 Python SDK。执行期间显示搜索、阅读状态及可折叠详情，本轮结束后隐藏；模型伴随工具调用的说明临时显示，回答保留。

没有历史列表和刷新恢复，刷新后下一次发送会创建新会话。刷新或关闭页面不保证停止服务端任务，需要终止时请先点击停止。

### 1. 安装

准备 Node.js 24 和 pnpm 12.8.1，无需下载源码或安装 Python SDK。以下命令使用默认的 `~/.dsh`；若此前设置过 `DSH_HOME`，先执行 `unset DSH_HOME`。

创建工作目录并安装 DSH；若已按上面的 SDK 步骤安装，可复用该工作目录，直接从创建 Web profile 开始：

```sh
mkdir banso-web-demo
cd banso-web-demo
pnpm add @deepseek-ai/dsh@0.2.0-rc.2
pnpm approve-builds
```

在交互列表中选择提示的依赖并确认构建。然后创建 Web profile，安装两个入口包并单独批准 profile 中的 `koffi` 构建：

```sh
pnpm exec dsh plugin --profile banso-web add banso-dsh@0.1.1 banso-dsh-web@0.1.0
pnpm exec dsh plugin --profile banso-web exec pnpm approve-builds
```

其他插件由依赖关系自动安装。启用 Web 组合，注意两个 bundle 的顺序：

```sh
pnpm exec dsh plugin --profile banso-web exec npm pkg set --json 'dsh.profile.bundles=["banso-dsh","banso-dsh-web"]'
```

后续命令均在当前工作目录执行。若使用自定义 `DSH_HOME`，安装插件、启用 profile 和启动时必须保持一致。

### 2. 配置密钥

在当前工作目录创建 `.env`；已有文件时编辑并保留其他配置：

```dotenv
DEEPSEEK_API_KEY=你的 DeepSeek API key
JINA_API_KEY=
```

Web 默认使用官方搜索 provider `deepseek-official`，与主模型复用 `DEEPSEEK_API_KEY`，无需 `TAVILY_API_KEY`。阅读使用 Jina，密钥可选。默认主模型为 `deepseek-official / deepseek-flash`；官方搜索额外调用辅助模型，搜索超时为 60 秒。不要提交或分享 `.env`。

### 3. 启动

```sh
pnpm exec dsh --profile banso-web
```

服务就绪后默认使用系统默认浏览器打开完整认证地址。终端仍输出 `Banso Web:` 地址（包括本次进程的访问 token）；自动打开失败时可手动访问。默认仅监听 `127.0.0.1:3080`。聊天会调用真实服务并消耗 API 额度。

可通过 `--port <端口号>` 指定未被占用的监听端口，下面的 `3081` 仅为示例；`--help` 查看帮助：

```sh
pnpm exec dsh --profile banso-web --port 3081
# SSH、无桌面环境或不希望自动打开浏览器时
pnpm exec dsh --profile banso-web --no-open
pnpm exec dsh --profile banso-web --help
```

组合要求和存储位置见 [Web 包说明](../packages/web/README.md)，界面行为和限制见 [UI 说明](../packages/ui/README.md#展示与限制)；修改源码后的构建与调试见 [开发文档](development.md#web-开发与调试)。

## Python SDK（npm 安装）

### 1. 安装

准备 **Node.js 24、pnpm 12.8.1、Python 3.12 和 uv**。以下为 macOS / Linux 命令，默认使用 `~/.dsh` 存放配置和会话。若此前设置过 `DSH_HOME`，先执行 `unset DSH_HOME`。

创建工作目录并安装 DSH：

```bash
mkdir banso-demo
cd banso-demo

pnpm add @deepseek-ai/dsh@0.2.0-rc.2
```

批准工作目录中 DSH 依赖的构建，在交互列表中用空格选择提示的依赖，回车确认：

```bash
pnpm approve-builds
```

构建完成后安装 Banso：

```bash
pnpm exec dsh plugin --profile banso-dsh add banso-dsh@0.1.1
```

只需安装入口包，其他 Banso 插件自动安装。profile 是独立的依赖目录，还需在其中批准 `koffi` 构建：

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
JINA_API_KEY=
```

Jina 密钥可选。不要分享或提交 `.env`，也不要在其中填写 `DSH_BIN`、`DSH_HOME` 等启动配置。

#### 搜索 provider 配置

当前源码组合默认使用 DSH 官方独立 Search API provider，复用 `DEEPSEEK_API_KEY`，无需填写 `TAVILY_API_KEY`。以下显式配置也可用于覆盖旧默认值；旧版已发布包不一定包含该插件。

编辑 `~/.dsh/profiles/banso-dsh/cordis.patch.yml`，将初始的 `[]` 替换为以下内容；若已有配置，合并到现有列表中：

```yaml
- id: web
  config:
    searchProvider: deepseek-search-api
    fetchProvider: jina
```

`config` 会整体替换，因此须保留 `fetchProvider: jina`。若使用自定义 `DSH_HOME`，修改该目录下对应的 profile 文件。保存后重新运行 SDK 即可；切回 Tavily 时将 `searchProvider` 改回 `tavily` 并提供其密钥。

独立 Search API 不额外调用模型；上游 provider 保留短摘要 `snippet`，尚未保留长摘要 `summary`。当前源码的 Web 与 SDK 组合均默认选择 `deepseek-search-api`。

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

SDK 会自动启动和关闭 DSH，正常结束时输出 `completed` 和回答。
