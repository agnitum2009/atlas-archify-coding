# codegraph × archify 协同管线（可选增强，2026-09-01 定）

> 本页回答一件事：**画图时"代码信息从哪来"的正确取法**。本机制是可选增强——没有 codegraph 时，
> atlas-engine/aac 全部功能照常工作（引擎零 codegraph 依赖；两个配套脚本无 codegraph 时如实报 N/A，不假装绿）。

## 一句话

**codegraph 当探照灯不当尺子：它负责"哪里有、谁调谁"，坐标与内容必须实读真文件。**

## 四步流水线（顺序不可换）

```text
① codegraph 提名            ② 实读定坐标              ③ archify 校验          ④ 账本锚哈希
  files/query/explore         cat / git show             validate + deliver         evidence-add
  callers/callees/impact      行号绝不取自 codegraph        permalink 存在性           行内容哈希
  广度+深度                    精度（坐标/内容）             地址保真                   时间保真
```

- **①提名**：接触不熟代码前先 `codegraph sync`（注意：`codegraph status` 的 up to date 判的是 git 工作树不是索引库——已提交未索引的陈旧对它隐形，不可当新鲜依据），然后 `query`/`explore`/`callers`/`callees`/`impact` 把结构与候选边摊开。
- **②定坐标**：要写进 spec/锚的 `line`/`end_line`，只能来自 `cat`/`git show` 实读。实测教训：索引报 `start_line=12` 实为 `:10`——提名给邻域，**不给行**。
- **③校验**：archify 校验"该行在该 commit 存在"并钉 permalink；它**不验语义**（那行是否真实现该组件）。
- **④时间维**：账本锚 = 行内容哈希（`evidence-add` 自动存）；代码一改锚自动标 `drifted`，doctor/report 点名复核。

## 精度红线（违反=拿探照灯当尺子）

- calls 边 = **I 级提名**（可作候选、不可作裁决）；"无调用者/死代码/唯一实现"这类结论**禁止单凭 codegraph**；
- 常见名/多定义名的 callers 返回并集会串边，须逐实体复核；跨仓连线它看不见，归人工；
- 索引钉版本（当前 1.5.0），升级须重跑精度样本并回查遥测开关。

## 边（connections）没有证据槽，怎么办

图的边（`from`/`to`/`label`）本身不带证据字段——"A 调 B"这类断言在图上是裸的。补齐走账本侧，不改 archify schema：

- **边入账**：把边建成 `kind='meta'` 的账本节点（`state set --kind meta`，0.15.0 起）挂调用点锚；
  A1 的 `a1-unmatched-account` 对 meta 节点跳过（豁免通道早存在），不会误报覆盖缺口；
- **边级对账**：`scripts/reconcile-graph-edges.mjs --spec <图> --sidecar <账> [--strict]` 三方核——
  图有边但码无据（`edge-without-code-evidence`）/ 码有据但图没画（`code-evidence-without-edge`）/ 两边都有（校准）。
  先 warning 不阻断；`--strict` 时发现问题 exit 1（跑稳后可上棘轮）。

## 新鲜度执法（提名器可信的前提）

`scripts/check-codegraph-freshness.mjs --sidecar <账> [--sidecar …] [--repo <仓> …]`：
分母 = `projects.json` 注册表 ∪ 账本锚实际指向的仓（每次现算）；判据 = `.codegraph` 索引 mtime vs `git log -1 %ct`；
**索引落后 >1 天 warning、>3 天红**；无索引仓 = `no-index`（提名能力缺失，warning 不红）；
分母为空报 **N/A 不报 0**（0/0 口径纪律）；停放仓用 `--exempt <名>` 显式豁免（防第二真相）。

## 明确不做

- 不把 codegraph 读进引擎内核（lib/ 零引用保持；可退出=删纪律文本即零残留）；
- 不动 archify schema（外部上游）；
- 不用 codegraph 的行号/存在性当最终证据（提名不是证据）。
