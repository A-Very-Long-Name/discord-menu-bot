CREATE TABLE entree_votes_fine(
 dish TEXT NOT NULL,serving_date TEXT NOT NULL,user_id TEXT NOT NULL,
 value INTEGER NOT NULL CHECK(value IN(-1,0,1,2)),PRIMARY KEY(dish,serving_date,user_id)
);
INSERT INTO entree_votes_fine SELECT dish,serving_date,user_id,value FROM entree_votes;
DROP TABLE entree_votes;
ALTER TABLE entree_votes_fine RENAME TO entree_votes;
