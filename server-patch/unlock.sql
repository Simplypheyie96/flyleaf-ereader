-- Store unlocks, one row per store purchase. Add to server/schema.sql, then:
-- npx wrangler d1 execute flyleaf --remote --file=server/unlock.sql
CREATE TABLE IF NOT EXISTS unlocks (
  ref TEXT PRIMARY KEY,         -- ios_<transactionId> or android_<orderId>
  user_id TEXT NOT NULL,
  app TEXT NOT NULL,            -- reader, journal, press
  product TEXT NOT NULL,
  store TEXT NOT NULL,          -- apple or play
  env TEXT,                     -- Production, Sandbox, Xcode or Test
  at INTEGER NOT NULL,
  revoked INTEGER               -- set by a refund or revoke notice
);
CREATE INDEX IF NOT EXISTS unlocks_user ON unlocks (user_id, app);
