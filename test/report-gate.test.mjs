// report + gate 牙齿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildReport } from '../lib/report.mjs';
import { runGate } from '../lib/gate.mjs';
import { writeFakeArchify } from './fake-archify.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;

function runCli(args, env) {
  const res = spawnSync(process.execPath, [BIN].concat(args), { encoding: 'utf8', env: { ...process.env, ...(env || {}) } });
  let receipt = null;
  try { receipt = JSON.parse(res.stdout); } catch { /* 留空 */ }
  return { code: res.status, receipt, stdout: res.stdout };
}

test('buildReport：聚合状态迁移与证据 lint；A3 违规=error；缺 SHA=warning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-test-'));
  const ev = path.join(dir, 'ev.ts');
  fs.writeFileSync(ev, 'x\n');
  const rel = path.relative(process.cwd(), ev);
  const sidecar = {
    schemaVersion: 1,
    nodes: {
      good: { owner: 'o', truth: 'candidate', progress: 'verified', ledger: 'settled', evidence: [rel + ':1'], history: [{ at: 't', kind: 'settle', from: {}, to: {} }] },
      bad: { owner: 'o', truth: 'candidate', progress: 'verified', ledger: 'settled', evidence: [], history: [] },
    },
  };
  const r = buildReport(sidecar, { root: process.cwd(), codeSha: 'abc', specSha: 'def' });
  assert.equal(r.state_changes, 1);
  assert.equal(r.nodes.length, 2);
  assert.equal(r.shas.code, 'abc');
  assert.equal(r.lessons.count, 0);
  const a3 = r.errors.find((e) => e.rule === 'verified_requires_evidence');
  assert.ok(a3, 'A3 违规应报 error');
  // 0.17.0 存量清洗：bad 节点 settled 但 history 无 settle/import 事件 → import_unmarked warning（不阻断）
  assert.deepEqual(r.warnings.map((w) => w.rule), ['import_unmarked']);
  assert.equal(r.warnings[0].subject, 'bad');

  const noSha = buildReport(sidecar, { root: process.cwd() });
  assert.equal(noSha.warnings.filter((w) => w.rule === 'missing_code_sha').length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildReport：slice 过滤单节点', () => {
  const sidecar = { schemaVersion: 1, nodes: { n1: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] }, n2: { owner: 'o', truth: 'candidate', progress: 'planned', ledger: 'clean', evidence: [], history: [] } } };
  const r = buildReport(sidecar, { slice: 'n1' });
  assert.equal(r.nodes.length, 1);
  assert.equal(r.nodes[0].node, 'n1');
});

