# 十分钟上手（非程序员版）

> 你不需要会写代码。整个体系只做一件事：把项目的进展记成一份机器可校验的账，并且账和图可以互相核对。
> 术语白话：「三轴」= 每个节点挂三块牌子——真相（这事算不算数）、进度（做到哪了）、账务（账结了没）；「侧车」= 记录这些牌子的一个 JSON 文件；「对账」= 拿图和账互查，对不上就报警。
> 下面每一步的命令都能原样复制给 AI 助手（Claude Code / pi / 其他都行）代跑；`<repo>` 指你克隆下来的本仓目录。

## 第一步：确认工具是好的（约 2 分钟）

把下面这句发给 AI 助手：

> 请在 `<repo>` 目录运行 `npm test`，把最后的 pass / fail 两行原样贴给我。

看到 `fail 0` 就说明工具本身没坏。所有测试都在临时目录里跑，不会碰任何真实账本。

## 第二步：生成一份演示账本并看账（约 3 分钟）

把下面这段发给 AI 助手（在任意空目录里执行）：

```bash
node <repo>/bin/atlas-engine.mjs init --dir demo-atlas --title Demo --diagram-id demo-system --template demo
node <repo>/bin/atlas-engine.mjs state active --sidecar demo-atlas/state/atlas-state.json
```

第一条命令建出一个演示图集目录 `demo-atlas/`（七个分区 + 两张演示图 + 一份空账本）。第二条是「看账」：输出里 `unclassified` 下会列出演示节点 `demo-a`，进度是 `planned`（还没开工）——这就是一条账的样子：谁负责（owner）、做到哪（progress）、账结没结（ledger）。

## 第三步：跑一遍「开工 → 挂证据 → 销账」的完整闭环（约 4 分钟）

把这句发给 AI 助手：

> 请在刚才那个目录里，按 `<repo>/docs/USAGE.md` 「三、」小节 `atlas-example` 标记之间的 bash 块原样执行（先 `export ATLAS_ENGINE_BIN=<repo>/bin/atlas-engine.mjs`），然后依次运行 `report --sidecar demo-atlas/state/atlas-state.json` 和 `doctor --sidecar demo-atlas/state/atlas-state.json --atlas demo-atlas`，把两条命令的 `status` 和每条 `checks` 的 `name` / `ok` 原样贴给我。

这段脚本做的事：登记一个任务节点 `demo-task`、把一份回执文件挂成它的证据、然后销账。跑完后：

- `report` 的 `status` 应为 `ok`，说明账本自洽；
- `doctor` 里除了 `archify-kernel` 之外的检查都应为 `ok`。`archify-kernel` 为 `false` 是正常的：图形内核 archify 是另一个独立项目（README 有安装说明），装了它 `gate` 命令才能对图做三闸校验；不装它，账本、状态、证据、经验、轨迹全部照常可用。

## 看完这三步你就知道了

这个体系替你把「说过的」和「做到的」分开记账，并且不许只说不做：声称「已完成」必须挂上证据（文件加行号），那行内容一改，账上立刻标为 `drifted`（漂移）。想深入，读 `specs/ADD-SPEC.md`（全貌）和 `docs/USAGE.md`（用法）。
