// 账本引擎版本戳（增长控制开发规范批一#1，2026-08-15）：启动时同步读一次 package.json，零依赖。
// 用途：history 事件 / autoTrace detail 的 engine 字段（可选增量），标识「这条账是哪个引擎语义写的」。
// 语义世系：引擎版本升级即语义前进，读方凭 engine 判断事件写入时的契约语义代际。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export const ENGINE_VERSION = PKG.version;
