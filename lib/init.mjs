// atlas scaffold（atlas-layout.md 七区制 + §〇-v3 项目伞目录版式，0.7.0 起）。
// template=minimal（缺省）只出骨架；template=demo 额外播种：spec/<项目>/demo-map.json 演示图 +
// 侧车示例节点 demo-a（progress=planned）+ INDEX 注册。
// 0.7.0（demo-b holdout 对抗实验缺陷3）：此前 init 生成 v1 平铺版式，build-portal/doctor --atlas 要
// v3 版式且无迁移工具——新项目必须手工迁三层目录才能被门户收录。现直接生成 v3 版式：
// 七区 + spec|evidence|data|artifacts 下 <项目>/ 一级子目录 + 根 INDEX.md（项目注册表）+
// state/projects.json 机器可读注册表——init 产物零手工迁移直通 build-portal --project 与 doctor --atlas。

import fs from 'node:fs';
import path from 'node:path';

const DIRS = ['spec', 'artifacts', 'evidence', 'data', 'state', 'rulings', 'history'];
// v3 版式项目一级子目录（§〇.1 隔离措施）：artifacts/<项目>/ 下的 <模块>-<YYMMDD>/ 模块目录
// 由交付/build-portal 流程按需建，init 不预建。
const PROJECT_ZONES = ['spec', 'evidence', 'data', 'artifacts'];

// 项目名清洗为 [a-z0-9-]（与 build-portal slugify 同则：小写、非法字符折叠为单个连字符、去首尾连字符）。
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// 项目名派生（0.7.0，零新旗标）：显式 --diagram-id 取其首段（第一个连字符前）；
// 未给 --diagram-id 取 --dir 的 basename。派生为空 = 无法安全落位项目子目录，fail-loud bad_args。
function deriveProject(root, diagramId) {
  const explicit = diagramId !== undefined && diagramId !== null && diagramId !== '';
  const raw = explicit ? String(diagramId).split('-')[0] : path.basename(root);
  const project = slugify(raw);
  if (project === '') {
    const err = new Error(
      '项目名派生为空（' + (explicit ? '--diagram-id 首段 ' : '--dir basename ') + JSON.stringify(raw) +
      ' 清洗为 [a-z0-9-] 后无字符）；补救：换可派生的 --diagram-id 或目录名'
    );
    err.code = 'bad_args';
    throw err;
  }
  return project;
}

