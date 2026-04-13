# News Aggregator

A fully autonomous personal news curator. Pulls from 8 topic feeds, lets an LLM score each article for relevance, stores the keepers in Postgres, and serves them from a static site with email-based user accounts and per-user topic preferences.

Runs 24/7 in the cloud on a free-tier VM. Total infrastructure cost: **$0**.

**🔗 Live demo:** https://oleksii-lasiichuk.github.io/news-aggregator/

---

## Why this exists

RSS readers dump every article on you. News aggregators optimize for engagement, not signal. I wanted a feed that:

- pulls from many sources automatically,
- ranks each item by relevance to **my** interests (Ukraine/war, programming, AI, running, speedcubing),
- writes a 2-sentence summary so I can triage in seconds,
- lets other users set their own topic preferences,
- runs without my laptop being on,
- costs nothing.

This repo is the result. It is also my first deep dive into n8n and a working demonstration of a no-backend full-stack project.

---

## Stack

| Layer | Tech | Why |
|---|---|---|
| Workflow orchestration | [n8n](https://n8n.io/) (self-hosted, Docker) | Visual DAG of scheduled HTTP/Code/DB steps — production-grade, free |
| Compute host | Google Cloud e2-micro (Always Free) | 1 vCPU + 1 GB RAM, never shuts down, free forever in `us-central1`/`us-east1`/`us-west1` |
| AI scoring | [Groq API](https://groq.com/) — `llama-3.3-70b-versatile` | Fast, generous free tier (14 400 req/day), OpenAI-compatible |
| Database | [Supabase](https://supabase.com/) (Postgres + REST + Auth) | Free 500 MB, Row Level Security, magic-link email auth |
| Frontend | Vanilla HTML/CSS/JS + Supabase JS SDK | No framework, no build step, one CDN script |
| Frontend host | GitHub Pages | Free static hosting from a repo folder |
| News source | Google News RSS (topic queries) | Single provider, never 404s, any topic encodable in a URL |

---

## Architecture

```text
                 ┌──────────────────────────────────────────┐
                 │  Google Cloud e2-micro VM (always free)  │
                 │                                          │
                 │   ┌─────────── n8n (Docker) ──────────┐  │
  every 2 h ────▶│   │                                   │  │
                 │   │  Schedule Trigger                 │  │
                 │   │         │                         │  │
                 │   │         ▼                         │  │
                 │   │  8 × Google News RSS feeds   ◀─── HTTPS ─── news.google.com
                 │   │  (Ukraine, AI, sports, ...)       │  │
                 │   │         │                         │  │
                 │   │         ▼                         │  │
                 │   │  Merge → dedupe → last-24h filter │  │
                 │   │         │                         │  │
                 │   │         ▼                         │  │
                 │   │  Groq llama-3.3-70b  ◀─── HTTPS ──── api.groq.com
                 │   │  score 1-10 + summary + topics    │  │
                 │   │         │                         │  │
                 │   │         ▼                         │  │
                 │   │  Filter score ≥ 6                 │  │
                 │   │         │                         │  │
                 │   │         ▼                         │  │
                 │   │  POST /articles  ─── HTTPS ──────────▶ Supabase
                 │   │  (on_conflict=url, insert-or-skip)│  │      │
                 │   └───────────────────────────────────┘  │      │
                 └──────────────────────────────────────────┘      │
                                                                   │
                                                                   ▼
        ┌──────────────────────────────────────────────────────────────┐
        │  Supabase                                                    │
        │  ├─ articles            (public read, anon insert)           │
        │  └─ user_preferences    (RLS: own row only)                  │
        │  └─ auth.users          (magic-link email)                   │
        └──────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ REST + Auth
                                    │
        ┌───────────────────────────┴──────────────────────────────────┐
        │  GitHub Pages — static site                                  │
        │  Vanilla JS, card grid, topic chips, per-user "My topics"    │
        └──────────────────────────────────────────────────────────────┘
```

---

## Features

- **Fully autonomous** — workflow runs on a cloud VM; your laptop can be off
- **LLM-ranked feed** — every article gets a 1-10 relevance score and a 2-sentence AI summary before it hits the database
- **Multi-source** — 8 Google News topic queries cover Ukraine/war, world politics, programming, AI, sports, running, speedcubing, science (add more in one n8n click)
- **User accounts** — Supabase magic-link email sign-in, no passwords to manage
- **Per-user topic preferences** — pick from presets or add custom free-text topics, synced across devices via RLS-protected `user_preferences` table
- **Zero duplicates** — `?on_conflict=url` + `Prefer: resolution=ignore-duplicates` turns every insert into a safe upsert
- **Idempotent re-runs** — the workflow can run every 2 hours without fear of crashing on duplicate keys
- **Static frontend** — no build step, no framework, single `<script>` for Supabase JS client
- **Dark/light theme**, client-side topic filter, search, sort, auto-refresh
- **Hand-editable AI prompt** — source-of-truth in `prompts/news-curator.md`
- **Fully free** — Google Cloud Always Free + Groq free tier + Supabase free + GitHub Pages free

---

## Screenshots

_Add your own screenshots here: a) the card grid, b) the topic picker, c) the n8n workflow canvas._

