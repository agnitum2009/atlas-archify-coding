// P-2（0.15.0，边级对账）回归钉：无端点/有据/无据/漏边/降级 全测。
// 夹具里的 codegraph.db 用 node:sqlite 现场建（与真实索引同 schema 的最小面），
// Node <22 环境下该文件无法建 → 断言降级为 N/A 不谎报。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = new URL('../scripts/reconcile-graph-edges.mjs', import.meta.url).pathname;
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node <22 */ }

function run(args) {
  const res = spawnSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8' });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 文本模式 */ }
  return { code: res.status, receipt, out: res.stdout + res.stderr };
}

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-recon-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  spawnSync('git', ['-C', repo, 'init', '-q'], { encoding: 'utf8' });
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, 'src', 'b.ts'), 'import { a } from "./a.ts";\nexport const b = a;\n');
  fs.writeFileSync(path.join(repo, 'src', 'c.ts'), 'export const c = 1;\n');
  // 最小同 schema 索引：nodes(files/symbols) + edges(a→b calls)
  const dbPath = path.join(repo, '.codegraph', 'codegraph.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, qualified_name TEXT, file_path TEXT, language TEXT, start_line INTEGER, end_line INTEGER);
           CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, metadata TEXT, line INTEGER, col INTEGER, provenance TEXT);`);
  db.prepare('INSERT INTO nodes (id,kind,name,file_path) VALUES (?,?,?,?)')
    .run('n:a', 'file', 'a.ts', 'src/a.ts');
  db.prepare('INSERT INTO nodes (id,kind,name,file_path) VALUES (?,?,?,?)')
    .run('n:b', 'file', 'b.ts', 'src/b.ts');
  db.prepare('INSERT INTO nodes (id,kind,name,file_path) VALUES (?,?,?,?)')
    .run('n:c', 'file', 'c.ts', 'src/c.ts');
  db.prepare('INSERT INTO edges (source,target,kind) VALUES (?,?,?)')
    .run('n:b', 'n:a', 'imports'); // b 引 a：b→a 有据
  db.close();
  // 侧车：三个节点，a/b 有锚，c 有锚（但 c 与谁都无边）
  const sc = path.join(dir, 'sc.json');
  fs.writeFileSync(sc, JSON.stringify({ schemaVersion: 1, revision: 1, nodes: {
    'comp-a': { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [path.join(repo, 'src/a.ts') + ':1'], history: [] },
    'comp-b': { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [path.join(repo, 'src/b.ts') + ':1'], history: [] },
    'comp-c': { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [path.join(repo, 'src/c.ts') + ':1'], history: [] },
  } }));
  // 图：b→a 画了对的边；b→c 画了但码无据；a→? 漏边（b 引 a 这条有）
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x' },
    components: [
      { id: 'comp-a', type: 'backend', label: 'A', pos: [0, 0], size: [200, 100] },
      { id: 'comp-b', type: 'backend', label: 'B', pos: [300, 0], size: [200, 100] },
      { id: 'comp-c', type: 'backend', label: 'C', pos: [600, 0], size: [200, 100] },
    ],
    connections: [
      { id: 'e-ba', from: 'comp-b', to: 'comp-a', label: '引 a' },
      { id: 'e-bc', from: 'comp-b', to: 'comp-c', label: '引 c（其实没有）' },
    ] }));
  return { dir, repo, sc, spec };
}

const hasSqlite = DatabaseSync !== null;

test('边级对账：有据边校准 + 无据边点名 + 无端点记 + 漏边提示', { skip: !hasSqlite && 'node:sqlite 不可用（Node <22）' }, () => {
  const { sc, spec } = makeFixture();
  const r = run(['--spec', spec, '--sidecar', sc, '--json']);
  assert.equal(r.code, 0, r.out);
  const d = r.receipt.data;
  assert.equal(d.connections, 2);
  assert.equal(d.calibrated, 1, 'b→a 应有据：' + JSON.stringify(d));
  assert.equal(d.withoutEvidence, 1, 'b→c 应无据：' + JSON.stringify(d));
  const we = r.receipt.diagnostics.find((x) => x.rule === 'edge-without-code-evidence');
  assert.ok(we && we.subject === 'e-bc');
  assert.ok(we.supportedFixes.length >= 1, '无据边须附处置路径');
  // 漏边：c 锚文件与 a/b 无边，b→a 已有边被图覆盖 → 漏边应为 0（无新增未覆盖边）
  assert.equal(d.withoutEdge, 0, JSON.stringify(d));
});

test('漏边：码有据而图未画 → code-evidence-without-edge（I 级提名，不自动改图）', { skip: !hasSqlite && 'node:sqlite 不可用' }, () => {
  const { sc, spec, dir } = makeFixture();
  const spec2 = path.join(dir, 'spec2.json');
  const base = JSON.parse(fs.readFileSync(spec, 'utf8'));
  base.connections = base.connections.filter((c) => c.id !== 'e-ba');
  fs.writeFileSync(spec2, JSON.stringify(base));
  const r = run(['--spec', spec2, '--sidecar', sc, '--json']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.receipt.data.withoutEdge >= 1, true, 'b→a 有据但图未画须提示：' + JSON.stringify(r.receipt.data));
  const f = r.receipt.diagnostics.find((x) => x.rule === 'code-evidence-without-edge');
  assert.ok(f, '漏边须入诊断');
  // 2026-09-10 triage：漏边须带「锚型分类」事实标註（不改提名口径，只让噪声自解释）
  const byClass = r.receipt.data.withoutEdgeByClass;
  assert.ok(byClass && Object.keys(byClass).length >= 1, '漏边须带分类计数：' + JSON.stringify(byClass));
  const summed = Object.values(byClass).reduce((a, b) => a + b, 0);
  assert.equal(summed, r.receipt.data.withoutEdge, '分类计数之和须等于漏边总数');
  assert.ok(f.evidence.includes('分类='), '漏边证据须含分类标註：' + f.evidence);
});

test('workflow 图 edges[] 一并入账（不因缺 connections 而漏读）', { skip: !hasSqlite && 'node:sqlite 不可用' }, () => {
  const { sc, dir } = makeFixture();
  const wf = path.join(dir, 'wf.json');
  fs.writeFileSync(wf, JSON.stringify({
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'wf' },
    nodes: [],
    edges: [{ id: 'w1', from: 'comp-b', to: 'comp-a' }],
  }));
  const r = run(['--spec', wf, '--sidecar', sc, '--json']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.receipt.data.connections, 1, 'workflow edges[] 必须计入：' + JSON.stringify(r.receipt.data));
  assert.equal(r.receipt.data.calibrated, 1, 'b→a 在码上有据 → 应校准：' + JSON.stringify(r.receipt.data));
});

test('降级与诚实：Node<22/无索引/无端点全部如实记，exit 0 不谎报', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-na-'));
  const spec = path.join(dir, 's.json');
  const sc = path.join(dir, 'c.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x' }, components: [], connections: [] }));
  fs.writeFileSync(sc, '{"schemaVersion":1,"nodes":{},"revision":0}');
  const r = run(['--spec', spec, '--sidecar', sc, '--json']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.receipt.status, 'ok');
  assert.match(r.receipt.data.note || '', /无对象/, '空 spec 须明说：' + JSON.stringify(r.receipt.data));
});

test('用法守卫：缺 --spec 或 --sidecar → exit 2（不猜路径）', () => {
  const r = run(['--json']);
  assert.equal(r.code, 2);
  assert.equal(r.receipt.diagnostics[0].rule, 'bad_args');
});

test('跨仓边归人工：不计入「无据」，单列 crossRepo（2026-09-10 triage）', { skip: !hasSqlite && 'node:sqlite 不可用' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-recon-xrepo-'));
  const mk = (name) => {
    const repo = path.join(dir, name);
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    spawnSync('git', ['-C', repo, 'init', '-q'], { encoding: 'utf8' });
    fs.writeFileSync(path.join(repo, 'src', 'x.ts'), 'export const x = 1;\n');
    // 最小同 schema 索引（无跨文件边）：使该仓成为「有索引仓」→ 才能判为跨仓
    const dbPath = path.join(repo, '.codegraph', 'codegraph.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, qualified_name TEXT, file_path TEXT, language TEXT, start_line INTEGER, end_line INTEGER);
             CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, kind TEXT, metadata TEXT, line INTEGER, col INTEGER, provenance TEXT);`);
    db.prepare('INSERT INTO nodes (id,kind,name,file_path) VALUES (?,?,?,?)').run('n:x', 'file', 'x.ts', 'src/x.ts');
    db.close();
    return repo;
  };
  const repoA = mk('repoA');
  const repoB = mk('repoB');
  const sc = path.join(dir, 'sc.json');
  fs.writeFileSync(sc, JSON.stringify({ schemaVersion: 1, revision: 1, nodes: {
    'comp-a': { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [path.join(repoA, 'src/x.ts') + ':1'], history: [] },
    'comp-b': { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [path.join(repoB, 'src/x.ts') + ':1'], history: [] },
  } }));
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x' },
    components: [
      { id: 'comp-a', type: 'backend', label: 'A', pos: [0, 0], size: [200, 100] },
      { id: 'comp-b', type: 'backend', label: 'B', pos: [300, 0], size: [200, 100] },
    ],
    connections: [{ id: 'e-ab', from: 'comp-a', to: 'comp-b', label: '跨仓' }] }));
  const r = run(['--spec', spec, '--sidecar', sc, '--json']);
  assert.equal(r.code, 0, r.out);
  const d = r.receipt.data;
  assert.equal(d.crossRepo, 1, '跨仓边须单列：' + JSON.stringify(d));
  assert.equal(d.withoutEvidence, 0, '跨仓边不得计入无据：' + JSON.stringify(d));
  const f = r.receipt.diagnostics.find((x) => x.rule === 'edge-cross-repo-manual');
  assert.ok(f, '跨仓边须入诊断（归人工）');
  assert.ok(f.supportedFixes.length >= 1, '跨仓边须附人工核对路径');
});

