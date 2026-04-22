require('dotenv').config();
const express = require('express');
const cors = require('cors');
const schedule = require('node-schedule');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./database');
const parser = require('./parser');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET;

// ── Middleware: проверка токена ──
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

// ── ЛЕНТА (хронологически) ──
app.get('/api/feed', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const articles = db.prepare(`
    SELECT * FROM articles ORDER BY published_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
  res.json(articles);
});

// ── ПОПУЛЯРНОЕ (по лайкам) ──
app.get('/api/popular', (req, res) => {
  const articles = db.prepare(`
    SELECT * FROM articles ORDER BY likes DESC LIMIT 50
  `).all();
  res.json(articles);
});

// ── НОВИНКИ (последние 24 часа) ──
app.get('/api/new', (req, res) => {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const articles = db.prepare(`
    SELECT * FROM articles WHERE published_at > ? ORDER BY published_at DESC LIMIT 50
  `).all(since);
  res.json(articles);
});

// ── ЛАЙК / ДИЗЛАЙК ──
app.post('/api/vote', auth, (req, res) => {
  const { article_id, type } = req.body;
  if (!['like', 'dislike'].includes(type)) {
    return res.status(400).json({ error: 'Неверный тип' });
  }

  const existing = db.prepare(`
    SELECT * FROM votes WHERE user_id = ? AND article_id = ?
  `).get(req.user.id, article_id);

  if (existing) {
    if (existing.type === type) {
      // Повторный клик — убираем голос
      db.prepare(`DELETE FROM votes WHERE id = ?`).run(existing.id);
      db.prepare(`UPDATE articles SET ${type}s = ${type}s - 1 WHERE id = ?`).run(article_id);
      return res.json({ action: 'removed' });
    } else {
      // Меняем голос
      db.prepare(`UPDATE votes SET type = ? WHERE id = ?`).run(type, existing.id);
      const prev = existing.type;
      db.prepare(`UPDATE articles SET ${prev}s = ${prev}s - 1, ${type}s = ${type}s + 1 WHERE id = ?`).run(article_id);
      return res.json({ action: 'changed' });
    }
  }

  db.prepare(`INSERT INTO votes (user_id, article_id, type) VALUES (?, ?, ?)`).run(req.user.id, article_id, type);
  db.prepare(`UPDATE articles SET ${type}s = ${type}s + 1 WHERE id = ?`).run(article_id);
  res.json({ action: 'added' });
});

// ── РЕГИСТРАЦИЯ ──
app.post('/api/register', async (req, res) => {
  const { first_name, last_name, email, password } = req.body;
  if (!first_name || !password) {
    return res.status(400).json({ error: 'Имя и пароль обязательны' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare(`
      INSERT INTO users (first_name, last_name, email, password) VALUES (?, ?, ?, ?)
    `).run(first_name, last_name, email || null, hash);
    const token = jwt.sign({ id: result.lastInsertRowid, first_name }, JWT_SECRET);
    res.json({ token, first_name, last_name });
  } catch {
    res.status(400).json({ error: 'Пользователь уже существует' });
  }
});

// ── ВХОД ──
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: 'Неверный пароль' });
  const token = jwt.sign({ id: user.id, first_name: user.first_name }, JWT_SECRET);
  res.json({ token, first_name: user.first_name, last_name: user.last_name });
});

// ── ЗАПУСК ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  await parser.fetchAndSave(); // Первый парсинг сразу при старте
});

// Парсим RSS каждые 30 минут
schedule.scheduleJob('*/30 * * * *', function() { parser.fetchAndSave(); });