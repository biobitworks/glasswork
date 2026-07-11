// Glasswork build orchestrator — runs the open-model ladder over a gold set,
// scores deterministically, and builds FCO custody receipts (RFC6962 domain
// separation: leaf 0x00, node 0x01). Produces results.json.
//
// Reproducible: temperature 0, fixed prompt, deterministic scorer. Re-running
// yields the same scoring for the same model outputs.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('./.env', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((l) => {
      const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)];
    })
);
const APP = env.BUTTERBASE_APP_ID;
const BASE = env.BUTTERBASE_API_URL;
const KEY = env.BUTTERBASE_API_KEY;
const SESSION = 'sess-glasswork-demo-1';

// ---- Model ladder (IDs verified live against /v1/public/models) ----
const MODELS = [
  { model_id: 'meta-llama/llama-3.2-1b-instruct',  family: 'llama',   params_b: 1,   tier: 'small', in: 0.0324, out: 0.2412, context: '131K' },
  { model_id: 'meta-llama/llama-3.2-3b-instruct',  family: 'llama',   params_b: 3,   tier: 'small', in: 0.06,   out: 0.396,  context: '131K' },
  { model_id: 'meta-llama/llama-3.1-8b-instruct',  family: 'llama',   params_b: 8,   tier: 'small', in: 0.024,  out: 0.036,  context: '131K' },
  { model_id: 'qwen/qwen3-8b',                     family: 'qwen',    params_b: 8,   tier: 'small', in: 0.1404, out: 0.546,  context: '131K' },
  { model_id: 'openai/gpt-oss-20b',                family: 'gpt-oss', params_b: 20,  tier: 'mid',   in: 0.0348, out: 0.168,  context: '131K' },
  { model_id: 'microsoft/phi-4',                   family: 'phi',     params_b: 14,  tier: 'mid',   in: 0.084,  out: 0.168,  context: '16K'  },
  { model_id: 'qwen/qwen3-14b',                    family: 'qwen',    params_b: 14,  tier: 'mid',   in: 0.12,   out: 0.288,  context: '131K' },
  { model_id: 'google/gemma-3-27b-it',             family: 'gemma',   params_b: 27,  tier: 'mid',   in: 0.096,  out: 0.192,  context: '131K' },
  { model_id: 'qwen/qwen3-32b',                    family: 'qwen',    params_b: 32,  tier: 'mid',   in: 0.096,  out: 0.336,  context: '131K' },
  { model_id: 'meta-llama/llama-3.3-70b-instruct', family: 'llama',   params_b: 70,  tier: 'large', in: 0.12,   out: 0.384,  context: '131K' },
  { model_id: 'openai/gpt-oss-120b',               family: 'gpt-oss', params_b: 120, tier: 'large', in: 0.0432, out: 0.216,  context: '131K' },
  { model_id: 'qwen/qwen3-235b-a22b-2507',         family: 'qwen',    params_b: 235, active_b: 22, tier: 'large', in: 0.108, out: 0.12, context: '262K' },
];

