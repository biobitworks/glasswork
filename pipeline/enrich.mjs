import { readFileSync, writeFileSync } from 'node:fs';
const d = JSON.parse(readFileSync(new URL('./results.json', import.meta.url), 'utf8'));
function parseStatus(text) {
  if (!text || !text.trim()) return 'empty';
  let t = text.replace(/```json/gi, '```').replace(/```/g, '');
  const s = t.indexOf('['); if (s < 0) return 'no_array';
  let depth = 0, e = -1;
  for (let i = s; i < t.length; i++) { if (t[i]==='[') depth++; else if (t[i]===']'){depth--; if(!depth){e=i;break;}} }
  if (e < 0) return 'unterminated';
  try { const a = JSON.parse(t.slice(s, e+1)); return Array.isArray(a) ? 'ok' : 'not_array'; }
  catch { return 'invalid_json'; }
}
for (const r of d.runs) {
  const st = parseStatus(r.output_text);
  r.parse_status = st;
  r.note = st === 'ok' ? null
    : st === 'invalid_json' || st === 'unterminated' || st === 'no_array' || st === 'not_array'
      ? 'Model returned text that is not valid JSON — unusable by an automated extraction pipeline.'
      : 'Model returned an empty response.';
}
// attach worst offender summary for the narrative
const invalid = d.runs.filter(r => r.parse_status !== 'ok');
d._meta.parse_failures = invalid.map(r => ({ model_id: r.model_id, item_id: r.item_id, status: r.parse_status }));
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(d, null, 2));
console.log('parse_failures:', JSON.stringify(d._meta.parse_failures));
console.log('runs enriched:', d.runs.length);
