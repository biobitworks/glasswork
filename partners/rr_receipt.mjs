import { RocketRideClient } from 'rocketride';
import { writeFileSync } from 'node:fs';
const client = new RocketRideClient({ auth: process.env.ROCKETRIDE_AUTH, uri: 'https://api.rocketride.ai' });
let rec = { provider: 'rocketride', connected: false };
try {
  const info = await client.connect();
  const svc = await client.getServices();
  const nodes = Object.keys((svc && svc.services) || {});
  rec = { provider: 'rocketride', connected: true, uri: 'wss://api.rocketride.ai/task/service',
    user: info.displayName || info.preferredUsername || info.email || info.userId,
    credits: info.credits, node_count: nodes.length,
    sample_nodes: nodes.slice(0, 8), server_version: svc && svc.version,
    verified_at: new Date().toISOString() };
} catch (e) { rec.error = e.constructor.name + ': ' + e.message; }
finally { try { await client.disconnect(); } catch {} }
writeFileSync(new URL('./rocketride_receipt.json', import.meta.url), JSON.stringify(rec, null, 2));
console.error('RR receipt: connected=' + rec.connected + ' nodes=' + rec.node_count + ' user=' + rec.user);
process.exit(0);
