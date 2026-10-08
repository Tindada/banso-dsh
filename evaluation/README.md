# GISA 测评

流程分为三个独立阶段，通过文件衔接，不自动重试或修复答案。

| 阶段 | 实现 | 输入 → 输出 |
|---|---|---|
| 题目准备 | `scripts/prepare_gisa.py` | 加密题库、可选 ID 清单 → 解密后的题目 JSONL |
| 答题执行 | `answer.py`、`gisa_format.py`、`batch.py` | 题目、DSH 配置 → 预测结果、运行配置和事件日志 |
| 离线评分 | `score.py`、`gisa_scoring.py` | 题目 ID／题型、预测、标准答案 → 逐题评分和汇总 |

准备脚本仅依赖标准库；答题阶段不读取标准答案；评分阶段不导入 SDK 或答题模块，也不需要题目原文。评分算法是经原 Banso 迁入的官方算法本地改编版，并非直接调用官方原文件。

## 准备正式题库

将官方 `RUC-NLPIR/GISA` 数据下载到 `data/gisa/raw/` 后，在本目录执行：

```sh
uv run python scripts/prepare_gisa.py
```

脚本沿用 BansoAgain 的解密和校验逻辑，仅依赖标准库；检查题目字段及答案、参考轨迹的文件 ID，输出 `data/gisa/derived/questions.jsonl`（每行一道题，不含标准答案）。可用 `--input`、`--answer-dir`、`--trace-dir`、`--output` 覆盖路径。答题入口读取准备好的 JSONL，一行一道题。

`data/gisa/source.json` 记录本地下载版本；数据放在 `data/`，测评输出放在 `runs/`，均不提交。

## 运行

需要 Python 3.12+、uv，以及已安装的 DSH 和 Banso profile。在本目录执行：

```sh
uv sync --locked
```

单题和多题统一使用 `banso_eval.batch`，题目数量由输入 JSONL 的行数决定。例如准备一个只有一行的 `data/gisa/derived/smoke.jsonl`：

```json
{"id": 1, "question": "What is Python's official website URL?", "answer_type": "item"}
```

```sh
uv run python -m banso_eval.batch \
  --input data/gisa/derived/smoke.jsonl \
  --output runs/smoke_001 \
  --dsh-bin /absolute/path/to/node_modules/.bin/dsh \
  --dsh-home /absolute/path/to/dsh-home \
  --env-file /absolute/path/to/.env
```

`--dsh-bin` 和 `--dsh-home` 必填，显式选择运行环境，不使用 SDK 内置 runtime。`--output` 指定新的运行目录；续跑时指定同一目录并加 `--resume`。输入仅支持 JSONL 文件，不从 stdin 读取。

| 参数 | 默认值／行为 |
|---|---|
| `--input` | `data/gisa/derived/cases_60.jsonl` |
| `--profile` | `banso-dsh` |
| `--model` | CLI 参数 → 指定 `.env` 的 `DSH_MODEL` → 进程的 `DSH_MODEL` → `deepseek-v4-flash` |
| `--env-file` | 可选；只读取指定文件，覆盖子进程同名环境变量 |
| `--cwd` | 工作目录，默认当前目录 |
| `--source` | `data/gisa/source.json`，记录使用的数据版本；自建题目可指定自己的来源 JSON |

凭据为 `DEEPSEEK_API_KEY`、`TAVILY_API_KEY` 和可选的 `JINA_API_KEY`。不会自动查找 `.env`；在线运行会调用真实服务。

## 答案与结果

脚本按题型要求模型最终输出以下 JSON，再转换为 TSV：

| 类型 | JSON 结构 |
|---|---|
| `item` | `{"value": "answer"}` |
| `set`、`list` | `{"items": ["A", "B"]}` |
| `table` | `{"columns": ["Name", "Year"], "rows": [["A", "2025"]]}` |

格式逻辑来自 BansoAgain：集合去重，列表保留顺序和重复项，表格检查列名和行宽。仅接受完整 JSON，不从 Markdown 或解释性文字中猜测答案。

每题结果追加到运行目录的 `results.jsonl`，包含 `id`、`answer_type`、`status`、`prediction`，以及原始回复、session ID、结束原因、耗时和错误信息。`prediction` 成功时为 TSV 代码块，失败时为 `null`。

