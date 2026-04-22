const Database = require('better-sqlite3');
const db = new Database('zerkalo.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guid TEXT UNIQUE,
    title TEXT,
    excerpt TEXT,
    image TEXT,
    category TEXT,
    link TEXT,
    published_at INTEGER,
    likes INTEGER DEFAULT 0,
    dislikes INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    article_id INTEGER,
    type TEXT,
    UNIQUE(user_id, article_id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT,
    last_name TEXT,
    email TEXT UNIQUE,
    password TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    article_id INTEGER,
    text TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
`);

module.exports = db;