const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

let db;
const DB_PATH = path.join(__dirname, 'zerkalo.db');

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const data = fs.readFileSync(DB_PATH);
    db = new SQL.Database(data);
  } else {
    db = new SQL.Database();
  }
  db.run(`
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
      voter_id TEXT,
      article_id INTEGER,
      type TEXT,
      UNIQUE(voter_id, article_id)
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      password TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      article_id INTEGER,
      text TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);
  save();
  return db;
}

function save() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

module.exports = { getDb, save };