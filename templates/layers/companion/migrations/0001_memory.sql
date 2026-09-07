CREATE TABLE IF NOT EXISTS companion_memory (
  memory_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL
);
