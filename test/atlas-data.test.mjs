import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveAtlasContext} from '../lib/atlas-data.mjs';

test('B3 history uses unique registry ownership and discloses ambiguous fallback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'atlas-data-'));
  try {
    fs.mkdirSync(path.join(root,'state'));
    const sc=path.join(root,'state','atlas-state.json');
    const reg=path.join(root,'state','projects.json');
    const put=projects=>fs.writeFileSync(reg,JSON.stringify({projects}));
    put([{project:'demo',sourcePath:path.join(root,'repo')}]);
    assert.equal(resolveAtlasContext(sc).project,'demo');
    put([{project:'aaa',sourcePath:path.join(root,'a')},{project:'bbb',sourcePath:path.join(root,'b')}]);
    const ambiguous=resolveAtlasContext(sc,{hintPath:root});
    assert.equal(ambiguous.project,'atlas-state');
    assert.equal(ambiguous.projectSource,'fallback-basename');
    assert.equal(ambiguous.projectReason,'registry-ambiguous');
    assert.equal(resolveAtlasContext(sc,{hintPath:path.join(root,'b','x')}).project,'bbb');
    put([{project:'aaa',sidecar:'atlas-state.json'},{project:'bbb',sidecar:'atlas-state.json'}]);
    assert.equal(resolveAtlasContext(sc,{hintPath:root}).project,'atlas-state');
    assert.equal(resolveAtlasContext(path.join(root,'state','atlas-explicit.json')).project,'explicit');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('B3 registry decoder returns raw facts without opt-in defaults or mutation',async()=>{
  const {readProjectsRegistry}=await import('../lib/projects-registry.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'registry-facts-'));
  const file=path.join(root,'projects.json');
  try {
    assert.equal(readProjectsRegistry(file).status,'missing');
    for (const bytes of ['{','[]','{}','null']) {
      fs.writeFileSync(file,bytes);
      assert.equal(readProjectsRegistry(file).status,'invalid');
      assert.equal(fs.readFileSync(file,'utf8'),bytes);
    }
    const entries=[{project:23,seats:'bad'},{project:'demo',sourcePath:'/repo'}];
    const bytes=JSON.stringify({schemaVersion:1,projects:entries,custom:'preserved'});
    fs.writeFileSync(file,bytes);
    const read=readProjectsRegistry(file);
    assert.equal(read.status,'ok');
    assert.deepEqual(read.entries,entries);
    assert.equal(Object.hasOwn(read.entries[1],'sidecar'),false);
    assert.equal(Object.hasOwn(read.entries[1],'seats'),false);
    assert.equal(read.data.custom,'preserved');
    assert.equal(fs.readFileSync(file,'utf8'),bytes);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
