// atlas 数据落点派生 + JSONL 追加（O4/O5，2026-09-14 设计件 docs/OPTIMIZATION_PROPOSAL_2026-09-14.md §2 O4/O5）。
//
// 立法动机：闸运行历史与新鲜度读数此前只活在调用方的重定向/临时文件里（demo-b 实测 run-gates.sh 用 `>`
// 覆盖 /tmp，历史即毁），无法回溯「哪次哪个闸红了」「索引上次真构建于何时」。本模块把落点派生收成
// 单一实现：<atlas>/data/<project>/<file>.jsonl，只追加不覆盖（JSONL = 一行一次运行，可 diff 可 tail）。
//
// atlas 根派生：<atlas>/state/<侧车>.json → <atlas>；侧车直接放 <atlas> 下 → 其所在目录。要求该目录
// 「看起来像 atlas」（state|spec|data|artifacts|evidence|rulings|history 区至少一个存在），否则返回 null
// ——自由侧车（临时目录/未入版式）不落盘，零副作用（与 lib/anchor-roots.mjs 的 opt-in 纪律一致）。
//
// project 名派生（三级，逐级降级并披露 projectSource）：
//   ① 侧车文件名 atlas-<x>.json（x≠state）→ x；
//   ② projects.json 中 sidecar === 本侧车文件名的条目（恰一条 → 该条目 project）；
//   ③ 多条歧义 → 用 hintPath（调用方语境：图件路径 / cwd）落在哪个登记仓 sourcePath 内来选，
//      仍歧义保留侧车 basename，并以 projectReason='registry-ambiguous' 披露；无映射时使用全部登记项目。
import fs from 'node:fs';
import path from 'node:path';
import { readProjectsRegistry } from './projects-registry.mjs';

export const ATLAS_ZONES = ['state', 'spec', 'data', 'artifacts', 'evidence', 'rulings', 'history'];

export function resolveAtlasContext(sidecarPath, { hintPath = null } = {}) {
  if (!sidecarPath) return null;
  const abs = path.resolve(sidecarPath);
  const dir = path.dirname(abs);
  const atlas = path.basename(dir) === 'state' ? path.dirname(dir) : dir;
  if (!ATLAS_ZONES.some((z) => fs.existsSync(path.join(atlas, z)))) return null;
  const base = path.basename(abs);
  const stem = base.replace(/\.json$/, '');
  let project = null;
  let projectSource = null;
  const byName = /^atlas-(.+)\.json$/.exec(base);
  if (byName && byName[1] !== 'state') {
    project = byName[1];
    projectSource = 'sidecar-filename';
  }
  const registryPath = path.join(dir, 'projects.json');
  const registry = readProjectsRegistry(registryPath);
  const valid = registry.entries.filter(e => e && typeof e.project === 'string' && e.project.trim()
    && e.project !== '.' && e.project !== '..' && !/[\\/\x00-\x1f]/.test(e.project));
  const mapped = valid.filter(e => e.sidecar === base);
  const entries = mapped.length ? mapped : valid;
  let projectReason = null;
  if (!project) {
    const names = new Set(entries.map(e => e.project));
    if (names.size === 1) {
      project = entries[0].project;
      projectSource = 'registry';
    } else if (names.size > 1) {
      const hint = path.resolve(hintPath || process.cwd());
      const hit = new Set(entries.filter(e => typeof e.sourcePath === 'string' && e.sourcePath.trim()
        && (hint === path.resolve(e.sourcePath) || hint.startsWith(path.resolve(e.sourcePath) + path.sep))).map(e => e.project));
      if (hit.size === 1) {
        project = [...hit][0];
        projectSource = 'registry-hint';
      } else projectReason = 'registry-ambiguous';
    }
    if (!project) {
      project = stem;
      projectSource = 'fallback-basename';
      projectReason ||= registry.status === 'invalid' ? 'registry-invalid' : 'registry-no-owner';
    }
  }
  return {
    sidecarPath: abs,
    atlas,
    project,
    projectSource,
    ...(projectReason ? { projectReason } : {}),
    dataDir: path.join(atlas, 'data', project),
    registryPath: entries.length > 0 ? registryPath : null,
  };
}

// 只追加一行 JSONL（目录不存在即创建）；返回落点路径。
export function appendJsonl(dataDir, filename, obj) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, filename);
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
  return file;
}