test('图内自锚归该类：两端锚皆指向 spec 自身（无代码索引仓）→ 不计入「无据」（2026-09-10 triage）', { skip: !hasSqlite && 'node:sqlite 不可用' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-recon-specanchor-'));
  const dataRoot = path.join(dir, 'atlas');
  fs.mkdirSync(path.join(dataRoot, 'spec'), { recursive: true });
  spawnSync('git', ['-C', dataRoot, 'init', '-q'], { encoding: 'utf8' });
  const spec = path.join(dataRoot, 'spec', 'g.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x' },
    components: [
      { id: 'v-a', type: 'note', label: 'A', pos: [0, 0], size: [200, 100] },
      { id: 'v-b', type: 'note', label: 'B', pos: [300, 0], size: [200, 100] },
    ],
    connections: [{ id: 'e-ab', from: 'v-a', to: 'v-b', label: '声明性' }] }));
  const sc = path.join(dir, 'sc.json');
  fs.writeFileSync(sc, JSON.stringify({ schemaVersion: 1, revision: 1, nodes: {
    'v-a': { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [spec + ':4'], history: [] },
    'v-b': { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [spec + ':5'], history: [] },
  } }));
  const r = run(['--spec', spec, '--sidecar', sc, '--json']);
  assert.equal(r.code, 0, r.out);
  const d = r.receipt.data;
  assert.equal(d.specAnchored, 1, '图内自锚须单列：' + JSON.stringify(d));
  assert.equal(d.withoutEvidence, 0, '图内自锚不得计入无据：' + JSON.stringify(d));
  assert.equal(d.crossRepo, 0, '同仓不算跨仓：' + JSON.stringify(d));
  const f = r.receipt.diagnostics.find((x) => x.rule === 'edge-spec-anchored');
  assert.ok(f, '图内自锚须入诊断');
});
