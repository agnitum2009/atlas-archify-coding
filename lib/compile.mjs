// compile（command-contract.md §3）：sidecar 状态注入 archify spec。
// 完整+焦点双呈现：默认全图可见（gate 的 visual-check 收容=完整机器证明）；
// 在途节点注入 tag + meta.views 首章「当前焦点」——局部聚焦不丢全局。
// 0.6.1：lifecycle 族 states 同样注入（此前只认 components，生命周期图账不动图）。

import fs from 'node:fs';
import crypto from 'node:crypto';

export const PROGRESS_TAGS = Object.freeze({
  planned: '◐ 计划中',
  in_progress: '▶ 进行中',
  blocked: '⛔ 阻塞',
  verified: '✅ 已销账',
  cancelled: '✕ 已取消',
});

export function compileAtlas(diagram, sidecar) {
  const out = JSON.parse(JSON.stringify(diagram));
  const nodes = (sidecar && sidecar.nodes) || {};
  const focusIds = [];
  let tagged = 0;
  const injectInto = (entry) => {
    const node = nodes[entry.id];
    if (!node) return;
    if (PROGRESS_TAGS[node.progress]) {
      entry.tag = PROGRESS_TAGS[node.progress];
      tagged += 1;
    }
    if (node.progress === 'in_progress') focusIds.push(entry.id);
  };
  // architecture 族 = components；lifecycle 族 = states。图账同 id 约定：
  // 图中节点 id 即侧车节点 id，二者同名才注入（0.6.1 起 lifecycle 也接入
  // 显示契约：完整图 tag 注入 + 当前焦点章节）。
  for (const comp of out.components || []) injectInto(comp);
  for (const state of out.states || []) injectInto(state);
  const rest = Array.isArray(out.meta.views) ? out.meta.views.filter((v) => v.id !== 'current-focus') : [];
  if (focusIds.length > 0) {
    // schema：focus minItems 1、views maxItems 5、label maxLength 48——空焦点不发声章节（不造假焦点）。
    out.meta.views = [
      {
        id: 'current-focus',
        label: '当前焦点（在途 ' + focusIds.length + '）',
        focus: focusIds,
        note: '开发正在推进的节点；完整图保持默认全览',
      },
      ...rest,
    ].slice(0, 5);
  } else {
    out.meta.views = rest.slice(0, 5);
  }
  return { out, tagged, focus: focusIds };
}

export function compileFiles(diagramPath, sidecarPath, outPath) {
  let diagram, sidecar;
  try {
    diagram = JSON.parse(fs.readFileSync(diagramPath, 'utf8'));
    sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  } catch (e) {
    const err = new Error('输入读取或解析失败：' + e.message);
    err.code = 'bad_input';
    throw err;
  }
  const { out, tagged, focus } = compileAtlas(diagram, sidecar);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  const sha256 = crypto.createHash('sha256').update(JSON.stringify(out)).digest('hex');
  return { out: outPath, sha256, injected: { tags: tagged, focus: focus } };
}

