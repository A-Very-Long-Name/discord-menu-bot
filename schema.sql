CREATE TABLE IF NOT EXISTS deliveries (
  delivery_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  message_id TEXT
);
CREATE TABLE IF NOT EXISTS rating_dishes(id TEXT PRIMARY KEY,name TEXT NOT NULL,school TEXT NOT NULL DEFAULT 'sps');
CREATE TABLE IF NOT EXISTS entree_votes(
 school TEXT NOT NULL DEFAULT 'sps',dish TEXT NOT NULL, serving_date TEXT NOT NULL,user_id TEXT NOT NULL,
 value INTEGER NOT NULL CHECK(value IN(-1,0,1,2)),PRIMARY KEY(school,dish,serving_date,user_id)
);

CREATE TABLE IF NOT EXISTS school_bindings(
 scope_id TEXT PRIMARY KEY,school TEXT NOT NULL,channel_id TEXT,
 lunch_min INTEGER NOT NULL DEFAULT 420,dinner_min INTEGER NOT NULL DEFAULT 900,
 enabled INTEGER NOT NULL DEFAULT 0
);
