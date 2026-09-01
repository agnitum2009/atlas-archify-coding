#!/usr/bin/env node
// 公开面隐私门禁（净室导出的机器执法）：扫描投影产物，命中任何内部专属词/绝对路径即 exit 1。
//
// 为什么必须是门禁而不是人眼：业主令「以后不单独维护公开仓」——公开版由 scripts/export-public.mjs
// 从内部仓反复重导出。若脱敏靠每次人工检查，第一次疏忽就会把内部项目名、席位结构、事故档、
// 本机路径推给公众。故：规则表在本文件，导出器与 CI 双向咬合（导出前预扫 + 产物复扫）。
//
// 用法：node scripts/check-public-privacy.mjs <目录>      扫描并报告
//       node scripts/check-public-privacy.mjs --rules     打印规则表（供投影器与文档引用）
import fs from 'node:fs';
import path from 'node:path';

// 禁止出现的内部专属标识（词边界匹配，避免 platform/compact 之类误命中）。
export const FORBIDDEN = [
  { pat: /\/home\/umax/, why: '本机绝对路径（暴露用户名与目录布局）' },
  { pat: /\bomp\b/i, why: '内部执行席位名' },
  { pat: /\bpi[- ]席\b/, why: '内部席位名' },
  { pat: /\bo13\b/, why: '内部项目名' },
  { pat: /\bn14\b/, why: '内部项目名' },
  { pat: /\bo11\b/, why: '内部项目名' },
  { pat: /\becontract\b/i, why: '内部系统名' },
  { pat: /\bmercur\b/i, why: '内部仓名' },
  { pat: /\badd-archify\b/, why: '内部账本根目录名' },
  { pat: /\bFIELD-REPORT\b/, why: '内部实战反馈档名' },
  { pat: /\bINCIDENT-\w+/, why: '内部事故档名' },
  { pat: /\bADR-\d+/, why: '内部决策记录编号' },
  { pat: /\bglm-5\.3\b/i, why: '内部席位/模型名' },
  { pat: /\bk3\b/, why: '内部席位/模型名' },
  { pat: /\bdsh\b/i, why: '内部 harness 简称' },
  { pat: /\bdeepseek\b/i, why: '内部 harness 名' },
  { pat: /\boh-my-pi\b/i, why: '内部 harness 名' },
  { pat: /APPEND_\s*SYSTEM/i, why: '内部注入块文件名' },
  { pat: /github\.com\/[\w.-]+\/(atlas-engine|o13|n14|mercur-carrier|openpi-lazyload|openpi-dev)\b/, why: '内部仓 URL/远端地址' },
  { pat: /github\.com\/[\w.-]+\/[\w.-]*\.(?:git)\b(?!.*atlas-archify-coding)/, why: '硬编码 git 远端（应指向本仓）' },
  { pat: /业主/, why: '内部治理用语（责任主体称谓）' },
  { pat: /宪章/, why: '内部方法论文档名' },
  { pat: /\bTOONFLOW\b/i, why: '内部产品名' },
];

// 目录级禁止（连文件存在本身都是内部结构泄露）。
export const FORBIDDEN_PATHS = [
  /^integrations\//, /^docs\/FIELD-REPORT/, /^docs\/INCIDENT-/, /^docs\/AUDIT-SUMMARY/,
  /^docs\/PROPOSALS-/, /^docs\/PENDING-/, /^docs\/OMP-/, /^docs\/ADOPTION-BASELINE/,
  /^docs\/METHODOLOGY-/, /^docs\/PLAN-TREE-/, /^docs\/CODEGRAPH-/, /^docs\/ADD-PROJECT/,
  /^REVIEW\.md$/, /^CHANGELOG\.md$/, /^scripts\/(verify-injection-freshness|verify-deploy-injection|injection-terms|deploy-injection-path|verify-size-budgets|verify-doc-test-count|unowned-oversize-scan|export-public)\.mjs$/,
  /^test\/(injection-freshness|deploy-injection|public-projection)\.test\.mjs$/,
];

// 唯一自我豁免：本文件必须含它要猎的词，故无法自扫。豁免的可核性由导出器保证——
// 它校验"公开版此文件 == 内部版此文件字节一致"，豁免面因此不可被用来夹带改动。
export const SELF_EXEMPT = ['scripts/check-public-privacy.mjs'];

const SKIP_DIRS = new Set(['.git', 'node_modules', '.pi-lens', 'artifacts', '.aac-projection']);
const TEXT_EXT = new Set(['.mjs', '.js', '.md', '.json', '.yml', '.yaml', '.txt', '.html', '.css']);

function walk(dir, rel = '', out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + name.name : name.name;
    const abs = path.join(dir, name.name);
    if (name.isDirectory()) {
      if (!SKIP_DIRS.has(name.name)) walk(abs, r, out);
    } else out.push(r);
  }
  return out;
}

export function scanTree(root) {
  const hits = [];
  for (const rel of walk(root)) {
    if (SELF_EXEMPT.includes(rel)) continue;
    if (FORBIDDEN_PATHS.some((re) => re.test(rel))) hits.push({ file: rel, rule: '路径级禁止（内部治理档/宿主适配面）', line: 0, text: '' });
    if (!TEXT_EXT.has(path.extname(rel))) continue;
    let text;
    try { text = fs.readFileSync(absOf(root, rel), 'utf8'); } catch { continue; }
    if (/\0/.test(text.slice(0, 8192))) continue; // 二进制不扫
    text.split('\n').forEach((line, i) => {
      for (const f of FORBIDDEN) if (f.pat.test(line)) hits.push({ file: rel, rule: f.why, line: i + 1, text: line.trim().slice(0, 160), pat: String(f.pat) });
    });
  }
  return hits;
}
const absOf = (root, rel) => path.join(root, rel);

if (process.argv[1] && process.argv[1].endsWith('check-public-privacy.mjs')) {
  const arg = process.argv[2];
  if (arg === '--rules') {
    console.log(JSON.stringify({ forPatterns: FORBIDDEN.map((f) => ({ pat: String(f.pat), why: f.why })), forbiddenPaths: FORBIDDEN_PATHS.map(String) }, null, 2));
    process.exit(0);
  }
  if (!arg) { console.error('用法：check-public-privacy.mjs <目录> ｜ --rules'); process.exit(2); }
  if (!fs.existsSync(arg)) { console.error('目录不存在：' + arg); process.exit(2); }
  const hits = scanTree(arg);
  if (hits.length > 0) {
    console.error(`public-privacy fail：命中 ${hits.length} 处内部专属面（脱敏不可靠，禁止发布）`);
    for (const h of hits.slice(0, 40)) console.error(`  ${h.file}:${h.line} [${h.rule}] ${h.text}`);
    if (hits.length > 40) console.error(`  …另 ${hits.length - 40} 处（-40 条已截断，请修后重跑）`);
    process.exit(1);
  }
  console.log(`public-privacy ok：${walk(arg).length} 文件零内部专属面（${FORBIDDEN.length} 词规 + ${FORBIDDEN_PATHS.length} 路径规）`);
  process.exit(0);
}