// ---- Gold set: 2 short factual docs, atomic claims with keyword signatures ----
const DOCS = [
  {
    id: 'doc-photosynthesis',
    title: 'Photosynthesis (biology primer)',
    doc_text:
      'Photosynthesis is the process by which green plants, algae, and some bacteria convert light energy into chemical energy. ' +
      'It takes place mainly in the chloroplasts, which contain the green pigment chlorophyll. ' +
      'During the light-dependent reactions, water molecules are split, releasing oxygen as a byproduct. ' +
      'The Calvin cycle uses carbon dioxide from the air to build glucose. ' +
      'The overall reaction converts six molecules of carbon dioxide and six molecules of water into one molecule of glucose and six molecules of oxygen.',
    gold: [
      { id: 'p1', text: 'Photosynthesis converts light energy into chemical energy.', kw: ['light', 'chemical'] },
      { id: 'p2', text: 'It is carried out by green plants, algae, and some bacteria.', kw: ['plants', 'algae'] },
      { id: 'p3', text: 'It takes place mainly in the chloroplasts.', kw: ['chloroplast'] },
      { id: 'p4', text: 'Chloroplasts contain the pigment chlorophyll.', kw: ['chlorophyll'] },
      { id: 'p5', text: 'The light-dependent reactions split water molecules.', kw: ['water', 'split'] },
      { id: 'p6', text: 'Oxygen is released as a byproduct.', kw: ['releas', 'oxygen'] },
      { id: 'p7', text: 'The Calvin cycle uses carbon dioxide to build glucose.', kw: ['calvin', 'glucose'] },
      { id: 'p8', text: 'The overall reaction yields glucose from six carbon dioxide and six water.', kw: ['six', 'glucose'] },
    ],
  },
  {
    id: 'doc-water-cycle',
    title: 'The water cycle (earth science primer)',
    doc_text:
      'The water cycle describes how water moves continuously through the Earth and its atmosphere. ' +
      'Evaporation turns liquid water from oceans and lakes into water vapor. ' +
      'As the vapor rises and cools, condensation forms clouds. ' +
      'When the droplets grow heavy enough, precipitation falls as rain or snow. ' +
      'Water that reaches the ground can flow into rivers through runoff, before eventually returning to the ocean. ' +
      'The Sun provides the energy that drives the entire water cycle.',
    gold: [
      { id: 'w1', text: 'Water moves through the Earth and its atmosphere.', kw: ['atmosphere'] },
      { id: 'w2', text: 'Evaporation turns liquid water into water vapor.', kw: ['evaporation', 'vapor'] },
      { id: 'w3', text: 'Water evaporates from oceans and lakes.', kw: ['lakes'] },
      { id: 'w4', text: 'Condensation forms clouds.', kw: ['condensation', 'cloud'] },
      { id: 'w5', text: 'Precipitation falls as rain or snow.', kw: ['precipitation'] },
      { id: 'w6', text: 'Water flows into rivers through runoff.', kw: ['runoff'] },
      { id: 'w7', text: 'Water eventually returns to the ocean.', kw: ['return', 'ocean'] },
      { id: 'w8', text: 'The Sun provides the energy that drives the cycle.', kw: ['sun', 'energy'] },
    ],
  },
];

const PASS_PRECISION = 0.80;
const PASS_RECALL = 0.75;

// ---- helpers ----
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');
// domain-separated leaf: sha256(0x00 || utf8(preimage))
const leafHash = (preimage) => sha256hex(Buffer.concat([Buffer.from([0x00]), Buffer.from(preimage, 'utf8')]));
// domain-separated internal node: sha256(0x01 || left_bytes || right_bytes)
const nodeHash = (lHex, rHex) => sha256hex(Buffer.concat([Buffer.from([0x01]), Buffer.from(lHex, 'hex'), Buffer.from(rHex, 'hex')]));
function merkleRoot(leafHexes) {
  if (leafHexes.length === 0) return sha256hex(Buffer.from([]));
  let level = leafHexes.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const l = level[i], r = i + 1 < level.length ? level[i + 1] : level[i]; // duplicate last if odd
      next.push(nodeHash(l, r));
    }
    level = next;
  }
  return level[0];
}

