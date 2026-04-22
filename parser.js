const Parser = require('rss-parser');
const db = require('./database');

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  },
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail']
    ]
  }
});

const RSS_URL = 'https://www.zerkalo.cc/feeds/posts/default?alt=rss';

function extractImage(item) {
  if (item.mediaContent && item.mediaContent['$'] && item.mediaContent['$'].url) {
    return item.mediaContent['$'].url;
  }
  if (item.mediaThumbnail && item.mediaThumbnail['$'] && item.mediaThumbnail['$'].url) {
    return item.mediaThumbnail['$'].url;
  }
  const content = item.content || item['content:encoded'] || '';
  const match = content.match(/<img[^>]+src="([^">]+)"/);
  if (match) return match[1];
  return null;
}

function extractExcerpt(item) {
  let text = item.contentSnippet || item.summary || item.content || '';
  text = text.replace(/<[^>]+>/g, '').trim();
  if (text.length === 0) return '';
  return text.substring(0, 200) + (text.length > 200 ? '...' : '');
}

function extractCategory(item) {
  if (item.categories && item.categories.length > 0) {
    const cat = item.categories[0];
    if (typeof cat === 'string') return cat;
    if (cat && cat._) return cat._;
    if (cat && cat.$) return String(Object.values(cat.$)[0] || 'Новости');
  }
  return 'Новости';
}

async function fetchAndSave() {
  try {
    console.log('Парсим RSS...');
    const feed = await parser.parseURL(RSS_URL);

    // Смотрим первую статью для диагностики
    if (feed.items.length > 0) {
      const first = feed.items[0];
      console.log('Пример статьи:', JSON.stringify(first, null, 2));
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO articles (guid, title, excerpt, image, category, link, published_at)
      VALUES (@guid, @title, @excerpt, @image, @category, @link, @published_at)
    `);

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
        insert.run({ guid, title, excerpt, image, category, link, published_at });
        count++;
      } catch (e) {
        console.log('Ошибка статьи:', e.message, '| category type:', typeof category);
      }
    }

    console.log(`Готово! Обработано статей: ${count}`);
  } catch (err) {
    console.error('Ошибка парсера:', err.message);
  }
}
module.exports = { fetchAndSave };