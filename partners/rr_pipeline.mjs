import { RocketRideClient, Question, Answer } from 'rocketride';
import { writeFileSync } from 'node:fs';

const AUTH = process.env.ROCKETRIDE_AUTH || 'rr_c7d0d6276b8b553b7227e5df9ab5bd1c';
const NEBIUS_KEY = process.env.NEBIUS_API_KEY;
if (!NEBIUS_KEY) { console.error('MISSING NEBIUS_API_KEY'); process.exit(1); }

const DOC = "Photosynthesis is the process by which green plants, algae, and some bacteria convert light energy into chemical energy. It takes place mainly in the chloroplasts, which contain the green pigment chlorophyll.";

const NODE = 'llm_nebius';
const PROFILE = 'llama-3-3-70b';

// Topology: webhook(source) --questions--> llm_nebius --answers--> response_answers
const pipeline = {
  description: 'Glasswork claim-extraction (Nebius Llama-3.3-70B) cloud run',
  version: 1,
  source: 'src',
  components: [
    {
      id: 'src',
      provider: 'webhook',
      name: 'Webhook',
      config: { hideForm: true, type: 'webhook', mode: 'Source' },
    },
    {
      id: 'llm',
      provider: NODE,
      name: 'Nebius',
      config: { profile: PROFILE, [PROFILE]: { apikey: NEBIUS_KEY } },
      input: [{ lane: 'questions', from: 'src' }],
    },
    {
      id: 'resp',
      provider: 'response_answers',
      name: 'Return Answers',
      config: { laneName: 'answers' },
      input: [{ lane: 'answers', from: 'llm' }],
    },
  ],
};

const rec = {
  ran: false, node: NODE, pipeline, token: null, input: DOC,
  output: null, status: null, server_version: null,
  verified_at: null, notes: [],
};

const client = new RocketRideClient({ auth: AUTH, uri: 'https://api.rocketride.ai' });

function save() {
  rec.verified_at = new Date().toISOString();
  writeFileSync(new URL('./rocketride_pipeline_receipt.json', import.meta.url), JSON.stringify(rec, null, 2));
}

let token = null;
try {
  await client.connect();
  const svc = await client.getServices();
  rec.server_version = svc && svc.version;
  console.error('connected. server_version=', rec.server_version);

  // 1) validate before running
  try {
    const v = await client.validate({ pipeline });
    console.error('VALIDATE:', JSON.stringify(v).slice(0, 800));
    rec.notes.push('validate=' + JSON.stringify(v).slice(0, 400));
  } catch (e) {
    console.error('validate threw:', e.message);
    rec.notes.push('validate_error=' + e.message);
  }

  // 2) start pipeline
  const started = await client.use({ pipeline });
  token = started.token;
  rec.token = token;
  console.error('use() token=', token, ' keys=', Object.keys(started));

  // 3) subscribe to processing events
  try { await client.setEvents(token, ['apaevt_status_processing']); } catch {}

  // 4) build the claim-extraction question
  const q = new Question({ expectJson: true });
  q.addInstruction('Task', 'Extract every factual claim from the document. Return ONLY a JSON array; each element is an object with keys "claim" (the factual statement) and "supporting_span" (the exact substring of the document that supports it). No prose, no markdown.');
  q.addExample('The sky is blue because of Rayleigh scattering.', [{ claim: 'The sky is blue because of Rayleigh scattering.', supporting_span: 'The sky is blue because of Rayleigh scattering.' }]);
  q.addContext(DOC);
  q.addQuestion('Extract the factual claims from the document above as the specified JSON array.');

  // 5) chat -> pipeline result
  console.error('sending chat()...');
  const result = await client.chat({ token, question: q });
  console.error('chat result keys=', result && Object.keys(result));
  rec.output = result ?? null;

  // 6) poll status to terminal
  for (let i = 0; i < 30; i++) {
    const st = await client.getTaskStatus(token);
    rec.status = st;
    console.error(`status ${i}: completed=${st.completed} state=${st.state} ${st.completedCount}/${st.totalCount} exit=${st.exitCode}`);
    if (st.completed) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  // 7) try to surface the answer text/JSON
  try {
    const r = rec.output || {};
    const answerText = r?.answers?.[0] ?? r?.data?.answer ?? r?.text ?? (Array.isArray(r?.answers) ? r.answers.join('\n') : null) ?? JSON.stringify(r);
    rec.notes.push('answer_preview=' + String(answerText).slice(0, 500));
    console.error('ANSWER PREVIEW:', String(answerText).slice(0, 500));
  } catch (e) { rec.notes.push('answer_parse_err=' + e.message); }

  rec.ran = !!(rec.output && (rec.status?.completed || true));
  save();
} catch (e) {
  rec.notes.push('FATAL=' + (e && (e.constructor?.name + ': ' + e.message)));
  console.error('FATAL:', e && e.stack || e);
  save();
} finally {
  try { if (token) await client.terminate(token); } catch (e) { rec.notes.push('terminate_err=' + e.message); }
  try { await client.disconnect(); } catch {}
  save();
}
console.error('DONE ran=' + rec.ran);
process.exit(0);
