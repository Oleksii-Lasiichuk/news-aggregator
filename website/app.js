/* ── Config (set in index.html) ── */
const SUPABASE_URL      = window.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

/* ── State ── */
const state = {
  all:          [],   // all articles loaded from DB
  filtered:     [],   // after topic + search filter
  activeTopic:  'all',
  sort:         'date',   // 'date' | 'score'
  search:       '',
  page:         0,
  pageSize:     24,
};

const PAGE_DAYS = 7;       // fetch articles from last N days
const MIN_SCORE = 6;       // only show articles with AI score >= this
const REFRESH_MS = 5 * 60 * 1000;  // auto-refresh interval

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  attachHandlers();
  loadArticles();
  setInterval(loadArticles, REFRESH_MS);
});

/* ── Theme ── */
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}
function updateThemeIcon(theme) {
  document.getElementById('themeToggle').textContent = theme === 'dark' ? '☀' : '☾';
}

/* ── Attach UI handlers ── */
function attachHandlers() {
  document.getElementById('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next    = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.search = e.target.value.toLowerCase().trim();
    state.page   = 0;
    applyFilters();
  });

  document.getElementById('sortSelect').addEventListener('change', (e) => {
    state.sort = e.target.value;
    state.page = 0;
    applyFilters();
  });

  document.getElementById('loadMoreBtn').addEventListener('click', () => {
    state.page += 1;
    renderPage();
  });
}

/* ── Supabase fetch ── */
async function loadArticles() {
  try {
    const since = new Date(Date.now() - PAGE_DAYS * 86400_000).toISOString();

    const url = new URL(`${SUPABASE_URL}/rest/v1/articles`);
    url.searchParams.set('select', 'id,title,url,source,summary,score,topics,published_at');
    url.searchParams.set('score',  `gte.${MIN_SCORE}`);
    url.searchParams.set('published_at', `gte.${since}`);
    url.searchParams.set('order', 'published_at.desc');
    url.searchParams.set('limit', '500');

    const res = await fetch(url.toString(), {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const articles = await res.json();
    state.all  = articles;
    state.page = 0;
    buildTopicChips(articles);
    applyFilters();
    setLastUpdated();
  } catch (err) {
    showToast(`Could not load articles: ${err.message}`);
  }
}

/* ── Build topic chips from actual data ── */
function buildTopicChips(articles) {
  const counts = {};
  for (const a of articles) {
    for (const t of (a.topics || [])) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  // Sort topics by frequency
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  const container = document.getElementById('topicFilters');
  // keep "All" chip, remove rest
  container.innerHTML = '<button class="chip active" data-topic="all">All</button>';

  for (const topic of sorted) {
    const btn = document.createElement('button');
    btn.className    = 'chip';
    btn.dataset.topic = topic;
    btn.textContent  = topic;
    btn.addEventListener('click', () => setTopic(topic));
    container.appendChild(btn);
  }

  container.querySelector('[data-topic="all"]').addEventListener('click', () => setTopic('all'));
}

function setTopic(topic) {
  state.activeTopic = topic;
  state.page        = 0;
  // update chip styles
  document.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.dataset.topic === topic);
  });
  applyFilters();
}

/* ── Filter + sort ── */
function applyFilters() {
  let list = [...state.all];

  // Topic filter
  if (state.activeTopic !== 'all') {
    list = list.filter(a => (a.topics || []).includes(state.activeTopic));
  }

  // Search filter
  if (state.search) {
    const q = state.search;
    list = list.filter(a =>
      (a.title   || '').toLowerCase().includes(q) ||
      (a.summary || '').toLowerCase().includes(q) ||
      (a.source  || '').toLowerCase().includes(q)
    );
  }

  // Sort
  if (state.sort === 'score') {
    list.sort((a, b) => (b.score || 0) - (a.score || 0));
  } else {
    list.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  }

  state.filtered = list;

  const total   = list.length;
  const showing = Math.min((state.page + 1) * state.pageSize, total);
  document.getElementById('statusBar').textContent =
    total === 0
      ? 'No articles found.'
      : `Showing ${showing} of ${total} article${total !== 1 ? 's' : ''}`;

  renderPage();
}

/* ── Render current page of articles ── */
function renderPage() {
  const grid  = document.getElementById('articlesGrid');
  const items = state.filtered.slice(0, (state.page + 1) * state.pageSize);

  if (items.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>No articles yet</h3>
        <p>The workflow runs every 2 hours — check back soon!</p>
      </div>`;
    document.getElementById('loadMoreWrapper').style.display = 'none';
    return;
  }

  grid.innerHTML = items.map(articleCard).join('');

  // topic tag click → filter
  grid.querySelectorAll('.topic-tag').forEach(tag => {
    tag.addEventListener('click', () => setTopic(tag.dataset.topic));
  });

  // Show/hide "Load more"
  const hasMore = state.filtered.length > (state.page + 1) * state.pageSize;
  document.getElementById('loadMoreWrapper').style.display = hasMore ? 'block' : 'none';
}

/* ── Render one card ── */
function articleCard(a) {
  const scoreClass = a.score >= 9 ? 'score-high' : a.score >= 7 ? 'score-mid' : 'score-low';
  const dateStr    = a.published_at
    ? new Date(a.published_at).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
      })
    : '';
  const topics = (a.topics || []).map(t =>
    `<span class="topic-tag" data-topic="${esc(t)}">${esc(t)}</span>`
  ).join('');

  return `
    <article class="card">
      <div class="card-meta">
        <span class="source-tag">${esc(a.source || 'News')}</span>
        <span class="score-tag ${scoreClass}">${a.score}/10</span>
      </div>
      <h2 class="card-title">
        <a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>
      </h2>
      ${a.summary ? `<p class="card-summary">${esc(a.summary)}</p>` : ''}
      <div class="card-footer">
        ${topics ? `<div class="topic-tags">${topics}</div>` : ''}
        <span class="card-date">${dateStr}</span>
      </div>
    </article>`;
}

/* ── Helpers ── */
function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function setLastUpdated() {
  const t = new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
  document.getElementById('lastUpdated').textContent = `Updated ${t}`;
}

function showToast(msg) {
  const el       = document.createElement('div');
  el.className   = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
