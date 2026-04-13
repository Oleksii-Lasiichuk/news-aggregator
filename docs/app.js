/* ── Config ── */
const SUPABASE_URL      = window.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Expose for DevTools debugging
window.sb    = sb;
window.state = null; // populated below

const PRESET_TOPICS = [
  'ukraine','war','politics','tech','ai','programming',
  'speedcubing','running','sports','geography','world','science','health'
];

/* ── State ── */
const state = {
  all:           [],
  filtered:      [],
  activeTopic:   'all',
  sort:          'date',
  search:        '',
  page:          0,
  pageSize:      24,
  user:          null,
  prefs:         [],
  myTopicsOnly:  false,
  draftTopics:   [],
};
window.state = state;

const PAGE_DAYS  = 7;
const MIN_SCORE  = 6;
const REFRESH_MS = 5 * 60 * 1000;

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  attachHandlers();
  initAuth();
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

/* ── Handlers ── */
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

  document.getElementById('myTopicsOnly').addEventListener('change', (e) => {
    state.myTopicsOnly = e.target.checked;
    state.page         = 0;
    applyFilters();
  });

  // Auth buttons
  document.getElementById('signInBtn').addEventListener('click', openSignIn);
  document.getElementById('signOutBtn').addEventListener('click', signOut);
  document.getElementById('signInCancelBtn').addEventListener('click', closeSignIn);
  document.getElementById('signInSubmitBtn').addEventListener('click', submitSignIn);

  // Topic picker
  document.getElementById('topicPickerToggle').addEventListener('click', toggleTopicPicker);
  document.getElementById('addCustomTopicBtn').addEventListener('click', addCustomTopic);
  document.getElementById('customTopicInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addCustomTopic(); }
  });
  document.getElementById('savePrefsBtn').addEventListener('click', savePrefs);
}

/* ── Auth ── */
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  handleSession(session);

  sb.auth.onAuthStateChange((_event, session) => handleSession(session));
}

async function handleSession(session) {
  state.user = session ? session.user : null;

  const signInBtn   = document.getElementById('signInBtn');
  const signOutBtn  = document.getElementById('signOutBtn');
  const emailLabel  = document.getElementById('userEmail');
  const picker      = document.getElementById('topicPicker');
  const myOnlyWrap  = document.getElementById('myTopicsOnlyWrap');

  if (state.user) {
    signInBtn.hidden  = true;
    signOutBtn.hidden = false;
    emailLabel.hidden = false;
    emailLabel.textContent = state.user.email;
    picker.hidden      = false;
    myOnlyWrap.hidden  = false;
    closeSignIn();
    await loadPrefs();
    renderTopicPicker();
  } else {
    signInBtn.hidden  = false;
    signOutBtn.hidden = true;
    emailLabel.hidden = true;
    picker.hidden      = true;
    myOnlyWrap.hidden  = true;
    state.prefs        = [];
    state.draftTopics  = [];
    state.myTopicsOnly = false;
    document.getElementById('myTopicsOnly').checked = false;
    applyFilters();
  }
}

function openSignIn() {
  document.getElementById('signInModal').hidden = false;
  document.getElementById('signInEmail').focus();
  document.getElementById('signInStatus').textContent = '';
}
function closeSignIn() {
  document.getElementById('signInModal').hidden = true;
  document.getElementById('signInEmail').value  = '';
}
async function submitSignIn() {
  const email  = document.getElementById('signInEmail').value.trim();
  const status = document.getElementById('signInStatus');
  if (!email || !email.includes('@')) {
    status.textContent = 'Enter a valid email address.';
    return;
  }
  status.textContent = 'Sending…';
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  status.textContent = error
    ? `Error: ${error.message}`
    : 'Check your inbox for the magic link.';
}
async function signOut() {
  await sb.auth.signOut();
}

/* ── Preferences ── */
async function loadPrefs() {
  if (!state.user) return;
  const { data, error } = await sb
    .from('user_preferences')
    .select('topics')
    .eq('user_id', state.user.id)
    .maybeSingle();
  if (error) {
    showToast(`Could not load preferences: ${error.message}`);
    return;
  }
  state.prefs       = (data && data.topics) || [];
  state.draftTopics = [...state.prefs];
}