test('runGate：假内核（exit 0 + 无回执契约 + 无 HTML）→ fail，绝不伪装 pass（缺陷7 核心回归）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-fake-kernel-'));
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x' }, components: [{ id: 'a', name: 'A' }] }));
  // 旧实现在此判 pass（只看 exit code）：假内核输出 {status:'failed'}、exit 0、不产 HTML。
  const fake = path.join(dir, 'fake.mjs');
  fs.writeFileSync(fake, 'console.log(JSON.stringify({ status: "failed" }));\nprocess.exit(0);\n');
  const r = runGate(spec, path.join(dir, 'out.html'), fake);
  assert.equal(r.final, 'fail');
  assert.equal(r.stage, 'validate');
  assert.equal(r.reason, 'validate-receipt');
  assert.ok(r.tail.includes('内核回执'), r.tail);
  assert.equal(fs.existsSync(path.join(dir, 'out.html')), false, '不得产出「成功」假象');

  // 假内核自称成功（ok:true）但产物不存在 → deliver 归属校验拦下
  const fake2 = writeFakeArchify(dir, 'fake2.mjs', { mutateOutPath: 'false' });
  const r2 = runGate(spec, path.join(dir, 'out2.html'), fake2);
  assert.equal(r2.final, 'fail');
  assert.equal(r2.reason, 'deliver-artifact-missing', r2.tail);

  // 假内核回执 artifact 摘要与磁盘不符 → 拦下
  const fake3 = writeFakeArchify(dir, 'fake3.mjs', { extraDeliver: "{ artifact: { sha256: 'deadbeef', bytes: 3 } }" });
  const r3 = runGate(spec, path.join(dir, 'out3.html'), fake3);
  assert.equal(r3.reason, 'deliver-artifact-mismatch', r3.tail);

  // 成功路径：契约合规内核 → pass，且 visualReview 仍为 pending（人工边界不被自动证据吞掉）
  const fake4 = writeFakeArchify(dir, 'fake4.mjs');
  const r4 = runGate(spec, path.join(dir, 'out4.html'), fake4);
  assert.equal(r4.final, 'pass', JSON.stringify(r4.results));
  assert.equal(r4.visualReview, 'pending', '自动证据不得声称感知级复核');
  assert.equal(r4.results.validate.receipt.checkCount, 1);
  assert.equal(r4.results.deliver.receipt.checksPassed, 1);
  assert.equal(r4.results.visual_check.receipt.status, 'pass');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runGate：visual-check 子项失败/被跳过 → fail（不把 skipped 当 pass）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-vc-skip-'));
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x' }, components: [] }));
  // status=skipped（Chrome 不可用，真实内核 exit 2 / 回执 status='skipped'）
  const skipped = path.join(dir, 'skipped.mjs');
  fs.writeFileSync(skipped, `import fs from 'node:fs';import crypto from 'node:crypto';
const argv = process.argv.slice(2);const sha=(b)=>crypto.createHash('sha256').update(b).digest('hex');
if (argv[0]==='validate'){console.log(JSON.stringify({schemaVersion:1,ok:true,command:'validate',input:argv[2],checks:[{ok:true}],composition:{profile:'showcase',status:'pass',summary:{errors:0,warnings:0}}}));process.exit(0);}
if (argv[0]==='deliver'){const html='<html></html>';fs.writeFileSync(argv[3],html);const sp=fs.readFileSync(argv[2]);console.log(JSON.stringify({schemaVersion:1,ok:true,command:'deliver',input:argv[2],output:argv[3],specification:{sha256:sha(sp),bytes:sp.byteLength},artifact:{sha256:sha(Buffer.from(html)),bytes:html.length},validation:{checksPassed:1,checkCount:1,errors:0,compositionStatus:'pass'}}));process.exit(0);}
if (argv[0]==='visual-check'){console.log(JSON.stringify({schemaVersion:1,ok:false,command:'visual-check',status:'skipped',visualReview:'pending',artifact:{path:argv[1]},error:'Chrome or Chromium is unavailable.',containment:{status:'skipped'},readability:{status:'skipped'},viewerChrome:{status:'skipped'},captures:{status:'skipped'}}));process.exit(2);}
process.exit(1);
`);
  const r = runGate(spec, path.join(dir, 'o.html'), skipped);
  assert.equal(r.final, 'fail');
  assert.equal(r.reason, 'visual-check-skipped');
  assert.equal(r.results.visual_check.status, 'skipped');
  assert.ok(r.tail.includes('Chrome'), r.tail);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runGate：archify 缺失或非法 spec → fail 停在 validate，绝不伪装 pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x', quality_profile: 'showcase' }, components: [] }));
  const r1 = runGate(bad, path.join(dir, 'out.html'));
  assert.equal(r1.final, 'fail');
  assert.ok(['validate', 'archify-missing'].includes(r1.stage));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runGate：坏内核诊断可诊断（0.8.0 修复）——stderr 尾部进 tail；静默坏内核明写「内核无输出+已解析路径」，绝不空白', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-badkernel-'));
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x', quality_profile: 'showcase' }, components: [{ id: 'a', name: 'A' }] }));

  // A：非 archify 的文件——node 把 SyntaxError 打到 stderr（修复前只盯 stdout → tail 空白）。
  const noisy = path.join(dir, 'not-archify.mjs');
  fs.writeFileSync(noisy, '这不是 archify 可执行文件\n');
  const r1 = runGate(spec, path.join(dir, 'out.html'), noisy);
  assert.equal(r1.final, 'fail');
  assert.equal(r1.stage, 'validate');
  assert.ok(r1.tail && r1.tail.includes('[stderr]'), 'stderr 尾部必须进 tail：' + JSON.stringify(r1));
  assert.ok(r1.tail.includes('SyntaxError'), r1.tail);
  assert.ok(r1.tail.length <= 910, 'tail 合计 ≤900（容许标签字符余量）：' + r1.tail.length);

  // B：静默坏内核（exit 1 零输出）——明写无输出 + 已解析路径（source → 路径）。
  const silent = path.join(dir, 'silent.mjs');
  fs.writeFileSync(silent, 'process.exit(1);\n');
  const r2 = runGate(spec, path.join(dir, 'out.html'), silent);
  assert.equal(r2.final, 'fail');
  assert.equal(r2.stage, 'validate');
  assert.ok(r2.tail.includes('内核无输出（可能不是 archify 可执行文件）'), r2.tail);
  assert.ok(r2.tail.includes('已解析路径=override → ' + silent), r2.tail);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runGate：二进制内核消息可行动化（0.10.0，holdout #2 P2a）——tail 零不可打印字节 + 注明过滤数 + 无条件附已解析路径', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-binkernel-'));
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x', quality_profile: 'showcase' }, components: [{ id: 'a', name: 'A' }] }));

  // 二进制内核（holdout #2 实测场景：ARCHIFY_BIN=/bin/ls）——node 把 ELF 源行回显进 SyntaxError 栈，
  // 修复前 tail 918 字符里 23% 是不可打印字节且不含已解析路径。
  const r = runGate(spec, path.join(dir, 'out.html'), '/bin/ls');
  assert.equal(r.final, 'fail');
  assert.equal(r.stage, 'validate');
  assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/.test(r.tail), 'tail 不得含不可打印字节（\\n\\t 保留）：' + JSON.stringify(r.tail.slice(0, 120)));
  assert.ok(r.tail.includes('（已过滤 '), '须注明已过滤不可打印字节数：' + r.tail);
  assert.ok(r.tail.includes('已解析路径=override → /bin/ls'), '须无条件附已解析路径与来源：' + r.tail);
  assert.ok(r.tail.length <= 910, 'tail 合计 ≤900（容许标签字符余量，注记行计入预算）：' + r.tail.length);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate --out 落点 warning（0.10.0，holdout #2 P0）：直落 atlas 的 artifacts/<项目>/ 根 → 回执带 gate_out_placement；模块目录/非 atlas 不触发', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-placement-'));
  // 最小 atlas：spec/<项目>/ + artifacts/<项目>/（gate 本身不校验布局，warning 只认落点形状）。
  fs.mkdirSync(path.join(dir, 'spec', 'demo'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'artifacts', 'demo'), { recursive: true });
  const spec = path.join(dir, 'spec', 'demo', 'demo.json');
  fs.writeFileSync(spec, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'x', quality_profile: 'showcase' }, components: [{ id: 'a', name: 'A' }] }));
  // 缺陷7：gate 现在校验内核回执契约 + 产物本轮归属，空壳 exit-0 stub 不再代表「成功内核」。
  const stub = writeFakeArchify(dir, 'archify-stub.mjs');
  const now = new Date();
  const stamp = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');

  // ① 直落项目根 → warning（修复前：gate exit 0 零提示，doctor --atlas 随后 7 条 P2 error）。
  const hit = runCli(['gate', '--diagram', spec, '--out', path.join(dir, 'artifacts', 'demo', 'x.html'), '--no-trace'], { ARCHIFY_BIN: stub });
  assert.equal(hit.code, 0, '不阻断不改退出码；' + hit.stdout);
  const placed = (hit.receipt.diagnostics || []).filter((d) => d.rule === 'gate_out_placement');
  assert.equal(placed.length, 1, '项目根落点须出一条 gate_out_placement warning');
  assert.equal(placed[0].severity, 'warning');
  assert.ok(placed[0].evidence.includes('artifacts/demo/<模块>-' + stamp + '/'), '消息给出建议路径（日期取当天）：' + placed[0].evidence);
  assert.ok(placed[0].evidence.includes('布局 P2'), '消息说明直落项目根会触发布局 P2');

  // ② 模块目录落点 → 不触发（推荐路径本身）。
  const mod = runCli(['gate', '--diagram', spec, '--out', path.join(dir, 'artifacts', 'demo', 'loops-' + stamp, 'x.html'), '--no-trace'], { ARCHIFY_BIN: stub });
  assert.equal(mod.code, 0, mod.stdout);
  assert.ok(!(mod.receipt.diagnostics || []).some((d) => d.rule === 'gate_out_placement'), '模块目录落点不出 warning');

  // ③ 祖父目录名为 artifacts 但图谱根下无 spec/<项目>/（非 atlas 项目根，路径撞名）→ 不触发。
  const alien = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-placement-alien-'));
  fs.mkdirSync(path.join(alien, 'artifacts', 'ghost'), { recursive: true });
  const miss = runCli(['gate', '--diagram', spec, '--out', path.join(alien, 'artifacts', 'ghost', 'x.html'), '--no-trace'], { ARCHIFY_BIN: stub });
  assert.equal(miss.code, 0, miss.stdout);
  assert.ok(!(miss.receipt.diagnostics || []).some((d) => d.rule === 'gate_out_placement'), '非 atlas 项目根不出 warning');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(alien, { recursive: true, force: true });
});


