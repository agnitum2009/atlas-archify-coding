#!/usr/bin/env node
// 生成物同步（命令面单源化）：结构性事实只写一次，其余产物由此脚本写回。
//   ① specs/command-contract.md 附录 A 表        ← lib/error-codes.mjs ERROR_CODES
//   ② integrations/*/skills/atlas-engine/SKILL.md 命令速查块 ← buildUsage()（--help 原文，text 围栏）
//   ③ 含 atlas-shared 标记的技能副本共享区 + metadata.version ← ② 的正本全文 + package.json version
// 缺省写回；--check 只比对，有差异 exit 1 并逐行列 `drift <路径>`；标记缺失/重复/倒序 exit 1；未知参数 exit 2。
// integrations/ 不存在（公开树）= 跳过 ②③ 并打印 skipped，不失败。零依赖，无 TTY/本机路径假设。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
let check = false;
for (const a of argv) {
  if (a === '--check') check = true;
  else { console.error('未知参数：' + a + '（用法：node scripts/sync-generated.mjs [--check]）'); process.exit(2); }
}

const { ERROR_CODES } = await import(pathToFileURL(path.join(ROOT, 'lib', 'error-codes.mjs')).href);
const { buildUsage } = await import(pathToFileURL(path.join(ROOT, 'lib', 'commands.mjs')).href);
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function markerBlock(text, begin, end, body, label) {
  const s = text.indexOf(begin), f = text.indexOf(end);
  if (s < 0 || f <= s || text.indexOf(begin, s + 1) >= 0 || text.indexOf(end, f + 1) >= 0) {
    throw new Error(label + ' 标记必须唯一且有序：' + begin + ' … ' + end);
  }
  return text.slice(0, s + begin.length) + '\n' + body + '\n' + text.slice(f);
}
const gen = (name) => ['<!-- generated:' + name + ':start -->', '<!-- generated:' + name + ':end -->'];

function errorTable() {
  return ['| 错误码 | 来源 | 退出码 | 语义与补救 |', '| --- | --- | --- | --- |',
    ...ERROR_CODES.map((e) => '| ' + e.code + ' | ' + e.source + ' | ' + e.exit + ' | ' + e.remedy + ' |')].join('\n');
}

// 目标清单：[{ rel, abs, current, expected }]；读取/转换失败记入 failures，返回 null。
const targets = [];
const failures = [];
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

function planTarget(abs, transform, label) {
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch (e) { failures.push(label + ' 不可读：' + rel(abs) + '（' + e.message + '）'); return null; }
  try {
    const expected = transform(text);
    targets.push({ rel: rel(abs), abs, current: text, expected });
    return expected;
  } catch (e) { failures.push(e.message); return null; }
}

// ① 契约附录 A
planTarget(path.join(ROOT, 'specs', 'command-contract.md'),
  (t) => markerBlock(t, ...gen('error-codes'), errorTable(), '契约附录 A'), '契约');

// ②③ 技能文件：按目录发现，不写宿主名
const integrations = path.join(ROOT, 'integrations');
if (!fs.existsSync(integrations)) {
  console.log('sync-generated: skipped integrations（目录不存在）');
} else {
  const skills = fs.readdirSync(integrations)
    .map((d) => path.join(integrations, d, 'skills', 'atlas-engine', 'SKILL.md'))
    .filter((p) => fs.existsSync(p));
  const [helpBegin, helpEnd] = gen('help');
  const shBegin = '<!-- atlas-shared:start -->', shEnd = '<!-- atlas-shared:end -->';
  // 正本 = 含速查标记且无共享区标记；副本 = 含共享区标记（副本共享区内会复制正本全文，含速查标记，故须排除）。
  const texts = new Map(skills.map((p) => [p, fs.readFileSync(p, 'utf8')]));
  const isCopy = (p) => texts.get(p).includes(shBegin) || texts.get(p).includes(shEnd);
  const sources = skills.filter((p) => texts.get(p).includes(helpBegin) && !isCopy(p));
  if (sources.length !== 1) failures.push('含 generated:help 标记的技能正本须恰有一个，实际 ' + sources.length);
  let sourceText = null;
  if (sources.length === 1) {
    sourceText = planTarget(sources[0], (t) => markerBlock(t, helpBegin, helpEnd, '```text\n' + buildUsage() + '\n```', '技能速查'), '技能正本');
  }
  for (const copy of skills.filter(isCopy)) {
    if (sourceText === null) break;
    planTarget(copy, (t) => {
      let expected = markerBlock(t, shBegin, shEnd, sourceText.trim(), '共享区');
      const fm = expected.match(/^---\n[\s\S]*?\n---\n/);
      if (!fm || (fm[0].match(/^  version:.*$/gm) || []).length !== 1) throw new Error('技能副本 metadata.version 必须唯一');
      return expected.replace(fm[0], fm[0].replace(/^  version:.*$/m, '  version: "' + version + '"'));
    }, '技能副本');
  }
}

let drift = 0;
for (const t of targets) {
  if (t.expected === t.current) { console.log('sync-generated: unchanged ' + t.rel); continue; }
  if (check) { console.log('sync-generated: drift ' + t.rel); drift += 1; continue; }
  fs.writeFileSync(t.abs, t.expected);
  console.log('sync-generated: written ' + t.rel);
}
for (const f of failures) console.error(f);
if (failures.length > 0 || drift > 0) {
  console.error('sync-generated ' + (check ? 'check' : 'write') + ' fail：' + (failures.length ? failures.length + ' 处错误' : '') + (drift ? drift + ' 处漂移（运行 node scripts/sync-generated.mjs 写回）' : ''));
  process.exit(1);
}
console.log('sync-generated ok：' + targets.length + ' 目标' + (check ? '一致' : '已同步'));
