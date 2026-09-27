#!/usr/bin/env node
// 转换器：Claude Code 会话 JSONL → 轨迹规整事件 JSONL（stdout）。
// harness 专属知识只在本文件（scripts/ 适配器层）；内核 lib/trajectory.mjs 只认规整格式、不知道 harness 存在。
// 用法：node scripts/trajectory-from-claude-code.mjs <会话.jsonl|目录> [--repo <代码仓>]
//   目录 = 递归其中 *.jsonl；--repo 给出时只保留该仓内的绝对路径。
// 规则：Read → reads；Edit / Write / NotebookEdit → writes；Bash 命令中出现的路径（绝对，或按该条 cwd 解析）
//   在命令含 sed -i、写文件重定向（不含 2>&1、>/dev/null）、git mv|rm、writeFileSync、tee 时判 writes，否则 reads。
//   Bash 判定是启发式——trace order 把由此推出的关系标为 I 级提名。
// 管道用法：node scripts/trajectory-from-claude-code.mjs <日志> --repo <仓> | atlas-engine trace import --source /dev/stdin --sidecar <侧车>
import fs from 'node:fs';
import path from 'node:path';

function usage(msg) {
  if (msg) console.error(msg);
  console.error('用法：node scripts/trajectory-from-claude-code.mjs <会话.jsonl|目录> [--repo <代码仓>]');
  process.exit(2);
}
const argv = process.argv.slice(2);
let src = null;
let repo = null;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--repo') {
    if (!argv[i + 1]) usage('--repo 缺少路径');
    repo = path.resolve(argv[i + 1]);
    i += 1;
  } else if (argv[i].startsWith('--')) usage('未知参数：' + argv[i]);
  else if (!src) src = argv[i];
  else usage('多余参数：' + argv[i]);
}
if (!src) usage();

function* logFiles(p) {
  if (fs.statSync(p).isFile()) { yield p; return; }
  for (const n of fs.readdirSync(p).sort()) {
    const q = path.join(p, n);
    if (fs.statSync(q).isDirectory()) yield* logFiles(q);
    else if (n.endsWith('.jsonl')) yield q;
  }
}
const PATH_RE = /(?:^|[\s'"`=(:])((?:\/|\.{1,2}\/)?[\w.@-]+(?:\/[\w.@-]+)+\.[A-Za-z0-9]+)(?=$|[\s'"`),:;|&>])/g;
const WRITE_RE = /\bsed\s+-i\b|(?:^|[^0-9&>])>>?\s*(?!&|\/dev\/)[^\s&|;]|\bgit\s+(?:mv|rm)\b|writeFileSync|\btee\b/;
const keep = (p) => typeof p === 'string' && path.isAbsolute(p) && (!repo || p === repo || p.startsWith(repo + path.sep));

let count = 0;
try {
  for (const file of logFiles(src)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type !== 'assistant' || !e.timestamp || !e.message || !Array.isArray(e.message.content)) continue;
      const cwd = typeof e.cwd === 'string' ? e.cwd : null;
      for (const b of e.message.content) {
        if (!b || b.type !== 'tool_use' || !b.id) continue;
        const inp = b.input || {};
        let reads = [];
        let writes = [];
        if (b.name === 'Read') reads = [inp.file_path];
        else if (b.name === 'Edit' || b.name === 'Write' || b.name === 'NotebookEdit') writes = [inp.file_path || inp.notebook_path];
        else if (b.name === 'Bash') {
          const cmd = String(inp.command || '');
          const paths = [...cmd.matchAll(PATH_RE)].map((m) => m[1]).map((p) => (path.isAbsolute(p) ? p : cwd ? path.resolve(cwd, p) : null));
          (WRITE_RE.test(cmd) ? writes : reads).push(...paths);
        }
        reads = [...new Set(reads.filter(keep))];
        writes = [...new Set(writes.filter(keep))];
        if (reads.length === 0 && writes.length === 0) continue;
        process.stdout.write(JSON.stringify({ schemaVersion: 1, source: 'claude-code', session: String(e.sessionId || path.basename(file, '.jsonl')), eventId: b.id, at: e.timestamp, tool: b.name, reads, writes }) + '\n');
        count += 1;
      }
    }
  }
} catch (err) {
  console.error('读取失败：' + err.message);
  process.exit(1);
}
console.error('trajectory-from-claude-code：' + count + ' 条规整事件');