const malformedReceipts = [
  ['validate', 'missing check ok', { extraValidate: '{checks:[{name:"schema"}]}' }],
  ['validate', 'null check', { extraValidate: '{checks:[null]}' }],
  ['validate', 'empty checks', { extraValidate: '{checks:[]}' }],
  ['validate', 'missing composition status', { extraValidate: '{composition:{summary:{errors:0}}}' }],
  ['validate', 'negative composition errors', { extraValidate: '{composition:{status:"pass",summary:{errors:-1}}}' }],
  ['deliver', 'missing validation', { extraDeliver: '{validation:null}' }],
  ['deliver', 'missing passed count', {extraDeliver:'{validation:{checkCount:1,compositionStatus:"pass",errors:0}}'}],
  ['deliver', 'missing total count', {extraDeliver:'{validation:{checksPassed:1,compositionStatus:"pass",errors:0}}'}],
  ['deliver', 'negative errors', {extraDeliver:'{validation:{checksPassed:1,checkCount:1,compositionStatus:"pass",errors:-1}}'}],
  ['deliver', 'missing counts', { extraDeliver: '{validation:{compositionStatus:"pass",errors:0}}' }],
  ...[ [0,7], [-1,1], [1.5,1.5], [0,0] ].map(([checksPassed,checkCount]) => ['deliver', 'counts '+checksPassed+'/'+checkCount, {extraDeliver: `{validation:{checksPassed:${checksPassed},checkCount:${checkCount},compositionStatus:"pass",errors:0}}`}]),
  ['deliver', 'missing composition status', {extraDeliver:'{validation:{checksPassed:1,checkCount:1,errors:0}}'}],
  ['deliver', 'missing errors', {extraDeliver:'{validation:{checksPassed:1,checkCount:1,compositionStatus:"pass"}}'}],
  ['visual-check', 'review pass', {extraVisual:'{visualReview:"pass"}'}],
  ['visual-check', 'review null', {extraVisual:'{visualReview:null}'}],
  ['visual-check', 'missing path', {extraVisual:'{artifact:{sha256:sha(buf),bytes:buf.byteLength}}'}],
  ['visual-check', 'missing bytes', {extraVisual:'{artifact:{path:artifact,sha256:sha(buf)}}'}],
  ['visual-check', 'wrong path', {extraVisual:'{artifact:{path:artifact+".other",sha256:sha(buf),bytes:buf.byteLength}}'}],
  ['visual-check', 'wrong bytes', {extraVisual:'{artifact:{path:artifact,sha256:sha(buf),bytes:buf.byteLength+1}}'}],
];
for (const [stage, label, opts] of malformedReceipts) test('G1 rejects '+stage+' '+label, () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gate-g1-'));
  try {
    const spec=path.join(dir,'spec.json'), out=path.join(dir,'out.html');
    fs.writeFileSync(spec, JSON.stringify({diagram_type:'architecture'}));
    const r=runGate(spec,out,writeFakeArchify(dir,'stub.mjs',opts));
    assert.equal(r.final,'fail',JSON.stringify(r));
    assert.equal(r.stage,stage,JSON.stringify(r));
    assert.equal(r.reason,stage==='visual-check'?'visual-check-artifact-mismatch':stage+'-receipt');
    if(stage!=='validate') assert.equal(fs.readFileSync(out,'utf8'),'<html><body>ok</body></html>');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
for (const [label, date] of [['past','2000-01-01'],['future','2099-01-01']]) test('G1 rejects '+label+' untouched artifact', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gate-g1-time-'));
  try {
    const spec=path.join(dir,'spec.json'),out=path.join(dir,'out.html');
    fs.writeFileSync(spec,'{}'); fs.writeFileSync(out,'<html><body>ok</body></html>');
    fs.utimesSync(out,new Date(date),new Date(date));
    const r=runGate(spec,out,writeFakeArchify(dir,'stub.mjs',{mutateOutPath:'false'}));
    assert.equal(r.final,'fail',JSON.stringify(r)); assert.equal(r.stage,'deliver');
    assert.equal(r.reason,'deliver-artifact-stale');
    assert.match(r.tail,label==='future'?/未来/:/早于/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
