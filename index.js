require('dotenv').config();
const express = require('express');
const cors = require('cors');
const schedule = require('node-schedule');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb, save } = require('./database');
const { fetchAndSave } = require('./parser');

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

app.post('/api/vote', auth, async (req, res) => {
  const db = await getDb();
  const { article_id, type } = req.body;
  if (!['like', 'dislike'].includes(type)) return res.status(400).json({ error: 'Неверный тип' });

  const existing = db.exec(`SELECT * FROM votes WHERE user_id = ${req.user.id} AND article_id = ${article_id}`);
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

  db.run(`INSERT INTO votes (user_id, article_id, type) VALUES (${req.user.id}, ${article_id}, '${type}')`);
  db.run(`UPDATE articles SET ${type}s = ${type}s + 1 WHERE id = ${article_id}`);
  save();
  res.json({ action: 'added' });
});

app.post('/api/register', async (req, res) => {
  const db = await getDb();
  const { first_name, last_name, email, password } = req.body;
  if (!first_name || !password) return res.status(400).json({ error: 'Имя и пароль обязательны' });
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (first_name, last_name, email, password) VALUES (?, ?, ?, ?)`,
      [first_name, last_name || null, email || null, hash]);
    save();
    const result = db.exec(`SELECT last_insert_rowid()`);
    const id = result[0].values[0][0];
    const token = jwt.sign({ id, first_name }, JWT_SECRET);
    res.json({ token, first_name, last_name });
  } catch (e) {
    res.status(400).json({ error: 'Пользователь уже существует' });
  }
});

app.post('/api/login', async (req, res) => {
  const db = await getDb();
  const { email, password } = req.body;
  const result = db.exec(`SELECT * FROM users WHERE email = '${email}'`);
  if (!result.length || !result[0].values.length) return res.status(400).json({ error: 'Пользователь не найден' });
  const row = result[0].values[0];
  const user = { id: row[0], first_name: row[1], last_name: row[2], password: row[4] };
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: 'Неверный пароль' });
  const token = jwt.sign({ id: user.id, first_name: user.first_name }, JWT_SECRET);
  res.json({ token, first_name: user.first_name, last_name: user.last_name });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  await fetchAndSave();
});

schedule.scheduleJob('*/30 * * * *', function() { fetchAndSave(); });