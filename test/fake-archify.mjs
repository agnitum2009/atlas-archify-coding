// 测试用「契约合规假内核」（非 *.test.mjs，不进 node --test 收集）。
// 缺陷7 回归用：gate 现在校验 archify 真回执契约（validate/deliver/visual-check 各自的成功形状），
// 故原先 `process.exit(0)` 空壳 stub 已不能代表「成功内核」；本助手生成一个按真实字段面回话、
// 并真正产出 HTML 的假内核，供 gate 相关测试复用（不复制多份）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function fakeArchifySource(opts = {}) {
  const {
    mutateOutPath = 'true',
    omitArtifact = false,
    visualStatus = 'pass',
    visualizeScript = null, // 传入时：visual-check 直接打印该 JSON 文本并按其退出码退出（自定义回执测试用）
    visualExit = 1,
    extraDeliver = '{}',
    extraValidate = '{}',
    extraVisual = '{}',
  } = opts;
  const visualBranch = visualizeScript === null
    ? `const receipt = { schemaVersion: 1, ok: ${visualStatus === 'pass' ? 'true' : 'false'}, command: 'visual-check', status: '${visualStatus}', visualReview: 'pending',
    artifact: { path: artifact, sha256: sha(buf), bytes: buf.byteLength },
    containment: { status: '${visualStatus}' }, readability: { status: '${visualStatus}' }, viewerChrome: { status: '${visualStatus}' }, captures: { status: '${visualStatus}' },
    sidecars: { receipt: 'x.visual-check.json', contactSheet: 'x.visual-check.html' } };
  Object.assign(receipt, ${extraVisual});
  console.log(JSON.stringify(receipt));
  process.exit(${visualStatus === 'pass' ? 0 : 1});`
    : `console.log(${JSON.stringify(visualizeScript)});
  process.exit(${visualExit});`;
  return `import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const argv = process.argv.slice(2);
const cmd = argv[0];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const specPath = argv[2];
const outPath = argv[3];
if (cmd === 'validate') {
  const receipt = { schemaVersion: 1, ok: true, command: 'validate', type: argv[1], input: specPath, checks: [{ name: 'composition', ok: true }], composition: { profile: 'showcase', status: 'pass', summary: { errors: 0, warnings: 0 } } };
  Object.assign(receipt, ${extraValidate});
  console.log(JSON.stringify(receipt));
  process.exit(0);
}
if (cmd === 'deliver') {
  const html = '<html><body>ok</body></html>';
  if (${mutateOutPath}) { fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, html); }
  const spec = fs.readFileSync(specPath);
  const receipt = { schemaVersion: 1, ok: true, command: 'deliver', type: argv[1], input: specPath, output: outPath,
    specification: { sha256: sha(spec), bytes: spec.byteLength },
    artifact: { sha256: sha(Buffer.from(html)), bytes: Buffer.byteLength(html) },
    validation: { checksPassed: 1, checkCount: 1, compositionProfile: 'showcase', compositionStatus: 'pass', errors: 0, warnings: 0 } };
  ${omitArtifact ? 'delete receipt.artifact;' : ''}
  Object.assign(receipt, ${extraDeliver});
  console.log(JSON.stringify(receipt));
  process.exit(0);
}
if (cmd === 'visual-check') {
  const artifact = argv[1];
  const buf = fs.readFileSync(artifact);
  ${visualBranch}
}
process.exit(1);
`;
}

export function writeFakeArchify(dir, name, opts) {
  const file = path.join(dir, name || 'fake-archify.mjs');
  fs.writeFileSync(file, fakeArchifySource(opts || {}));
  return file;
}

export function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'atlas-fake-'));
}
