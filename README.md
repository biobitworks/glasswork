# Glasswork

**Automate the task. Audit every answer.**

A thoughtful productivity agent that runs your task across a spread of open-source models, scores each on **your** task, picks the **cheapest model that passes** a bar you set, and attaches a **recompute-verifiable custody receipt** to every single call — so you can hand off the work and actually audit it.

- **Live demo:** https://glasswork.butterbase.dev
- **60-second narrated walkthrough:** https://glasswork.butterbase.dev/#demo
- Built entirely on **[Butterbase](https://butterbase.dev)** for **HackwithBay 3.0**.

---

## What it shows (real data, not a mockup)

A real task — extract every factual claim + its supporting span from a document — run through **12 open-weight models (1B → 235B)** on Butterbase's AI gateway, graded against a hand-labeled gold set. Every number on the site is served live from the app's own database.

The receipts tell a story that's better than "small always beats large," because it's true and counterintuitive:

- **Every model that returned valid output scored 100% precision** — no ungrounded (hallucinated) span survived.
- **Size did not predict recall.** The best score came from a **27B Gemma (94%)**; the **70B Llama landed near the bottom (44%)** because it emitted **invalid JSON** on one document — unusable by an automated pipeline, and exactly the failure you only catch by checking.
- So the agent picks by **measurement, not size or price**: the cheapest passing model here is `google/gemma-3-27b-it` — not the biggest, not the priciest.

## The differentiator — the error surface

Most paper-to-result agents hand you an answer and stop. Glasswork hands you the answer **plus where it's wrong**: measured against a gold standard, exactly which facts each model recovered, which it **missed**, and a flag on any claim whose supporting span isn't in the source.

## Custody — a receipt for every call

Each inference emits two hash leaves — an **operational** leaf (model, tokens, cost) and a **content** leaf (hashes of the exact prompt & output bytes) — chained into a per-model Merkle root with RFC 6962 domain separation (leaf `0x00`, node `0x01`; duplicate-last pairing). The site's **Verify** button re-derives the root in your browser (Web Crypto / SHA-256) and rejects a tampered one. A **deterministic core** (fixed prompt, temperature 0, rule-based scorer) makes the scoring and custody reproducible: same recorded run → same score → same root, every ingest.

Custody proves **provenance** (which model produced which bytes at what cost), **not correctness** — the site says so, plainly.

## Built on Butterbase

- **AI Model Gateway** — all 12 open models, per-call usage recorded.
- **Postgres + Data API** — model catalog, gold set, 24 runs, 60 custody records.
- **Serverless function** (`results`) — assembles the public dataset the page reads.
- **Frontend deployment** — the site itself.

## Repo layout

```
app/index.html                 self-contained SPA (chart, error surface, in-browser custody Verify)
pipeline/run.mjs               reproducible orchestrator: runs the model ladder, scores, builds FCO custody receipts
pipeline/enrich.mjs            adds parse-status labels to runs
data/model_catalog.seed.json   the open-weight model ladder (IDs + list pricing)
data/results.sample.json       a full sample output (models, runs, scores, custody leaves/roots) — verify the Merkle roots offline
partners/glasswork_pipeline.public.json  secret-free RocketRide Cloud pipeline (webhook -> llm_nebius -> answers), community-runnable
partners/rr_pipeline.mjs        runs that pipeline on RocketRide Cloud
```

## Reproduce

`pipeline/run.mjs` runs the whole ladder against Butterbase's OpenAI-compatible gateway. It needs a Butterbase API key with the `ai:gateway` scope:

```bash
# .env  (never commit this)
BUTTERBASE_APP_ID=app_xxx
BUTTERBASE_API_URL=https://api.butterbase.ai
BUTTERBASE_API_KEY=bb_sk_...
node pipeline/run.mjs      # -> results.json (scores + custody)
node pipeline/enrich.mjs   # -> parse-status labels
```

Scoring is deterministic (temperature 0, rule-based matcher), so re-running reproduces the same scores and the same custody roots for the same model outputs.

## Run the same task on RocketRide Cloud

The third inference route runs the extraction as a **RocketRide Cloud pipeline** (`webhook → llm_nebius → answers`) on Nebius Llama-3.3-70B — a genuinely different route from the Butterbase gateway that returns the same claims.

The pipeline definition is `partners/glasswork_pipeline.public.json` — **secret-free**: the model key is a `${ROCKETRIDE_NEBIUS_KEY}` placeholder that RocketRide substitutes from your env at run time, so no key is ever written to disk.

```bash
export ROCKETRIDE_API_KEY=rr_...     # your RocketRide key (auth)
export ROCKETRIDE_NEBIUS_KEY=...     # your Nebius Token Factory key (substituted into the pipeline)
```

```js
import { RocketRideClient, Question } from 'rocketride';
const c = new RocketRideClient({ auth: process.env.ROCKETRIDE_API_KEY, uri: 'https://api.rocketride.ai' });
await c.connect();
const { token } = await c.use({ filepath: 'partners/glasswork_pipeline.public.json' });
const q = new Question({ expectJson: true });
q.addContext('<your document text>');
q.addQuestion('Extract the factual claims as a JSON array of {claim, supporting_span}.');
console.log((await c.chat({ token, question: q })).answers);
await c.terminate(token); await c.disconnect();
```

It's also published to RocketRide Cloud as a named template (`glasswork-claim-extraction`) and a manual deployment, so it shows in the RocketRide monitor and can be launched from there.

## Method / prior work

Custody applies the published **Fractal Custody Objects** method:

> Lee, B. (2026). *Fractal Custody Objects: route-comparable chain-of-custody for deterministic computational biology and AI-agent provenance.* Zenodo. https://doi.org/10.5281/zenodo.21210575

Manuscript CC-BY-4.0 / code Apache-2.0. This demo uses only the published method and generates its own fresh demo data.

## Honest ceilings

Accuracy is on **this** task/corpus, not universal. Custody proves provenance, not correctness or reproducibility of the model. Cost is Butterbase-reported (auditable, not an independent benchmark). An LLM verdict is a signal, never a custody proof.
