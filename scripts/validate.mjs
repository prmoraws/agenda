import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const sql = fs.readFileSync(
  path.join(
    projectRoot,
    'infrastructure/postgres/init/001-business-scheduler.sql',
  ),
  'utf8',
);
const compose = fs.readFileSync(path.join(projectRoot, 'compose.yaml'), 'utf8');
const server = fs.readFileSync(path.join(projectRoot, 'src/server.mjs'), 'utf8');
const evolution = fs.readFileSync(path.join(projectRoot, 'src/evolution.mjs'), 'utf8');
for (const table of ['business_groups','business_messages','business_deliveries','business_events']) {
  assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
}
assert.match(sql, /UNIQUE \(message_id, group_id\)/);
assert.match(sql, /authorized = FALSE OR confirmed_at IS NOT NULL/);
assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM/i);
assert.match(compose, /127\.0\.0\.1:\$\{AGENDA_PORT:-3010\}:3010/);
assert.match(compose, /edge:\n    name: agenda-edge/);
assert.match(server, /status = 'draft'/);
assert.match(server, /status IN \('draft','confirmed'\)/);
assert.doesNotMatch(server, /sendText|sendMessage|Evolution/);
assert.match(evolution, /fetchAllGroups/);
assert.doesNotMatch(evolution, /sendText|sendMessage|message\/send/);
console.log(JSON.stringify({
  status: 'ok', project: 'agenda', tables: 4, panel: true,
  humanConfirmation: true, cancellation: true, evolutionDiscovery: true,
  sendingEnabled: false,
}));
