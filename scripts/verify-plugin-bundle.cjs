// verify-plugin-bundle.cjs — DSH 插件包静态验证（Skill-only bundle 范式）。
// 检查：package.json 字段 / cordis.patch.yml 注入结构 / SKILL.md 承载纪律 / files 清单与实际一致。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'integrations', 'deepseek-harness');
const failures = [];

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (pkg.name !== '@agnitum2009/atlas-engine-dsh') failures.push('package name');
if (pkg.engines && !/node/.test(JSON.stringify(pkg.engines))) failures.push('engines');
for (const f of pkg.files || []) {
  if (!fs.existsSync(path.join(ROOT, f))) failures.push('files 清单缺实体: ' + f);
}

const patch = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8');
if (!patch.includes('- insert:')) failures.push('patch 缺 insert');
if (!patch.includes('@deepseek-ai/dsh-skill-filesystem')) failures.push('patch 缺 skill-filesystem provider');
if (!patch.includes('providerName: atlas-engine')) failures.push('patch 缺 providerName');
if (!patch.includes('bundledSkillDir')) failures.push('patch 缺 bundledSkillDir');

const skillPath = path.join(ROOT, 'skills', 'atlas-engine', 'SKILL.md');
if (!fs.existsSync(skillPath)) failures.push('SKILL.md 缺失');
else {
  const skill = fs.readFileSync(skillPath, 'utf8');
  for (const cmd of ['init', 'state', 'evidence', 'diff', 'compile', 'report', 'gate', 'trace', 'lessons', 'notice', 'doctor']) {
    if (!skill.includes(cmd)) failures.push('SKILL.md 缺命令: ' + cmd);
  }
  if (!skill.includes('图=投影') || !skill.includes('当前焦点')) failures.push('SKILL.md 缺核心纪律');
}

if (failures.length > 0) {
  console.error(JSON.stringify({ verifier: 'verify-plugin-bundle', result: 'FAIL', failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ verifier: 'verify-plugin-bundle', result: 'PASS', checks: 4 }));

