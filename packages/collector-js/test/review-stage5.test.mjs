// Independent review of the Stage 5 working tree: five reproductions, kept verbatim except the import paths.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {AgentEvidenceRecorder} from '../dist/index.js';
import {fileQueueStore} from '../dist/file-store.js';

function server(mode='ok'){
  const sent=[];
  const fetchImpl=async(url,init)=>{
    const path=new URL(url).pathname;
    if(path==='/api/v1/runs')return Response.json({run:{id:'review_run'}},{status:201});
    const body=JSON.parse(init.body);sent.push({path,body});
    if(path.endsWith('/events')){
      if(mode==='offline')throw new Error('synthetic network failure');
      if(mode==='reject')return Response.json({error:{code:'conflict',message:'synthetic'}},{status:409});
      return Response.json({event:{id:'e'},redaction:{findingsCount:0}},{status:201});
    }
    return Response.json({receipt:null});
  };
  return {fetchImpl,sent};
}
const recorder=(s,delivery)=>new AgentEvidenceRecorder({baseUrl:'https://review.invalid',apiKey:'synthetic-auth',fetchImpl:s.fetchImpl,maxRetries:0,delivery});

test('a persistent queue must not save an unmasked password with default capture',async()=>{
  const file=join(mkdtempSync(join(tmpdir(),'aer-review-raw-')),'queue.json');
  const r=recorder(server('offline'),{store:fileQueueStore(file),maxRetryDelayMs:100});
  const run=await r.startRun({agentName:'review'});
  const marker='synthetic-private-password';
  await run.enqueue({type:'tool_call',title:'review',input:{password:marker}});
  const leaked=readFileSync(file,'utf8').includes(marker);
  await r.shutdown(0);
  assert.equal(leaked,false,'raw password was persisted before server redaction');
});

test('a resumed awaited event with no surviving waiter must block completion if rejected',async()=>{
  let state={version:1,failedRuns:[],items:[{id:'pending',kind:'event',runId:'review_run',path:'/api/v1/runs/review_run/events',body:{type:'tool_call',title:'review'},idempotencyKey:'original-key',enqueuedAt:Date.now(),background:false}]};
  const s=server('reject');
  const r=recorder(s,{store:{load:async()=>structuredClone(state),save:async(v)=>{state=structuredClone(v);}}});
  await r.resume();await r.flush(500);
  const run=await r.startRun({agentName:'review'});
  await assert.rejects(run.complete(),(e)=>e.code==='undelivered_events');
});

test('an enqueue rejected because persistence failed must not later deliver the rejected item',async()=>{
  let saves=0;
  const s=server();
  const r=recorder(s,{store:{load:async()=>null,save:async()=>{if(++saves===1)throw new Error('synthetic disk failure');}}});
  const run=await r.startRun({agentName:'review'});
  await assert.rejects(run.enqueue({type:'tool_call',title:'not-accepted'}));
  await run.enqueue({type:'tool_call',title:'accepted'});
  await r.flush(500);
  assert.deepEqual(s.sent.filter(v=>v.path.endsWith('/events')).map(v=>v.body.title),['accepted']);
});

test('after a damaged store is rejected, subsequent writes must not silently overwrite it',async()=>{
  const file=join(mkdtempSync(join(tmpdir(),'aer-review-corrupt-')),'queue.json');
  const marker='synthetic-damaged-file';writeFileSync(file,marker);
  const r=recorder(server(),{store:fileQueueStore(file)});
  await assert.rejects(r.resume());
  const run=await r.startRun({agentName:'review'});
  try{await run.enqueue({type:'tool_call',title:'new'});}catch{}
  await r.flush(500);
  assert.equal(readFileSync(file,'utf8')===marker,true,'damaged state was overwritten after resume failed');
});

test('shutdown deadline must cancel the transport own Retry-After timer',()=>{
  const script=`import {AgentEvidenceRecorder} from './dist/index.js';
    const fetchImpl=async(url)=>url.endsWith('/runs')?Response.json({run:{id:'r'}},{status:201}):Response.json({error:{code:'busy',message:'synthetic'}},{status:429,headers:{'Retry-After':'30'}});
    const r=new AgentEvidenceRecorder({baseUrl:'https://review.invalid',apiKey:'synthetic',fetchImpl,maxRetries:1,delivery:{maxRetryDelayMs:30000}});
    const run=await r.startRun({agentName:'review'});await run.enqueue({type:'tool_call',title:'review'});
    await r.shutdown(10);console.log('SHUTDOWN_RETURNED');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),encoding:'utf8',timeout:700});
  assert.equal(child.stdout.includes('SHUTDOWN_RETURNED'),true);
  assert.equal(child.error?.code,undefined,'transport retry timer kept process alive after shutdown');
  assert.equal(child.status,0);
});
