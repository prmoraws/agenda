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
for (const table of ['business_groups','business_messages','business_deliveries','business_events']) {
  assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
}
assert.match(sql, /UNIQUE \(message_id, group_id\)/);
assert.match(sql, /authorized = FALSE OR confirmed_at IS NOT NULL/);
assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM/i);
console.log(JSON.stringify({status:'ok',project:'agenda',tables:4,idempotency:true}));
