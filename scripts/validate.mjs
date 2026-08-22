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
const deliveryWorker = fs.readFileSync(path.join(projectRoot, 'src/delivery-worker.mjs'), 'utf8');
const communityMigration = fs.readFileSync(
  path.join(projectRoot, 'infrastructure/postgres/migrations/002-group-community-metadata.sql'),
  'utf8',
);
const legacyJidMigration = fs.readFileSync(
  path.join(projectRoot, 'infrastructure/postgres/migrations/003-legacy-group-jid.sql'),
  'utf8',
);
const lifecycleMigration = fs.readFileSync(
  path.join(projectRoot, 'infrastructure/postgres/migrations/004-message-lifecycle.sql'),
  'utf8',
);
const imageMigration = fs.readFileSync(
  path.join(projectRoot, 'infrastructure/postgres/migrations/005-message-image.sql'),
  'utf8',
);
const recurrenceMigration = fs.readFileSync(
  path.join(projectRoot, 'infrastructure/postgres/migrations/006-weekly-recurrence.sql'),
  'utf8',
);
const labelsMigration = fs.readFileSync(
  path.join(projectRoot, 'infrastructure/postgres/migrations/007-group-labels.sql'),
  'utf8',
);
const templatesMigration = fs.readFileSync(
  path.join(projectRoot, 'infrastructure/postgres/migrations/008-message-templates.sql'),
  'utf8',
);
const panelHtml = fs.readFileSync(path.join(projectRoot, 'src/public/index.html'), 'utf8');
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
assert.match(server, /WHATSAPP_SENDING_ENABLED === 'true'/);
assert.match(server, /startDeliveryWorker/);
assert.match(evolution, /fetchAllGroups/);
assert.match(evolution, /message\/sendText/);
assert.match(deliveryWorker, /FOR UPDATE OF d SKIP LOCKED/);
assert.match(deliveryWorker, /attempt_count < d\.max_attempts/);
assert.match(compose, /WHATSAPP_SENDING_ENABLED:-false/);
assert.match(communityMigration, /community_announcement/);
assert.doesNotMatch(communityMigration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
assert.match(legacyJidMigration, /\(-\[0-9\]\+\)\?/);
assert.doesNotMatch(legacyJidMigration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
assert.match(lifecycleMigration, /'deleted'/);
assert.doesNotMatch(lifecycleMigration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
assert.match(server, /app\.put\('\/api\/messages\/:id'/);
assert.match(server, /app\.delete\('\/api\/messages\/:id'/);
assert.match(imageMigration, /media_mime_type/);
assert.doesNotMatch(imageMigration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
assert.match(evolution, /message\/sendMedia/);
assert.match(server, /validateMediaInput/);
assert.match(recurrenceMigration, /recurrence_type/);
assert.match(recurrenceMigration, /occurrence_count BETWEEN 1 AND 52/);
assert.doesNotMatch(recurrenceMigration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
assert.match(server, /confirm-series/);
assert.match(server, /cancel-series/);
assert.match(labelsMigration, /CREATE TABLE IF NOT EXISTS business_labels/);
assert.match(labelsMigration, /CREATE TABLE IF NOT EXISTS business_group_labels/);
assert.doesNotMatch(labelsMigration, /DROP TABLE|TRUNCATE/i);
assert.match(server, /app\.get\('\/api\/dashboard'/);
assert.match(server, /app\.post\('\/api\/labels\/import'/);
assert.match(server, /app\.post\('\/api\/groups\/from-invite'/);
assert.match(server, /app\.post\('\/api\/groups\/from-invites'/);
assert.match(server, /app\.post\('\/api\/groups\/:id\/revoke'/);
assert.match(server, /app\.post\('\/api\/groups\/:id\/restore'/);
assert.match(server, /app\.delete\('\/api\/groups\/:id'/);
assert.match(server, /app\.post\('\/api\/messages\/:id\/reuse'/);
assert.match(templatesMigration, /CREATE TABLE IF NOT EXISTS business_message_templates/);
assert.doesNotMatch(templatesMigration, /DROP TABLE|TRUNCATE/i);
assert.match(server, /app\.post\('\/api\/templates'/);
assert.match(evolution, /group\/inviteInfo/);
assert.match(server, /active: \['draft','confirmed','processing'\]/);
assert.match(panelHtml, /data-page="dashboard"/);
assert.match(panelHtml, /id="messages-sent"/);
console.log(JSON.stringify({
  status: 'ok', project: 'agenda', tables: 4, panel: true,
  humanConfirmation: true, cancellation: true, evolutionDiscovery: true,
  deliveryWorker: true, imageScheduling: true, weeklyRecurrence: true,
  groupLabels: true, inviteLinkImport: true, bulkInviteImport: true,
  groupLifecycle: true, messageReuse: true, messageTemplates: true,
  dashboard: true, sentArchive: true,
  sendingDefault: false,
}));
