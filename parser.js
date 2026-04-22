const Parser = require('rss-parser');
const { getDb, save } = require('./database');

const parser = new Parser({
  headers: { 'User-Agent': 'Mozilla/5.0' },
  customFields: {
    item: [['media:thumbnail', 'mediaThumbnail']]
  }
});

const RSS_URL = 'https://www.zerkalo.cc/feeds/posts/default?alt=rss';

function extractImage(item) {
  if (item.mediaThumbnail && item.mediaThumbnail['$'] && item.mediaThumbnail['$'].url) {
    return item.mediaThumbnail['$'].url;
  }
  const content = item.content || '';
  const match = content.match(/<img[^>]+src="([^">]+)"/);
  if (match) return match[1];
  return null;
}

function extractExcerpt(item) {
  let text = item.contentSnippet || item.content || '';
  text = text.replace(/<[^>]+>/g, '').replace(/\(adsbygoogle.*?\);/gs, '').trim();
  return text.substring(0, 200) + (text.length > 200 ? '...' : '');
}

function extractCategory(item) {
  if (item.categories && item.categories.length > 0) {
    const cat = item.categories[0];
    if (typeof cat === 'string') return cat;
    if (cat && cat._) return cat._;
  }
  return 'Новости';
}

async function fetchAndSave() {
  try {
    console.log('Парсим RSS...');
    const db = await getDb();
    const feed = await parser.parseURL(RSS_URL);
    let count = 0;

    for (const item of feed.items) {
      const guid = String(item.guid || item.link || Date.now());
      const title = String(item.title || 'Без названия');
      const excerpt = String(extractExcerpt(item) || '');
      const image = extractImage(item) ? String(extractImage(item)) : null;
      const category = String(extractCategory(item) || 'Новости');
      const link = String(item.link || '');
      const published_at = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();

      try {
        db.run(
          `INSERT OR IGNORE INTO articles (guid, title, excerpt, image, category, link, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [guid, title, excerpt, image, category, link, published_at]
        );
        count++;
      } catch (e) {
        console.log('Пропускаем:', e.message);
      }
    }

    save();
    console.log(`Готово! Сохранено статей: ${count}`);
  } catch (err) {
    console.error('Ошибка парсера:', err.message);
  }
}

module.exports = { fetchAndSave };