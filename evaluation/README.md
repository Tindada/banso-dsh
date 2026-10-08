# GISA 单题答题入口

通过 Python SDK 调用 Banso DSH，每题使用独立会话。研究结束后校验 JSON，转换为 GISA TSV；选题和评分由测评端负责，不自动重试或修复答案。

## 运行

需要 Python 3.12+、uv，以及已安装的 DSH 和 Banso profile。在本目录执行：

```sh
uv sync --locked
```

准备 `case.json`（单个 JSON 对象）：

```json
{"id": 1, "question": "What is Python's official website URL?", "answer_type": "item"}
```

```sh
uv run python -m banso_eval.answer \
  --input case.json \
  --dsh-bin /absolute/path/to/node_modules/.bin/dsh \
  --dsh-home /absolute/path/to/dsh-home \
  --env-file /absolute/path/to/.env \
  > result.json
```

`--dsh-bin` 和 `--dsh-home` 必填，显式选择运行环境，不使用 SDK 内置 runtime。`--input -` 从 stdin 读取。其他选项：

| 参数 | 默认值／行为 |
|---|---|
| `--profile` | `banso-dsh` |
| `--model` | CLI 参数 → 指定 `.env` 的 `DSH_MODEL` → 进程的 `DSH_MODEL` → `deepseek-v4-flash` |
| `--env-file` | 可选；只读取指定文件，覆盖子进程同名环境变量 |
| `--cwd` | 工作目录，默认当前目录 |
| `--runs-dir` | 日志目录，默认当前目录的 `runs/` |

凭据为 `DEEPSEEK_API_KEY`、`TAVILY_API_KEY` 和可选的 `JINA_API_KEY`。不会自动查找 `.env`；在线运行会调用真实服务。

## 答案与结果

脚本按题型要求模型最终输出以下 JSON，再转换为 TSV：

| 类型 | JSON 结构 |
|---|---|
| `item` | `{"value": "answer"}` |
| `set`、`list` | `{"items": ["A", "B"]}` |
| `table` | `{"columns": ["Name", "Year"], "rows": [["A", "2025"]]}` |

格式逻辑来自 BansoAgain：集合去重，列表保留顺序和重复项，表格检查列名和行宽。仅接受完整 JSON，不从 Markdown 或解释性文字中猜测答案。

stdout 输出一份结果 JSON，包含 `id`、`answer_type`、`status`、`prediction`，以及原始回复、session ID、结束原因、耗时和错误信息。`prediction` 成功时为 TSV 代码块，失败时为 `null`。

| status | 含义 |
|---|---|
| `ok` | 正常结束且格式有效，不代表事实正确 |
| `runtime_error` | SDK 执行或事件保存失败 |
| `incomplete` | 未以 `completed` 结束 |
| `empty_answer` | 最终回复为空 |
| `format_error` | JSON 或表格结构无效 |

退出码：成功 `0`，答题失败 `1`，输入／配置／初始化错误 `2`。诊断写 stderr，事件逐条保存到 `runs/<session_id>/events.jsonl`；失败时结合原始回复和事件排查。

原评分脚本使用 `case_id`，接入时需将结果中的 `id` 映射过去，并保留失败题的统计。

## Python 接口与测试

```python
from banso_eval.answer import answer_case

result = answer_case(harness, {
    "id": 1,
    "question": "What is Python's official website URL?",
    "answer_type": "item",
})
```

调用方创建、配置并关闭 `DeepSeekHarness`；函数可复用该实例，每题新建 session。函数不加载 `.env`；非法输入抛出校验异常，执行及格式错误返回失败结果。

```sh
uv run pytest
```

39 项本地测试使用模拟 SDK并已通过。SDK `0.1.5rc1` + DSH `0.2.0-rc.2` 的独立安装及搜索／阅读链路已人工验证；另用一道自建 `item` 题验证了搜索、阅读、证据提取、最终 JSON 和 TSV 转换。`set/list/table` 尚未在线验收，正式 GISA 题库及标准答案尚未准备，未进行正式评分。

`pyproject.toml` 和 `uv.lock` 纳入版本管理；`.venv/`、缓存、`.env` 和 `runs/` 不提交。
