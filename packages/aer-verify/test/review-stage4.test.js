// Independent review of the Stage 4 working tree: six reproductions, kept verbatim as regressions.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,writeFileSync,mkdtempSync}=require('node:fs');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {spawnSync}=require('node:child_process');
const {verifyPacket,packetContentHash}=require('../dist/evidence-chain/src/index.js');
const dir=join(__dirname,'../../evidence-chain/fixtures');
const load=(name)=>JSON.parse(readFileSync(join(dir,name),'utf8'));
const packet=()=>load('packet-2.0-signed.json');
const trustedKeys=[load('fixture-key-1.public.json')];
const rehash=(p)=>{p.export.content_hash='sha256:'+packetContentHash(p).hex;return p;};

test('adding content through an own __proto__ key must invalidate the trusted packet',()=>{
  const p=packet();
  const injected=JSON.parse('{"__proto__":{"synthetic_changed_content":true}}');
  Object.defineProperty(p.events[0].outputRedacted,'__proto__',Object.getOwnPropertyDescriptor(injected,'__proto__'));
  const r=verifyPacket(p,{trustedKeys});
  assert.equal(r.overall,'failed',JSON.stringify({overall:r.overall,anchored:r.anchored,chain:r.chain.status,manifest:r.manifest.status,signature:r.signature.status}));
  assert.equal(r.anchored,false);
});

test('unsupported declared algorithm versions must not verify',()=>{
  const p=packet();
  p.versions.chain='aer-chain/999';
  const r=verifyPacket(rehash(p),{trustedKeys});
  assert.equal(r.overall,'unsupported',JSON.stringify({overall:r.overall,anchored:r.anchored,versions:r.versions}));
  assert.equal(r.anchored,false);
});

test('a sourced block with an invalid array shape must not verify as an anchored packet',()=>{
  const p=packet();
  assert.equal(p.events[0].sourced,null);
  p.events[0].sourced=[];
  const r=verifyPacket(rehash(p),{trustedKeys});
  assert.equal(r.schema.status,'malformed',JSON.stringify({overall:r.overall,anchored:r.anchored,manifest:r.manifest.status}));
  assert.equal(r.overall,'failed');
});

test('receipt tenant mismatch must not match the packet even if manifest_hash is retained',()=>{
  const p=packet();
  p.receipt.signature=null;
  p.receipt.statement.organization_id='different_synthetic_tenant';
  const r=verifyPacket(rehash(p));
  assert.equal(r.packet_receipt.status,'mismatch');
  assert.equal(r.overall,'failed');
});

test('CLI parsing errors must not echo input contents',()=>{
  const temp=mkdtempSync(join(tmpdir(),'aer-codex-malformed-'));
  const file=join(temp,'input.json');
  const marker='synthetic_private_input_marker';
  writeFileSync(file,marker);
  const r=spawnSync(process.execPath,[join(__dirname,'../dist/aer-verify/src/cli.js'),file],{encoding:'utf8'});
  assert.equal(r.status,4);
  assert.equal((r.stdout+r.stderr).includes(marker.slice(0,10)),false,'input prefix echoed to stderr');
});

test('compiled CLI must reject __proto__ tampering even with the genuine trusted key',()=>{
  const p=packet();
  Object.defineProperty(p.events[0].outputRedacted,'__proto__',{value:{synthetic_changed_content:true},enumerable:true});
  const temp=mkdtempSync(join(tmpdir(),'aer-codex-tamper-'));
  const file=join(temp,'packet.json');
  writeFileSync(file,JSON.stringify(p));
  const r=spawnSync(process.execPath,[join(__dirname,'../dist/aer-verify/src/cli.js'),file,'--trusted-key',join(dir,'fixture-key-1.public.json'),'--require-anchor','--json'],{encoding:'utf8'});
  assert.equal(r.status,1,'compiled CLI accepted altered content with exit 0');
});