| status | 含义 |
|---|---|
| `ok` | 正常结束且格式有效，不代表事实正确 |
| `runtime_error` | SDK 执行或事件保存失败 |
| `incomplete` | 未以 `completed` 结束 |
| `empty_answer` | 最终回复为空 |
| `format_error` | JSON 或表格结构无效 |

stdout 输出运行汇总 JSON，诊断写 stderr。事件逐条保存到运行目录的 `sessions/<session_id>/events.jsonl`；失败时结合原始回复和事件排查。

离线评分入口兼容本项目的 `id` 和旧 Banso 的 `case_id`。

## 同一批 60 题

`scripts/banso_60.json` 固定原 Banso 两组运行的 60 个 ID（item 4、set 8、list 8、table 40）。其中 60 道原文已与旧运行轨迹逐字核对；旧数据集 revision 和标准答案版本无法确认。

在本目录先准备 60 题文件，再启动测评：

```sh
uv run python scripts/prepare_gisa.py --selection scripts/banso_60.json \
  --output data/gisa/derived/cases_60.jsonl

uv run python -m banso_eval.batch --output runs/gisa_60_001 \
  --dsh-bin /absolute/path/to/node_modules/.bin/dsh \
  --dsh-home /absolute/path/to/dsh-home \
  --env-file /absolute/path/to/.env

uv run python -m banso_eval.score runs/gisa_60_001/results.jsonl \
  --cases runs/gisa_60_001/cases.jsonl \
  --output runs/gisa_60_001/scoring
```

准备步骤只写入 `derived/`，不创建运行目录。批量入口默认读取 `data/gisa/derived/cases_60.jsonl`（可用 `--input` 覆盖），开始测评时才创建 `runs/<运行名>/` 并复制题目快照。

单题和多题采用相同的运行配置与产物结构。结果目录保存 `manifest.json`、`cases.jsonl`、逐题追加的 `results.jsonl`、`sessions/<session_id>/events.jsonl` 和完成后的 `summary.json`。manifest 记录题库版本、选题内容哈希及运行参数，不保存环境变量或密钥。

中断后使用相同命令加 `--resume`，跳过所有已记录题目（包括失败），不自动重试。启动前检查选题与运行参数是否一致；不要同时向同一目录运行两个进程。若结果末行因异常关机损坏，会拒绝续跑，需先检查并移走不完整末行。续跑仍需自行保持插件版本和环境配置一致；当前未实现与旧 Banso 等价的研究预算或整题超时。

评分采用原项目的纯离线逻辑，兼容新 `id` 和旧 `case_id`；以选题全集为分母，缺失和失败预测按零分计入，重复或额外 ID 报错。输出目录必须不存在，避免覆盖历史评分。可用旧 `results.jsonl` 路径重新评分旧预测，对齐当前标准答案；不会修改原项目。评分默认使用同一份 `cases_60.jsonl`，可用 `--cases` 指定运行目录内的 `cases.jsonl` 快照；`--answer-dir` 指定标准答案目录。批量和评分均支持 `--source` 指定数据版本记录。

退出码：批量全部成功 `0`，存在答题失败 `1`，配置／文件错误 `2`，中断 `130`；评分正常执行为 `0`，错误为 `2`，分数低不影响退出码。

## Python 接口与测试

```python
from banso_eval.answer import answer_case

result = answer_case(harness, {
    "id": 1,
    "question": "What is Python's official website URL?",
    "answer_type": "item",
})
```

`answer.py` 仅提供 Python API，没有单独的命令行入口。调用方创建、配置并关闭 `DeepSeekHarness`；函数可复用该实例，每题新建 session。函数不加载 `.env`；非法输入抛出校验异常，执行及格式错误返回失败结果。

```sh
uv run pytest
```

54 项本地测试已通过，使用模拟 SDK 验证答题、批量续跑和离线评分。两组旧 60 题预测已用当前标准答案重评，120 条逐题评分均与旧记录一致。SDK `0.1.5rc1` + DSH `0.2.0-rc.2` 的独立安装及搜索／阅读链路已人工验证；另用一道自建 `item` 题验证了搜索、阅读、证据提取、最终 JSON 和 TSV 转换。`set/list/table` 尚未在线验收，尚未对当前 DSH 运行正式测评。

`pyproject.toml` 和 `uv.lock` 纳入版本管理；`.venv/`、缓存、`.env` 和 `runs/` 不提交。