```
docs/screenshots/
├── feed.png
├── topic-picker.png
└── n8n-workflow.png
```

Reference them in this README like: `![Feed](docs/screenshots/feed.png)`

---

## How the workflow runs

```text
Schedule Trigger  ─ every 2 hours
        │
        ▼
8 Google News RSS feeds (parallel)         ← ~250 items total
        │
        ▼
Merge All Feeds
        │
        ▼
Process Articles (JS Code node)
  • deduplicate by URL
  • filter to last 24 hours
  • extract publisher from the Google News title suffix
  • cap at 50 articles per run (stays under Groq free tier)
        │
        ▼
Prepare Groq Request (JS Code node)
  • builds the user-interest prompt
  • asks for strict JSON: {score, summary, topics[]}
        │
        ▼
Groq AI Analysis (HTTP POST)
  • llama-3.3-70b-versatile
  • response_format: { type: "json_object" }
        │
        ▼
Parse Groq Response (JS Code node)
        │
        ▼
Score Filter (IF score ≥ 6)
        │
        ▼
Save to Supabase (HTTP POST)
  • /rest/v1/articles?on_conflict=url
  • Prefer: resolution=ignore-duplicates
```

---

## Database schema

```sql
CREATE TABLE articles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        TEXT NOT NULL,
  url          TEXT UNIQUE NOT NULL,
  source       TEXT NOT NULL,
  summary      TEXT,
  score        INTEGER CHECK (score BETWEEN 1 AND 10),
  topics       TEXT[] DEFAULT '{}',
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON articles USING GIN (topics);
CREATE INDEX ON articles (published_at DESC);

-- Row Level Security
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read"   ON articles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon insert"   ON articles FOR INSERT TO anon               WITH CHECK (true);

-- Per-user topic preferences
CREATE TABLE user_preferences (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  topics     TEXT[] DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own read"   ON user_preferences FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own insert" ON user_preferences FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update" ON user_preferences FOR UPDATE TO authenticated USING (auth.uid() = user_id);
```

Full script in [`supabase/schema.sql`](supabase/schema.sql).

---

## Repository layout

```text
news-aggregator/
├── docker-compose.yml      # runs n8n on the VM
├── .env.example            # template for secrets (real .env is gitignored)
├── n8n-workflow.json       # importable 15-node n8n workflow
├── supabase/
│   └── schema.sql          # Postgres schema + indexes + RLS policies
├── prompts/
│   └── news-curator.md     # source-of-truth for the Groq system prompt
├── docs/                   # GitHub Pages site (vanilla JS)
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── README.md
```

---

## Running it yourself

You need about an hour and accounts on: Google Cloud, Supabase, Groq, GitHub.

### 1 — Create accounts and get secrets

| Service | What you need | Where to find it |
|---|---|---|
| Supabase | Project URL + anon key | Project → Settings → API |
| Groq | API key (`gsk_...`) | console.groq.com → API Keys |
| Google Cloud | Free-tier account | cloud.google.com → Get started for free |
| GitHub | Public repo for this code | github.com/new |

### 2 — Create a Google Cloud VM

