# npm 安装

## 官方 Web

准备 **Node.js 24、pnpm 和 DeepSeek API key**。在工作目录安装 DSH 和 Banso preset：

```sh
pnpm add @deepseek-ai/dsh@0.2.1-rc.2
pnpm exec dsh plugin --profile web add banso-dsh-preset@0.1.0
```

在该目录创建 `.env`（也可复制已有配置）：

```dotenv
DEEPSEEK_API_KEY=你的DeepSeek密钥
JINA_API_KEY=
```

`JINA_API_KEY` 可留空。启动后，在新任务中选择 **Banso** 和模型：

```sh
pnpm exec dsh --profile web
```

需要更换端口时加上 `--port 3081`。默认配置与会话保存在 `~/.dsh`；若设置了 `DSH_HOME`，安装和启动均使用该目录。配置说明见 [preset README](../packages/preset/README.md)。

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

独立 Search API 不额外调用模型；上游 provider 保留短摘要 `snippet`，尚未保留长摘要 `summary`。当前源码的 preset 与 SDK 组合均默认选择 `deepseek-search-api`。

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
