import { RocketRideClient } from 'rocketride';
import { writeFileSync } from 'node:fs';

const AUTH = process.env.ROCKETRIDE_AUTH || 'rr_c7d0d6276b8b553b7227e5df9ab5bd1c';
const client = new RocketRideClient({ auth: AUTH, uri: 'https://api.rocketride.ai' });

await client.connect();
const svc = await client.getServices();
const services = (svc && svc.services) || {};
const names = Object.keys(services);
console.error('server_version=', svc.version, ' node_count=', names.length);
console.error('ALL NODE NAMES:\n' + names.join(', '));

// Candidate nodes we care about for a tiny text->text/json run
const wanted = names.filter((n) => /webhook|response|source|input|output|reply|openai|anthropic|nebius|llm|chat|text|prompt|complete|generat/i.test(n));
console.error('\nCANDIDATES:\n' + wanted.join(', '));

// Dump compact schema for candidates so we can see required fields + lanes
const dump = {};
for (const n of wanted) {
  const node = services[n];
  // reduce to the useful bits
  dump[n] = {
    keys: Object.keys(node || {}),
    schema: node?.schema ?? node?.Pipe?.schema ?? node?.config?.schema ?? null,
    node_raw_preview: node,
  };
}
writeFileSync(new URL('./rr_schemas_dump.json', import.meta.url), JSON.stringify({ version: svc.version, all_nodes: names, candidates: wanted, dump }, null, 2));
console.error('\nWrote rr_schemas_dump.json');

await client.disconnect();
process.exit(0);
