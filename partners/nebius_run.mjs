// Route-comparable run: the SAME extraction task on Nebius Token Factory, for the
// models that overlap with our Butterbase ladder. Same prompt, temp 0, same scorer,
// same FCO custody scheme -> lets us compare Butterbase route vs Nebius route.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const KEY = process.env.NEBIUS_API_KEY;
const BASE = 'https://api.studio.nebius.com/v1';
if (!KEY) { console.error('NEBIUS_API_KEY not set'); process.exit(1); }
const SESSION = 'sess-glasswork-nebius-1';

const D = JSON.parse(readFileSync(new URL('./embed.json', import.meta.url), 'utf8'));
const DOCS = D.items; // {id,title,doc_text,gold_claims:[{id,text,kw}]}

// canonical our-id -> exact Nebius id
const MAP = [
  { id: 'google/gemma-3-27b-it', nebius: 'google/gemma-3-27b-it' },
  { id: 'qwen/qwen3-32b', nebius: 'Qwen/Qwen3-32B' },
  { id: 'meta-llama/llama-3.3-70b-instruct', nebius: 'meta-llama/Llama-3.3-70B-Instruct' },
  { id: 'openai/gpt-oss-120b', nebius: 'openai/gpt-oss-120b' },
  { id: 'qwen/qwen3-235b-a22b-2507', nebius: 'Qwen/Qwen3-235B-A22B-Instruct-2507' },
];

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const sha = b => createHash('sha256').update(b).digest('hex');
const leafHash = p => sha(Buffer.concat([Buffer.from([0x00]), Buffer.from(p, 'utf8')]));
const nodeHash = (l, r) => sha(Buffer.concat([Buffer.from([0x01]), Buffer.from(l, 'hex'), Buffer.from(r, 'hex')]));
function merkleRoot(ls){let lvl=ls.slice();while(lvl.length>1){const nx=[];for(let i=0;i<lvl.length;i+=2){const l=lvl[i],r=i+1<lvl.length?lvl[i+1]:lvl[i];nx.push(nodeHash(l,r));}lvl=nx;}return lvl[0];}
function extractJsonArray(text){if(!text)return null;let t=text.replace(/```json/gi,'```').replace(/```/g,'');const s=t.indexOf('[');if(s<0)return null;let d=0,e=-1;for(let i=s;i<t.length;i++){if(t[i]==='[')d++;else if(t[i]===']'){d--;if(!d){e=i;break;}}}if(e<0)return null;try{return JSON.parse(t.slice(s,e+1));}catch{return null;}}
function score(doc, claims){
  const docN=norm(doc.doc_text);
  const preds=(Array.isArray(claims)?claims:[]).map(c=>{const ct=typeof c==='string'?c:(c.claim||c.text||'');const sp=typeof c==='string'?'':(c.supporting_span||c.span||'');const spN=norm(sp);return{hay:norm(ct+' '+sp),grounded:spN.length>=8&&docN.includes(spN)};});
  const used=new Array(preds.length).fill(false);let tp=0;
  for(const g of doc.gold_claims){for(let i=0;i<preds.length;i++){if(used[i]||!preds[i].grounded)continue;if((g.kw||[]).every(k=>preds[i].hay.includes(k))){used[i]=true;tp++;break;}}}
  const asserted=preds.length, gold=doc.gold_claims.length;
  const precision=asserted?tp/asserted:0, recall=gold?tp/gold:0;
  return {tp,asserted,gold_n:gold,precision,recall,f1:precision+recall?2*precision*recall/(precision+recall):0};
}
const SYS='You are a precise information-extraction engine. Extract every distinct factual claim stated in the document. For each claim, return an object with "claim" (a short declarative sentence) and "supporting_span" (copied verbatim from the document). Return ONLY a JSON array of such objects and nothing else.';

async function call(nebId, doc){
  const messages=[{role:'system',content:SYS},{role:'user',content:doc.doc_text}];
  const promptStr=JSON.stringify(messages);
  const t0=Date.now();let content='',usage={},err=null;
  try{
    const r=await fetch(`${BASE}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${KEY}`},body:JSON.stringify({model:nebId,messages,temperature:0,max_tokens:900})});
    const j=await r.json();
    if(!r.ok)err=JSON.stringify(j).slice(0,200);else{content=j.choices?.[0]?.message?.content??'';usage=j.usage||{};}
  }catch(e){err=String(e);}
  const latency_ms=Date.now()-t0;
  const tokens_in=usage.prompt_tokens??0, tokens_out=usage.completion_tokens??0;
  const claims=extractJsonArray(content);
  const sc=score(doc,claims);
  const prompt_sha256=sha(Buffer.from(promptStr,'utf8')), output_sha256=sha(Buffer.from(content,'utf8'));
  return {err,content,tokens_in,tokens_out,latency_ms,prompt_sha256,output_sha256,usage_cost:usage.cost??null,...sc,parse_ok:Array.isArray(claims)};
}

(async()=>{
  const bbAgg=Object.fromEntries(D.agg.map(a=>[a.model_id,a]));
  const bbRoot=Object.fromEntries(D.custody.roots.map(r=>[r.model_id,r.root_sha256]));
  const rows=[];
  for(const m of MAP){
    const perDoc=[]; const leaves=[];
    for(const doc of DOCS){
      const r=await call(m.nebius,doc);
      const op_pre=`${m.nebius}|${SESSION}|${r.tokens_in}|${r.tokens_out}|${(r.usage_cost??0).toFixed(10)}`;
      const ct_pre=`${r.prompt_sha256}|${r.output_sha256}`;
      leaves.push(leafHash(op_pre),leafHash(ct_pre));
      perDoc.push({item:doc.id,...r});
      console.error(`  ${m.nebius.padEnd(42)} ${doc.id.padEnd(20)} P=${r.precision.toFixed(2)} R=${r.recall.toFixed(2)} tok=${r.tokens_in}/${r.tokens_out} ${r.latency_ms}ms ${r.err?'ERR '+r.err:''}`);
    }
    const tp=perDoc.reduce((a,x)=>a+x.tp,0), asserted=perDoc.reduce((a,x)=>a+x.asserted,0), gold=perDoc.reduce((a,x)=>a+x.gold_n,0);
    const precision=asserted?tp/asserted:0, recall=gold?tp/gold:0;
    const tin=perDoc.reduce((a,x)=>a+x.tokens_in,0), tout=perDoc.reduce((a,x)=>a+x.tokens_out,0);
    const lat=Math.round(perDoc.reduce((a,x)=>a+x.latency_ms,0)/perDoc.length);
    const bb=bbAgg[m.id]||{};
    rows.push({
      model_id:m.id, nebius_id:m.nebius,
      butterbase:{precision:bb.precision,recall:bb.recall,usd_total:bb.usd_total,root:bbRoot[m.id]||null},
      nebius:{precision:+precision.toFixed(4),recall:+recall.toFixed(4),tokens_in:tin,tokens_out:tout,latency_ms:lat,usd_cost:perDoc.every(x=>x.usage_cost!=null)?+perDoc.reduce((a,x)=>a+x.usage_cost,0).toFixed(8):null,root:merkleRoot(leaves),parse_ok:perDoc.every(x=>x.parse_ok)},
    });
  }
  const out={_meta:{session:SESSION,base:BASE,generated:'nebius_run.mjs',note:'Same task/prompt/scorer/FCO scheme on Nebius Token Factory for the models overlapping our Butterbase ladder. Route-comparable.'},rows};
  writeFileSync(new URL('./nebius_compare.json',import.meta.url),JSON.stringify(out,null,2));
  console.error('\n=== route comparison (Butterbase vs Nebius) ===');
  for(const r of rows) console.error(`  ${r.model_id.padEnd(38)} BB R=${(r.butterbase.recall??0).toFixed(2)} | NB R=${r.nebius.recall.toFixed(2)}  agree=${Math.abs((r.butterbase.recall??0)-r.nebius.recall)<0.13?'yes':'DIFF'}  NBtok=${r.nebius.tokens_in}/${r.nebius.tokens_out} ${r.nebius.latency_ms}ms`);
  console.error('nebius_compare.json written.');
})();