// 本地日期 YYYY-MM-DD（与 build-portal firstSeen 同格式）。
function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export function scaffoldAtlas(dir, { title, diagramType, diagramId, template }) {
  const root = path.resolve(dir);
  const stateFile = path.join(root, 'state', 'atlas-state.json');
  if (fs.existsSync(stateFile)) {
    const err = new Error('目标目录已存在 atlas-state.json，拒绝覆盖');
    err.code = 'atlas_exists';
    throw err;
  }
  const effectiveDiagramId = diagramId || 'main';
  const project = deriveProject(root, diagramId);
  const created = [];
  fs.mkdirSync(root, { recursive: true });
  for (const sub of DIRS) {
    const p = path.join(root, sub);
    fs.mkdirSync(p, { recursive: true });
    created.push(sub + '/');
  }
  for (const zone of PROJECT_ZONES) {
    fs.mkdirSync(path.join(root, zone, project), { recursive: true });
    created.push(zone + '/' + project + '/');
  }
  const demo = template === 'demo';
  const index = buildIndex(title, effectiveDiagramId, diagramType, demo, project);
  fs.writeFileSync(path.join(root, 'INDEX.md'), index, 'utf8');
  created.push('INDEX.md');

  const spec = {
    schema_version: 1,
    diagram_type: diagramType,
    meta: { title, quality_profile: 'showcase' },
    components: [],
    boundaries: [],
    connections: [],
    cards: [],
  };
  const specFile = path.join(root, 'spec', project, effectiveDiagramId + '.json');
  fs.writeFileSync(specFile, JSON.stringify(spec, null, 2) + '\n', 'utf8');
  created.push('spec/' + project + '/' + effectiveDiagramId + '.json');

  // 侧车独占创建：flag 'wx'（O_EXCL）已存在即抛 EEXIST——与上方 existsSync 检查构成双保险，
  // 消除检查→落盘窗口内他人抢先创建时的覆盖风险（与 scaffold 拒绝已存在语义一致）。
  // 不改走 saveSidecar：scaffold 是一次性建目录，无并发修改语义，O_EXCL 已足够且免锁文件副作用。
  // 初始内容 revision:0 与 store CAS 版本号约定对齐。
  const sidecar = { schemaVersion: 1, atlas: effectiveDiagramId, revision: 0, nodes: {} };
  if (demo) {
    sidecar.nodes['demo-a'] = {
      owner: 'demo',
      truth: 'candidate',
      progress: 'planned',
      ledger: 'clean',
      evidence: [],
      history: [],
    };
  }
  try {
    fs.writeFileSync(stateFile, JSON.stringify(sidecar, null, 2) + '\n', 'utf8', { flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') {
      const err = new Error('目标目录已存在 atlas-state.json，拒绝覆盖');
      err.code = 'atlas_exists';
      throw err;
    }
    throw e;
  }
  created.push('state/atlas-state.json');

  // §〇-v3.3 机器可读项目注册表：init 即登记（project/umbrella=<项目>-add/sourcePath:null/firstSeen/portals:[]），
  // build-portal --project 复用该伞（首登记者不带路径段），直通零手工迁移。
  const registry = {
    schemaVersion: 1,
    projects: [{ project, umbrella: project + '-add', sourcePath: null, firstSeen: todayISO(), portals: [] }],
  };
  fs.writeFileSync(path.join(root, 'state', 'projects.json'), JSON.stringify(registry, null, 2) + '\n', 'utf8');
  created.push('state/projects.json');

  if (demo) {
    const demoSpec = buildDemoSpec(spec, title);
    const demoFile = path.join(root, 'spec', project, 'demo-map.json');
    fs.writeFileSync(demoFile, JSON.stringify(demoSpec, null, 2) + '\n', 'utf8');
    created.push('spec/' + project + '/demo-map.json');
  }

  const rulings = '# 裁定节点（引用台账）\n\n本目录只存引用行；原文在源仓治理台账（如 docs/OWNER-OPEN-QUESTIONS.md）。\n';
  fs.writeFileSync(path.join(root, 'rulings', 'RULINGS.md'), rulings, 'utf8');
  created.push('rulings/RULINGS.md');

  return { root, project, diagram_spec: specFile, state_sidecar: stateFile, index: path.join(root, 'INDEX.md'), created, template: demo ? 'demo' : 'minimal' };
}

// 演示图：最小合法 archify spec（形状参照主 spec；schema_version/diagram_type 照抄主 spec）。
function buildDemoSpec(baseSpec, title) {
  return {
    schema_version: baseSpec.schema_version,
    diagram_type: baseSpec.diagram_type,
    meta: { title: title + ' · 演示图', quality_profile: 'showcase' },
    components: [
      { id: 'demo-a', type: 'backend', label: '演示节点 A', sublabel: '侧车示例节点（progress=planned）', pos: [80, 120], size: [160, 60] },
      { id: 'demo-b', type: 'backend', label: '演示节点 B', sublabel: 'state set → evidence-add → settle 全环示例', pos: [350, 120], size: [160, 60] },
      { id: 'demo-c', type: 'external', label: '演示外部依赖', sublabel: 'report --spec 图账交叉示例', pos: [620, 120], size: [160, 60] },
    ],
    boundaries: [
      { kind: 'security-group', label: '演示边界', wraps: ['demo-a', 'demo-b'] },
    ],
    connections: [
      { from: 'demo-a', to: 'demo-b', label: 'feeds' },
      { from: 'demo-b', to: 'demo-c', label: 'rules' },
    ],
    cards: [
      { dot: 'cyan', title: '演示图', items: ['这是演示图，跑通读图→state set→evidence-add→settle→report 全环后可删'] },
    ],
  };
}

function buildIndex(title, diagramId, diagramType, demo, project) {
  const rows = [
    '| ' + diagramId + ' | ' + diagramType + ' | spec/' + project + '/' + diagramId + '.json | artifacts/' + project + '/<模块>-<YYMMDD>/' + diagramId + '.html | 骨架待填充（填充后走 gate 三闸） |',
  ];
  if (demo) {
    rows.push('| demo-map | ' + diagramType + ' | spec/' + project + '/demo-map.json | artifacts/' + project + '/<模块>-<YYMMDD>/demo-map.html | 演示图（跑通全环后可删） |');
  }
  return [
    '# ' + title + '（ADD 图谱）',
    '',
    '> 由 atlas-engine init 生成；目录规范见 specs/atlas-layout.md（七区制 + v3 门户伞目录版式）。',
    '',
    '## 项目注册表（v3 版式，机器可读正本 = state/projects.json）',
    '',
    '| 项目 | 伞目录 | 初始化 | 图数 | 侧车 |',
    '| --- | --- | --- | --- | --- |',
    '| ' + project + ' | ' + project + '-add/ | ' + todayISO() + ' | ' + (demo ? 2 : 1) + ' | state/atlas-state.json |',
    '',
    '## 图清单',
    '',
    '| diagram-id | 类型 | spec | 交付物 | 状态 |',
    '| --- | --- | --- | --- | --- |',
  ].concat(rows)
    .concat(demo ? ['', '> demo-map 是演示图：这是演示图，跑通读图→state set→evidence-add→settle→report 全环后可删（侧车示例节点 demo-a，progress=planned）。'] : [])
    .concat([
      '',
      '## 六层注册表（视图分层，实体本体唯一）',
      '',
      '| 层 | 图 | 状态 |',
      '| --- | --- | --- |',
      '| 全局 | — | 未建 |',
      '| 横切门 | — | 未建 |',
      '| 表面 | — | 未建 |',
      '| 关系 | — | 未建 |',
      '| 真相 | — | 未建 |',
      '| 生产 | — | 未建 |',
      '',
      '## 目录职责（七区制 + v3 项目隔离）',
      '',
      '- spec/<项目>/ 图谱规格 · artifacts/<项目>/<模块>-YYMMDD/ 交付物 · evidence/<项目>/<diagram-id>/ 视觉核查回执 · data/<项目>/ 数据资产 · state/ 状态侧车与项目注册表 · rulings/ 裁定引用 · history/ 快照时间线',
      '',
    ])
    .join('\n');
}
