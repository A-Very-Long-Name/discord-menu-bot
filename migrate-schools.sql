ALTER TABLE rating_dishes ADD COLUMN school TEXT NOT NULL DEFAULT 'sps';
CREATE TABLE entree_votes_schools(school TEXT NOT NULL DEFAULT 'sps',dish TEXT NOT NULL,serving_date TEXT NOT NULL,user_id TEXT NOT NULL,value INTEGER NOT NULL CHECK(value IN(-1,0,1,2)),PRIMARY KEY(school,dish,serving_date,user_id));
INSERT INTO entree_votes_schools(school,dish,serving_date,user_id,value) SELECT 'sps',dish,serving_date,user_id,value FROM entree_votes;
DROP TABLE entree_votes;
ALTER TABLE entree_votes_schools RENAME TO entree_votes;
CREATE TABLE school_bindings(scope_id TEXT PRIMARY KEY,school TEXT NOT NULL,channel_id TEXT,lunch_min INTEGER NOT NULL DEFAULT 420,dinner_min INTEGER NOT NULL DEFAULT 900,enabled INTEGER NOT NULL DEFAULT 0);
