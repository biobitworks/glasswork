// Independently re-verify Glasswork's custody roots inside an isolated Daytona sandbox.
// Uploads the published dataset, then recomputes every Merkle root from named bytes and
// confirms the tampered receipt is rejected — a clean-room re-derivation.
import { Daytona } from '@daytonaio/sdk';
import { writeFileSync } from 'node:fs';

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY, apiUrl: process.env.DAYTONA_API_URL || 'https://app.daytona.io/api' });
const EMBED = new URL('../embed.json', import.meta.url).pathname; // the same JSON the public results fn returns

const PY = `
import json, hashlib, os, glob
cands = ['glasswork_data.json', os.path.expanduser('~/glasswork_data.json')] + glob.glob('/home/**/glasswork_data.json', recursive=True) + glob.glob('/root/**/glasswork_data.json', recursive=True)
path = next((p for p in cands if os.path.exists(p)), None)
if not path:
    print("DAYTONA_ATTEST " + json.dumps({"verdict":"FAIL","error":"data file not found","cwd":os.getcwd(),"ls":os.listdir('.')}))
else:
    d = json.load(open(path))
    def leaf(pre): return hashlib.sha256(bytes([0])+pre.encode()).hexdigest()
    def node(l,r): return hashlib.sha256(bytes([1])+bytes.fromhex(l)+bytes.fromhex(r)).hexdigest()
    def merkle(ls):
        while len(ls) > 1:
            nx=[]
            for i in range(0,len(ls),2):
                l=ls[i]; r=ls[i+1] if i+1<len(ls) else ls[i]
                nx.append(node(l,r))
            ls=nx
        return ls[0]
    runs={r['id']:r for r in d['runs']}
    by={}
    for lf in sorted(d['custody']['leaves'], key=lambda x:(x['model_id'], x['seq'])):
        run=runs[lf['run_id']]
        pre=run['op_preimage'] if lf['leaf_type']=='operational' else run['content_preimage']
        by.setdefault(lf['model_id'],[]).append(leaf(pre))
    reproduced=0; total=0; tamper_caught=False
    for root in d['custody']['roots']:
        total+=1
        match=(merkle(by[root['model_id']])==root['root_sha256'])
        if root.get('tampered'): tamper_caught=(not match)
        elif match: reproduced+=1
    verdict = "PASS" if (reproduced==total-1 and tamper_caught) else "FAIL"
    print("DAYTONA_ATTEST " + json.dumps({"reproduced_roots":reproduced,"total_roots":total,"tamper_caught":tamper_caught,"verdict":verdict,"python":os.sys.version.split()[0]}))
`;

(async () => {
  console.error('creating Daytona sandbox...');
  const sandbox = await daytona.create({ language: 'python' });
  const sid = sandbox.id;
  console.error('sandbox:', sid);
  let out = '';
  try {
    await sandbox.fs.uploadFile(EMBED, 'glasswork_data.json');
    console.error('uploaded dataset');
    const res = await sandbox.process.codeRun(PY);
    out = (res && (res.result ?? res.stdout ?? res.output)) || '';
    console.error('exitCode:', res && res.exitCode);
    console.error(out);
  } finally {
    try { await sandbox.delete(); console.error('sandbox deleted'); } catch (e) { console.error('delete err', e.message); }
  }
  const line = (out.split('\n').find(l => l.includes('DAYTONA_ATTEST')) || '').replace('DAYTONA_ATTEST', '').trim();
  let attest = null; try { attest = JSON.parse(line); } catch {}
  writeFileSync(new URL('./daytona_attestation.json', import.meta.url), JSON.stringify({ provider: 'daytona', sandbox_id: sid, api_url: 'https://app.daytona.io/api', verified_at: new Date().toISOString(), attest, raw: out.slice(0, 1500) }, null, 2));
  console.error('WROTE daytona_attestation.json | verdict:', attest && attest.verdict);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
