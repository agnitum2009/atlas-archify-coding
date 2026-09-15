// Decode registry facts only. Authorization and observation policies belong to callers.
import fs from 'node:fs';

export function readProjectsRegistry(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    return { status: error.code === 'ENOENT' ? 'missing' : 'invalid', entries: [], error };
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.projects)) {
      throw new Error('注册表缺少 projects 数组（形状坏）');
    }
    return { status: 'ok', entries: data.projects, error: null, data };
  } catch (error) { return { status: 'invalid', entries: [], error }; }
}
