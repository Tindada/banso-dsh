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

## 运行配置

需要 Python 3.12+、uv，以及已安装的 DSH 和 Banso profile。在本目录执行：

```sh
uv sync --locked
cp .env.example .env  # 已有 .env 时直接编辑，不覆盖
```

在 `evaluation/.env` 中填写：

```dotenv
EVAL_DSH_BIN=/absolute/path/to/node_modules/.bin/dsh
EVAL_DSH_HOME=/absolute/path/to/dsh-home
EVAL_DSH_PROFILE=banso-dsh
EVAL_DSH_MODEL=deepseek-flash
DEEPSEEK_API_KEY=...
TAVILY_API_KEY=...
JINA_API_KEY=...
```

`EVAL_DSH_BIN`、`EVAL_DSH_HOME` 必填；profile 默认 `banso-dsh`，模型默认 `deepseek-flash`。Jina 密钥可选。运行配置只读取这份固定 `.env`；其中的值覆盖子进程同名环境变量，不读取进程里的 `EVAL_DSH_MODEL` 作为模型选择。

答题 CLI 仅保留三个参数：

| 参数 | 含义 |
|---|---|
| `--input` | 题目 JSONL，默认 `data/gisa/derived/cases_60.jsonl` |
| `--output` | 必填；本次运行目录，首次运行要求不存在 |
| `--resume` | 续跑已有目录，跳过所有已记录题目 |

单题和多题使用同一个入口，一行一道题，不支持 stdin。所有相对路径均相对 `evaluation/`，SDK 工作目录也固定为此目录。题目文件应位于 `<题库目录>/derived/`，数据版本自动读取 `<题库目录>/source.json`；自建题目也使用这一结构，并填写自己的来源记录。

例如单题：

```sh
uv run python -m banso_eval.batch \
  --input data/gisa/derived/case_5.jsonl --output runs/single_5
```

运行会调用真实服务；`.env` 不提交。

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

uv run python -m banso_eval.batch --output runs/gisa_60_001

uv run python -m banso_eval.score runs/gisa_60_001/results.jsonl \
  --cases runs/gisa_60_001/cases.jsonl \
  --output runs/gisa_60_001/scoring
```

准备步骤只写入 `derived/`，不创建运行目录。批量入口默认读取 `data/gisa/derived/cases_60.jsonl`（可用 `--input` 覆盖），开始测评时才创建 `runs/<运行名>/` 并复制题目快照。

单题和多题采用相同的运行配置与产物结构。结果目录保存 `manifest.json`、`cases.jsonl`、逐题追加的 `results.jsonl`、`sessions/<session_id>/events.jsonl` 和完成后的 `summary.json`。manifest 记录题库版本、选题内容哈希及运行参数，不保存环境变量或密钥。

中断后使用相同命令加 `--resume`，跳过所有已记录题目（包括失败），不自动重试。启动前检查选题与运行参数是否一致；不要同时向同一目录运行两个进程。若结果末行因异常关机损坏，会拒绝续跑，需先检查并移走不完整末行。续跑仍需自行保持插件版本和环境配置一致；当前未实现与旧 Banso 等价的研究预算或整题超时。

评分采用原项目的纯离线逻辑，兼容新 `id` 和旧 `case_id`；以选题全集为分母，缺失和失败预测按零分计入，重复或额外 ID 报错。输出目录必须不存在，避免覆盖历史评分。可用旧 `results.jsonl` 路径重新评分旧预测，对齐当前标准答案；不会修改原项目。评分默认使用同一份 `cases_60.jsonl`，可用 `--cases` 指定运行目录内的 `cases.jsonl` 快照；`--answer-dir` 指定标准答案目录。评分入口仍支持 `--source` 指定数据版本记录；答题入口从题库目录自动读取。

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

58 项本地测试已通过，使用模拟 SDK 验证答题、批量续跑和离线评分。两组旧 60 题预测已用当前标准答案重评，120 条逐题评分均与旧记录一致。SDK `0.1.5rc1` + DSH `0.2.0-rc.2` 的独立安装及搜索／阅读链路已人工验证；另用一道自建 `item` 题验证了搜索、阅读、证据提取、最终 JSON 和 TSV 转换。`set/list/table` 尚未在线验收，尚未对当前 DSH 运行正式测评。

`pyproject.toml` 和 `uv.lock` 纳入版本管理；`.venv/`、缓存、`.env` 和 `runs/` 不提交。
