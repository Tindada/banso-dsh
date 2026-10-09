# Banso DSH

基于 DeepSeek Harness 的研究助手，支持网页搜索、阅读和证据提取。通过 Python SDK 使用，无需下载 DSH 或 Banso 源码。

## 1. 安装

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

## 2. 配置密钥

在当前目录创建 `.env`：

```dotenv
DEEPSEEK_API_KEY=你的 DeepSeek API key
TAVILY_API_KEY=你的 Tavily API key
JINA_API_KEY=
```

Jina 密钥可选。不要分享或提交 `.env`，也不要在其中填写 `DSH_BIN`、`DSH_HOME` 等启动配置。

### 备选：不使用 Tavily

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

## 3. 发起问答

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

## 更多

- [源码开发与插件说明](packages/banso/README.md)
- [GISA 测评](evaluation/README.md)
- [项目规划与验证范围](docs/plan.md)

本项目独立维护，非 DeepSeek 官方发行包。基础配置的 MIT 许可见 [LICENSE](packages/base/LICENSE)，入口包随附上游许可声明。