function extractJsonArray(text) {
  if (!text) return null;
  // strip code fences
  let t = text.replace(/```json/gi, '```').replace(/```/g, '');
  const start = t.indexOf('[');
  if (start < 0) return null;
  // find matching close bracket by depth
  let depth = 0, end = -1;
  for (let i = start; i < t.length; i++) {
    if (t[i] === '[') depth++;
    else if (t[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

function score(doc, claims) {
  const docN = norm(doc.doc_text);
  const preds = (Array.isArray(claims) ? claims : []).map((c) => {
    const claimTxt = typeof c === 'string' ? c : (c.claim || c.text || '');
    const span = typeof c === 'string' ? '' : (c.supporting_span || c.span || c.evidence || '');
    const spanN = norm(span);
    const grounded = spanN.length >= 8 && docN.includes(spanN);
    return { claimTxt, span, hay: norm(claimTxt + ' ' + span), grounded };
  });
  const goldUsed = new Array(doc.gold.length).fill(false);
  const predMatched = new Array(preds.length).fill(false);
  let tp = 0;
  for (let gi = 0; gi < doc.gold.length; gi++) {
    const g = doc.gold[gi];
    for (let pi = 0; pi < preds.length; pi++) {
      if (predMatched[pi]) continue;
      const p = preds[pi];
      if (!p.grounded) continue; // hallucinated / ungrounded span cannot be a true positive
      if (g.kw.every((k) => p.hay.includes(k))) {
        goldUsed[gi] = true; predMatched[pi] = true; tp++; break;
      }
    }
  }
  const asserted = preds.length;
  const gold_n = doc.gold.length;
  const precision = asserted ? tp / asserted : 0;
  const recall = gold_n ? tp / gold_n : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, asserted, gold_n, precision, recall, f1, preds: preds.map((p) => ({ claim: p.claimTxt, supporting_span: p.span, grounded: p.grounded })) };
}

const SYS = 'You are a precise information-extraction engine. Extract every distinct factual claim stated in the document. ' +
  'For each claim, return an object with "claim" (a short declarative sentence) and "supporting_span" (copied verbatim from the document). ' +
  'Return ONLY a JSON array of such objects and nothing else.';

async function callModel(model, doc) {
  const messages = [{ role: 'system', content: SYS }, { role: 'user', content: doc.doc_text }];
  const promptStr = JSON.stringify(messages);
  const t0 = Date.now();
  let content = '', usage = {}, err = null;
  try {
    const r = await fetch(`${BASE}/v1/${APP}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: model.model_id, messages, temperature: 0, max_tokens: 900 }),
    });
    const j = await r.json();
    if (!r.ok) { err = JSON.stringify(j).slice(0, 300); }
    else { content = j.choices?.[0]?.message?.content ?? ''; usage = j.usage || {}; }
  } catch (e) { err = String(e); }
  const latency_ms = Date.now() - t0;
  const tokens_in = usage.prompt_tokens ?? 0;
  const tokens_out = usage.completion_tokens ?? 0;
  let usd_cost, cost_source;
  if (typeof usage.cost === 'number') { usd_cost = usage.cost; cost_source = 'measured'; }
  else { usd_cost = (tokens_in / 1e6) * model.in + (tokens_out / 1e6) * model.out; cost_source = 'computed'; }
  const claims = extractJsonArray(content);
  const sc = score(doc, claims);
  const prompt_sha256 = sha256hex(Buffer.from(promptStr, 'utf8'));
  const output_sha256 = sha256hex(Buffer.from(content, 'utf8'));
  return { model, doc, err, content, tokens_in, tokens_out, usd_cost, cost_source, latency_ms, prompt_sha256, output_sha256, ...sc };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.min(size, items.length)).fill(0).map(async () => {
    while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return out;
}

(async () => {
  const tasks = [];
  for (const m of MODELS) for (const d of DOCS) tasks.push({ m, d });
  console.error(`Running ${tasks.length} inference calls (${MODELS.length} models x ${DOCS.length} docs)...`);
  const raw = await pool(tasks, 4, async (t) => {
    const r = await callModel(t.m, t.d);
    console.error(`  ${t.m.model_id.padEnd(34)} ${t.d.id.padEnd(20)} P=${r.precision.toFixed(2)} R=${r.recall.toFixed(2)} tok=${r.tokens_in}/${r.tokens_out} $${r.usd_cost.toExponential(2)} ${r.err ? 'ERR ' + r.err : ''}`);
    return r;
  });

  // Assemble runs + per-model custody
  const runs = [];
  const custody_leaves = [];
  const custody_roots = [];
  const perModel = {};
  for (const r of raw) {
    const run_id = `${r.model.model_id.replace(/[^a-z0-9]/gi, '_')}__${r.doc.id}`;
    const op_preimage = `${r.model.model_id}|${SESSION}|${r.tokens_in}|${r.tokens_out}|${r.usd_cost.toFixed(10)}`;
    const content_preimage = `${r.prompt_sha256}|${r.output_sha256}`;
    const op_leaf = leafHash(op_preimage);
    const content_leaf = leafHash(content_preimage);
    runs.push({
      id: run_id, model_id: r.model.model_id, item_id: r.doc.id,
      output: r.preds, precision: +r.precision.toFixed(4), recall: +r.recall.toFixed(4), f1: +r.f1.toFixed(4),
      tp: r.tp, asserted: r.asserted, gold_n: r.gold_n,
      tokens_in: r.tokens_in, tokens_out: r.tokens_out, usd_cost: r.usd_cost, cost_source: r.cost_source,
      latency_ms: r.latency_ms, prompt_sha256: r.prompt_sha256, output_sha256: r.output_sha256,
      op_preimage, content_preimage, op_leaf, content_leaf, output_text: r.content,
    });
    (perModel[r.model.model_id] ??= { model: r.model, leaves: [], runs: [] });
    perModel[r.model.model_id].leaves.push(op_leaf, content_leaf);
    perModel[r.model.model_id].runs.push(run_id);
  }

  // custody leaves rows + per-model roots (with one staged tamper for the demo)
  const TAMPER_MODEL = 'openai/gpt-oss-20b';
  for (const [mid, pm] of Object.entries(perModel)) {
    let seq = 0;
    for (const run_id of pm.runs) {
      const run = runs.find((x) => x.id === run_id);
      custody_leaves.push({ run_id, model_id: mid, session_id: SESSION, leaf_type: 'operational', seq: seq++, sha256: run.op_leaf, parent_sha256: null });
      custody_leaves.push({ run_id, model_id: mid, session_id: SESSION, leaf_type: 'content', seq: seq++, sha256: run.content_leaf, parent_sha256: null });
    }
    const trueRoot = merkleRoot(pm.leaves);
    const tampered = mid === TAMPER_MODEL;
    // stored root is deliberately corrupted for the tamper demo -> browser Verify recomputes true root and flags mismatch
    const storedRoot = tampered ? trueRoot.slice(0, -1) + (trueRoot.slice(-1) === '0' ? '1' : '0') : trueRoot;
    custody_roots.push({ model_id: mid, session_id: SESSION, root_sha256: storedRoot, leaf_count: pm.leaves.length, tampered });
  }

  // Per-model aggregate scores (micro-average across docs) + decision
  const modelAgg = MODELS.map((m) => {
    const rs = runs.filter((r) => r.model_id === m.model_id);
    const tp = rs.reduce((a, r) => a + r.tp, 0);
    const asserted = rs.reduce((a, r) => a + r.asserted, 0);
    const gold = rs.reduce((a, r) => a + r.gold_n, 0);
    const precision = asserted ? tp / asserted : 0;
    const recall = gold ? tp / gold : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    const usd_total = rs.reduce((a, r) => a + r.usd_cost, 0);
    const passes = precision >= PASS_PRECISION && recall >= PASS_RECALL;
    return { model_id: m.model_id, family: m.family, params_b: m.params_b, tier: m.tier,
      usd_per_1m_in: m.in, usd_per_1m_out: m.out, precision: +precision.toFixed(4), recall: +recall.toFixed(4),
      f1: +f1.toFixed(4), usd_total, passes };
  });
  const passing = modelAgg.filter((m) => m.passes).sort((a, b) => a.usd_total - b.usd_total);
  const chosen = passing[0] || null;

  const out = {
    _meta: { app_id: APP, session: SESSION, generated_by: 'run.mjs', pass_floor: { precision: PASS_PRECISION, recall: PASS_RECALL },
      corpus: { docs: DOCS.length, gold_claims: DOCS.reduce((a, d) => a + d.gold.length, 0) } },
    docs: DOCS, models: MODELS, runs, custody_leaves, custody_roots, modelAgg,
    decision: chosen ? { chosen_model: chosen.model_id, reason: 'cheapest model meeting precision>=0.80 and recall>=0.75 on this corpus', usd_total: chosen.usd_total } : null,
  };
  writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(out, null, 2));
  console.error('\n=== per-model aggregate ===');
  for (const m of modelAgg.sort((a, b) => a.params_b - b.params_b))
    console.error(`  ${m.model_id.padEnd(34)} P=${m.precision.toFixed(2)} R=${m.recall.toFixed(2)} F1=${m.f1.toFixed(2)} $${m.usd_total.toExponential(2)} ${m.passes ? 'PASS' : 'fail'}`);
  console.error(`\nDecision: cheapest passing = ${chosen ? chosen.model_id + ' ($' + chosen.usd_total.toExponential(2) + ')' : 'NONE'}`);
  console.error('results.json written.');
})();