async function savePrefs() {
  if (!state.user) return;
  const status = document.getElementById('prefsStatus');
  status.textContent = 'Saving…';
  const { error } = await sb
    .from('user_preferences')
    .upsert(
      { user_id: state.user.id, topics: state.draftTopics, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  if (error) {
    status.textContent = `Error: ${error.message}`;
    return;
  }
  state.prefs = [...state.draftTopics];
  status.textContent = 'Saved ✓';
  setTimeout(() => { status.textContent = ''; }, 2500);
  applyFilters();
}

function toggleTopicPicker() {
  const body = document.getElementById('topicPickerBody');
  const btn  = document.getElementById('topicPickerToggle');
  const open = body.hidden;
  body.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = open ? 'Close' : 'Edit';
  if (open) renderTopicPicker();
}

function renderTopicPicker() {
  const presetRow = document.getElementById('presetChips');
  presetRow.innerHTML = '';
  for (const t of PRESET_TOPICS) {
    const btn = document.createElement('button');
    btn.className = 'chip' + (state.draftTopics.includes(t) ? ' active' : '');
    btn.textContent = t;
    btn.addEventListener('click', () => toggleDraftTopic(t));
    presetRow.appendChild(btn);
  }

  const selectedRow = document.getElementById('selectedTopics');
  selectedRow.innerHTML = '';
  const custom = state.draftTopics.filter(t => !PRESET_TOPICS.includes(t));
  if (custom.length === 0) return;
  const label = document.createElement('span');
  label.className   = 'muted';
  label.textContent = 'Custom: ';
  selectedRow.appendChild(label);
  for (const t of custom) {
    const chip = document.createElement('button');
    chip.className = 'chip active removable';
    chip.innerHTML = `${esc(t)} <span aria-hidden="true">×</span>`;
    chip.addEventListener('click', () => toggleDraftTopic(t));
    selectedRow.appendChild(chip);
  }
}

function toggleDraftTopic(topic) {
  const i = state.draftTopics.indexOf(topic);
  if (i === -1) state.draftTopics.push(topic);
  else          state.draftTopics.splice(i, 1);
  renderTopicPicker();
}

function addCustomTopic() {
  const input = document.getElementById('customTopicInput');
  const v = input.value.trim().toLowerCase();
  if (!v) return;
  if (!state.draftTopics.includes(v)) state.draftTopics.push(v);
  input.value = '';
  renderTopicPicker();
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

/* ── Topic chips from data ── */
function buildTopicChips(articles) {
  const counts = {};
  for (const a of articles) {
    for (const t of (a.topics || [])) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  const container = document.getElementById('topicFilters');
  container.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className     = 'chip' + (state.activeTopic === 'all' ? ' active' : '');
  allBtn.dataset.topic = 'all';
  allBtn.textContent   = 'All';
  allBtn.addEventListener('click', () => setTopic('all'));
  container.appendChild(allBtn);

  for (const topic of sorted) {
    const btn = document.createElement('button');
    btn.className      = 'chip' + (state.activeTopic === topic ? ' active' : '');
    btn.dataset.topic  = topic;
    btn.textContent    = topic;
    btn.addEventListener('click', () => setTopic(topic));
    container.appendChild(btn);
  }
}

function setTopic(topic) {
  state.activeTopic = topic;
  state.page        = 0;
  document.querySelectorAll('#topicFilters .chip').forEach(c => {
    c.classList.toggle('active', c.dataset.topic === topic);
  });
  applyFilters();
}

/* ── Filter + sort ── */
function applyFilters() {
  let list = [...state.all];

  // Chip topic filter
  if (state.activeTopic !== 'all') {
    list = list.filter(a => (a.topics || []).includes(state.activeTopic));
  }

  // My-topics-only filter (user prefs)
  if (state.myTopicsOnly && state.prefs.length > 0) {
    const presetSet = new Set(PRESET_TOPICS);
    const prefTags   = state.prefs.filter(t => presetSet.has(t));
    const customTags = state.prefs.filter(t => !presetSet.has(t));
    list = list.filter(a => matchesUserPrefs(a, prefTags, customTags));
  }

  // Search
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

function matchesUserPrefs(article, prefTags, customTags) {
  const articleTopics = article.topics || [];
  for (const t of prefTags) {
    if (articleTopics.includes(t)) return true;
  }
  if (customTags.length > 0) {
    const hay = `${article.title || ''} ${article.summary || ''}`.toLowerCase();
    for (const t of customTags) {
      if (hay.includes(t)) return true;
    }
  }
  return false;
}

/* ── Render ── */
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

  grid.querySelectorAll('.topic-tag').forEach(tag => {
    tag.addEventListener('click', () => setTopic(tag.dataset.topic));
  });

  const hasMore = state.filtered.length > (state.page + 1) * state.pageSize;
  document.getElementById('loadMoreWrapper').style.display = hasMore ? 'block' : 'none';
}

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
