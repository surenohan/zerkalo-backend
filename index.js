require('dotenv').config();
const express = require('express');
const cors = require('cors');
const schedule = require('node-schedule');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb, save } = require('./database');
const { fetchAndSave } = require('./parser');

const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, 'zerkalo.db');
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log('Old DB deleted');
}

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'zerkalo_secret';

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Нет токена' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Токен недействителен' });
  }
}

// ── ЛЕНТА ──
app.get('/api/feed', async (req, res) => {
  const db = await getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const result = db.exec(`SELECT * FROM articles ORDER BY published_at DESC LIMIT ${limit} OFFSET ${offset}`);
  const articles = result.length ? result[0].values.map(row => ({
    id: row[0], guid: row[1], title: row[2], excerpt: row[3],
    image: row[4], category: row[5], link: row[6],
    published_at: row[7], likes: row[8], dislikes: row[9]
  })) : [];
  res.json(articles);
});

// ── ПОПУЛЯРНОЕ ──
app.get('/api/popular', async (req, res) => {
  const db = await getDb();
  const result = db.exec(`SELECT * FROM articles ORDER BY likes DESC LIMIT 50`);
  const articles = result.length ? result[0].values.map(row => ({
    id: row[0], guid: row[1], title: row[2], excerpt: row[3],
    image: row[4], category: row[5], link: row[6],
    published_at: row[7], likes: row[8], dislikes: row[9]
  })) : [];
  res.json(articles);
});

// ── НОВИНКИ ──
app.get('/api/new', async (req, res) => {
  const db = await getDb();
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const result = db.exec(`SELECT * FROM articles WHERE published_at > ${since} ORDER BY published_at DESC LIMIT 50`);
  const articles = result.length ? result[0].values.map(row => ({
    id: row[0], guid: row[1], title: row[2], excerpt: row[3],
    image: row[4], category: row[5], link: row[6],
    published_at: row[7], likes: row[8], dislikes: row[9]
  })) : [];
  res.json(articles);
});

// ── ГОЛОСОВАНИЕ ──
app.post('/api/vote', async (req, res) => {
  const db = await getDb();
  const { article_id, type, device_id } = req.body;
  if (!['like', 'dislike'].includes(type)) return res.status(400).json({ error: 'Неверный тип' });
  if (!device_id) return res.status(400).json({ error: 'Нет device_id' });

  const voter_id = device_id;
  const existing = db.exec(`SELECT * FROM votes WHERE voter_id = '${voter_id}' AND article_id = ${article_id}`);
  const vote = existing.length ? existing[0].values[0] : null;

  if (vote) {
    const voteId = vote[0];
    const prevType = vote[3];
    if (prevType === type) {
      db.run(`DELETE FROM votes WHERE id = ${voteId}`);
      db.run(`UPDATE articles SET ${type}s = ${type}s - 1 WHERE id = ${article_id}`);
      save();
      return res.json({ action: 'removed' });
    } else {
      db.run(`UPDATE votes SET type = '${type}' WHERE id = ${voteId}`);
      db.run(`UPDATE articles SET ${prevType}s = ${prevType}s - 1, ${type}s = ${type}s + 1 WHERE id = ${article_id}`);
      save();
      return res.json({ action: 'changed' });
    }
  }

  db.run(`INSERT INTO votes (voter_id, article_id, type) VALUES ('${voter_id}', ${article_id}, '${type}')`);
  db.run(`UPDATE articles SET ${type}s = ${type}s + 1 WHERE id = ${article_id}`);
  save();
  res.json({ action: 'added' });
});

// ── КОММЕНТАРИИ: ПОЛУЧИТЬ ──
app.get('/api/comments/:article_id', async (req, res) => {
  const db = await getDb();
  const { article_id } = req.params;
  try {
    const result = db.exec(`
      SELECT c.id, c.text, c.created_at, u.first_name, u.last_name
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.article_id = ${article_id}
      ORDER BY c.created_at ASC
    `);
    const comments = result.length ? result[0].values.map(row => ({
      id: row[0], text: row[1], created_at: row[2],
      first_name: row[3], last_name: row[4]
    })) : [];
    res.json(comments);
  } catch (e) {
    res.json([]);
  }
});

// ── КОММЕНТАРИИ: ДОБАВИТЬ ──
app.post('/api/comments', auth, async (req, res) => {
  const db = await getDb();
  const { article_id, text } = req.body;
  if (!text || !article_id) return res.status(400).json({ error: 'Нет текста или статьи' });
  try {
    db.run(
      `INSERT INTO comments (user_id, article_id, text, created_at) VALUES (?, ?, ?, ?)`,
      [req.user.id, article_id, text, Date.now()]
    );
    save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── РЕГИСТРАЦИЯ ──
app.post('/api/register', async (req, res) => {
  const db = await getDb();
  const { first_name, last_name, email, password } = req.body;
  if (!first_name || !password) return res.status(400).json({ error: 'Имя и пароль обязательны' });
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (first_name, last_name, email, password) VALUES (?, ?, ?, ?)`,
  [first_name, last_name || '', email || '', hash]);
    save();
    const result = db.exec(`SELECT id FROM users WHERE rowid = last_insert_rowid()`);
const id = result[0].values[0][0];
    const token = jwt.sign({ id, first_name }, JWT_SECRET);
    res.json({ token, first_name, last_name });
  } catch (e) {
    res.status(400).json({ error: 'Пользователь уже существует' });
  }
});

// ── ВХОД ──
app.post('/api/login', async (req, res) => {
  const db = await getDb();
  const { email, password } = req.body;
  if (!email) return res.status(400).json({ error: 'Email обязателен' });
  const result = db.exec(`SELECT * FROM users WHERE email = '${email}'`);
  if (!result.length || !result[0].values.length) return res.status(400).json({ error: 'Пользователь не найден' });
  const row = result[0].values[0];
  const user = { id: row[0], first_name: row[1], last_name: row[2], password: row[4] };
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: 'Неверный пароль' });
  const token = jwt.sign({ id: user.id, first_name: user.first_name }, JWT_SECRET);
  res.json({ token, first_name: user.first_name, last_name: user.last_name });
});

// ── СБРОС ──
app.get('/api/reset', async (req, res) => {
  const db = await getDb();
  db.run(`DELETE FROM articles`);
  db.run(`DROP TABLE IF EXISTS votes`);
  db.run(`DROP TABLE IF EXISTS comments`);
  db.run(`CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voter_id TEXT,
    article_id INTEGER,
    type TEXT,
    UNIQUE(voter_id, article_id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    article_id INTEGER,
    text TEXT,
    created_at INTEGER
  )`);
  save();
  await fetchAndSave();
  res.json({ ok: true });
});

schedule.scheduleJob('*/30 * * * *', function() { fetchAndSave(); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  await fetchAndSave();
});