Compute Engine → VM Instances → **Create Instance**:

- Name: `n8n-server`
- Region: **must** be `us-central1`, `us-east1`, or `us-west1` (Always Free regions)
- Machine type: **e2-micro**
- Boot disk: Debian 12, 30 GB Standard persistent disk
- Firewall: ☑ Allow HTTP ☑ Allow HTTPS

Click **Create**, copy the external IP.

### 3 — Install Docker + swap

SSH into the VM and run:

```bash
# Docker CE from the official repo
sudo apt update
sudo apt install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker

# 2 GB swap — n8n needs it on 1 GB RAM
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 4 — Clone and configure

```bash
git clone https://github.com/YOUR_USERNAME/news-aggregator.git
cd news-aggregator
cp .env.example .env
nano .env
```

Fill in:

```dotenv
N8N_ENCRYPTION_KEY=<run: openssl rand -hex 32>
GROQ_API_KEY=gsk_<your groq key>
SUPABASE_URL=https://<your project>.supabase.co
SUPABASE_ANON_KEY=eyJ<your anon key>
```

### 5 — Start n8n

```bash
docker compose up -d
docker compose logs -f n8n   # wait for "n8n ready on 0.0.0.0, port 5678"
```

### 6 — Run the database schema

Supabase dashboard → SQL Editor → paste [`supabase/schema.sql`](supabase/schema.sql) → **Run**.

### 7 — Enable email auth

Supabase → Authentication → Providers → **Email** → Enable provider, **turn Confirm email OFF** (magic-link only). Under Authentication → URL Configuration, set **Site URL** and **Redirect URLs** to your GitHub Pages URL with a `**` suffix (e.g. `https://you.github.io/news-aggregator/**`).

### 8 — Import and activate the workflow

Access n8n via SSH tunnel from your Mac (safer than exposing the port):

```bash
ssh -L 5678:localhost:5678 YOUR_VM_IP
```

Open http://localhost:5678 → create owner account → **Workflows → Import from file** → `n8n-workflow.json`. Click **Execute Workflow** to test. Flip the **Active** toggle on.

### 9 — Deploy the frontend

Fill in your Supabase URL and anon key in [`docs/index.html`](docs/index.html) (they're safe to publish — RLS enforces everything). Push to GitHub, then:

GitHub repo → **Settings → Pages** → Source: Deploy from a branch → Branch: `main`, Folder: `/docs` → **Save**.

Your site is live at `https://YOUR_USERNAME.github.io/news-aggregator/`.

---

## Editing the AI prompt

The prompt lives in [`prompts/news-curator.md`](prompts/news-curator.md). n8n does not read files from the repo, so:

1. Edit `prompts/news-curator.md`
2. Open the n8n workflow → **Prepare Groq Request** node
3. Replace the `var prompt = ` string contents with the new text
4. **Save** the workflow

The one-line comment at the top of that Code node reminds you where the source of truth lives.

---

## Cost breakdown

| Resource | Limit | Actual usage | Cost |
|---|---|---|---|
| Google Cloud e2-micro | 1 vCPU + 1 GB + 30 GB disk | ~200 MB RAM idle, ~1 GB peak | $0 |
| Groq API | 14 400 req/day | ~600/day (12 runs × 50 articles) | $0 |
| Supabase | 500 MB DB + 50 000 MAU | < 5 MB, 1-2 users | $0 |
| GitHub Pages | unlimited for public repos | small static site | $0 |
| **Total** | | | **$0 / month** |

---

## Roadmap

- [ ] Per-user relevance scoring (feed your saved topics into the Groq prompt so the score is personalised)
- [ ] Notification digest (daily email of top 5)
- [ ] PWA / offline support
- [ ] Article bookmarking
- [ ] More source types (Mastodon, Reddit, arXiv)

---

## License

[MIT](LICENSE) — do whatever, no warranty.

---

## Acknowledgements

- [n8n](https://n8n.io/) for the workflow engine
- [Groq](https://groq.com/) for the inference API
- [Supabase](https://supabase.com/) for the database and auth
- [Google News RSS](https://news.google.com/) for making topic queries trivial
