# Personal News Aggregator with n8n

A fully autonomous news aggregator. Runs 24/7 in the cloud (Google Cloud Always Free VM) — your Mac can be off.

**Stack:** Google Cloud VM → n8n (Docker) → Groq AI → Supabase DB → GitHub Pages website

**Cost:** $0 forever (all free tiers)

---

## Architecture

```
11 RSS Feeds (BBC, Kyiv Independent, Reuters, HN, The Verge, etc.)
         ↓  every 2 hours
  n8n workflow (Google Cloud e2-micro VM, always on)
         ↓
  Groq API — llama-3.3-70b scores relevance (1-10) + writes 2-sentence summary
         ↓  keeps only score ≥ 6
  Supabase PostgreSQL (cloud, REST API)
         ↓
  GitHub Pages website — filters by topic, search, sort
```

---

## Step 1 — Create free accounts (≈ 25 min)

### 1a. Supabase (database)
1. Go to **supabase.com** → click **Start your project**
2. Sign up with GitHub
3. Click **New project**:
   - Project name: `news-aggregator`
   - Region: EU West (Ireland) — or closest to you
   - Plan: Free
   - Generate a strong DB password → save it somewhere
4. Wait ~2 min for provisioning
5. Go to **Settings → API** (left sidebar)
6. Copy and save:
   - **Project URL** — looks like `https://abcdefghij.supabase.co`
   - **anon public** key — long JWT starting with `eyJ...`

### 1b. Groq API (free AI)
1. Go to **console.groq.com** → sign up (Google or email)
2. Click **API Keys** → **Create API Key**
   - Name: `news-aggregator`
3. Copy the key immediately — it starts with `gsk_` and is shown only once

### 1c. GitHub
1. Go to **github.com** → log in or sign up
2. Click **+** → **New repository**:
   - Name: `news-aggregator`
   - Visibility: **Public** (required for free GitHub Pages)
   - Check "Add a README file"
3. Click **Create repository**
4. Copy the repo URL

### 1d. Google Cloud (VM for n8n)
1. Go to **cloud.google.com** → click **Get started for free**
2. Sign in with Google → complete the free trial setup (requires a credit card for identity; you will NOT be charged if you stay in Always Free limits)
3. In the Console, click the project dropdown → **New Project**
   - Name: `news-aggregator`
   - Click **Create**
4. In the left menu: **Compute Engine → VM Instances**
   - First time: click **Enable** to enable the Compute Engine API (takes ~1 min)

---

## Step 2 — Create the Google Cloud VM (≈ 10 min)

1. **Compute Engine → VM Instances → Create Instance**
2. Fill in:
   | Field | Value |
   |-------|-------|
   | Name | `n8n-server` |
   | Region | `us-central1` ← IMPORTANT: must be us-central1, us-east1, or us-west1 for Always Free |
   | Zone | any |
   | Machine type | **e2-micro** ← IMPORTANT: this is the free tier machine |
   | Boot disk OS | **Debian** GNU/Linux 12 (Bookworm) |
   | Boot disk size | **30 GB** Standard persistent disk |
   | Firewall | ✅ Allow HTTP traffic |
   |           | ✅ Allow HTTPS traffic |

3. Click **Create** — wait ~1 minute

4. You'll see the VM listed with an **External IP** — copy that IP address

---

## Step 3 — Set up the VM (≈ 15 min)

Click the **SSH** button next to your VM in the Console. A browser terminal opens.

Run these commands one by one:

```bash
# Update system
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git

# Allow your user to run Docker without sudo
sudo usermod -aG docker $USER
newgrp docker

# Add 2 GB swap — n8n needs it on this 1 GB RAM machine
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Verify Docker works
docker run hello-world
```

---

## Step 4 — Upload project files to VM (≈ 5 min)

**Option A — via GitHub (recommended):**

On your Mac, push the project to GitHub first:
```bash
cd ~/Projects/news_scrapper
git init
git add .gitignore docker-compose.yml .env.example supabase/ website/ n8n-workflow.json README.md
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/news-aggregator.git
git push -u origin main
```

Then on the VM (in the SSH terminal):
```bash
git clone https://github.com/YOUR_USERNAME/news-aggregator.git
cd news-aggregator
```

**Option B — copy via SCP from Mac:**
```bash
# On your Mac:
scp -r ~/Projects/news_scrapper/* YOUR_VM_IP:~/news-aggregator/
```

---

## Step 5 — Configure secrets on the VM (≈ 3 min)

In the SSH terminal on the VM:
```bash
cd ~/news-aggregator

# Generate a random encryption key for n8n
openssl rand -hex 32
# Copy the output — you'll use it below

# Create your .env file
cp .env.example .env
nano .env
```

In nano, fill in your values:
```
N8N_ENCRYPTION_KEY=<paste the openssl output here>
GROQ_API_KEY=gsk_<your groq key>
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_ANON_KEY=eyJ<your anon key>
```

Save with `Ctrl+O`, `Enter`, then `Ctrl+X`.

---

## Step 6 — Start n8n on the VM (≈ 2 min)

```bash
cd ~/news-aggregator
docker compose up -d

# Check it started successfully
docker compose logs -f
# You should see: "n8n ready on 0.0.0.0, port 5678"
# Press Ctrl+C to stop following logs
```

---

## Step 7 — Set up the database in Supabase (≈ 3 min)

1. Go to your **Supabase project** → **SQL Editor** (left sidebar)
2. Click **New query**
3. Open `supabase/schema.sql` from this project, copy the entire file contents, paste into the editor
4. Click **Run** (or press Cmd+Enter)
5. You should see: "Success. No rows returned."
6. Go to **Table Editor** → you should see an `articles` table

---

## Step 8 — Access n8n via SSH tunnel (≈ 2 min)

n8n runs on port 5678 on the VM. We access it securely via SSH tunnel — no public exposure needed.

On your **Mac**, open a new Terminal window and run:
```bash
ssh -L 5678:localhost:5678 YOUR_VM_EXTERNAL_IP
```

Keep this terminal open. Now go to **http://localhost:5678** in your browser — n8n's setup page appears.

Fill in:
- First name, Last name, Email, Password — these are for your n8n instance only
- Click **Get started**

---

## Step 9 — Configure n8n credentials (≈ 5 min)

In n8n UI at http://localhost:5678:

The workflow uses `$env.GROQ_API_KEY` and `$env.SUPABASE_*` directly from environment variables — no additional credential setup needed. The values come from your `.env` file via `docker-compose.yml`.

To verify the env vars are loaded:
1. Click **Workflows** in left sidebar
2. Click **New** → **Code** node
3. In the Code node editor, type: `return [{json: {key: $env.GROQ_API_KEY}}]`
4. Click **Execute node** — you should see your key (first few chars)
5. Delete this test workflow without saving

---

## Step 10 — Import and activate the workflow (≈ 5 min)

1. In n8n, click **Workflows** in the left sidebar
2. Click the **+** button → **Import from file**
3. Select `n8n-workflow.json` from your project folder
4. The workflow opens with all 19 nodes visible

**Fix the HTTP Request nodes** (n8n versions vary, may need manual config):

Click the **Groq AI Analysis** node → check that:
- Method: POST
- URL: `https://api.groq.com/openai/v1/chat/completions`
- Body: JSON, value `={{ $json._groqBody }}`
- Header "Authorization": `={{ 'Bearer ' + $env.GROQ_API_KEY }}`

Click the **Save to Supabase** node → check that:
- Method: POST
- URL: `={{ $env.SUPABASE_URL }}/rest/v1/articles?on_conflict=url`
- Header "apikey": `={{ $env.SUPABASE_ANON_KEY }}`
- Header "Prefer": `resolution=ignore-duplicates`

> **Why the `?on_conflict=url`?** PostgREST only treats a POST as insert-or-skip when you tell it which column to check. The `Prefer` header alone is not enough — without `on_conflict=url` you get `duplicate key value violates unique constraint "articles_url_key"` the second time the same article shows up in RSS.

**Test the workflow:**
1. Click the **Execute Workflow** button (▶) in the top toolbar
2. Watch nodes light up green as they execute
3. After ~2-3 minutes, go to Supabase → **Table Editor → articles** — you should see rows!

**Activate for automatic runs:**
1. Click the **Active** toggle in the top-right corner of the workflow editor
2. It turns green — the workflow now runs automatically every 2 hours
3. You can close the n8n browser tab and disconnect the SSH tunnel — it keeps running

---

## Step 10b — Enable user auth in Supabase (≈ 2 min)

The website supports sign-in via email magic link so each user can save their own topic preferences.

1. Supabase dashboard → **Authentication** → **Providers**
2. Click **Email** → make sure it is **enabled**
3. Leave "Confirm email" on, "Secure email change" on — defaults are fine
4. Under **URL Configuration**, add your GitHub Pages URL as a **Site URL** and **Redirect URL** (e.g. `https://YOUR_USERNAME.github.io/news-aggregator/`)

That's it. No SMTP setup needed — Supabase's built-in mailer covers the free tier (a few emails/hour).

---

## Step 11 — Deploy the website (≈ 10 min)

### Configure Supabase credentials in the website

Open `website/index.html` on your Mac and replace the placeholder values:
```html
<script>
  window.SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';
  window.SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';
</script>
```

Replace with your actual values from Step 1a. The anon key is safe to publish — it's read-only (SELECT only via RLS).

### Push website to GitHub and enable Pages

```bash
cd ~/Projects/news_scrapper
git add website/index.html
git commit -m "add supabase config"
git push
```

Then in GitHub:
1. Go to your `news-aggregator` repo → **Settings**
2. Left sidebar: **Pages**
3. Source: **Deploy from a branch**
4. Branch: `main`, Folder: `/website`
5. Click **Save**
6. Wait ~1 minute → you'll see: "Your site is live at `https://YOUR_USERNAME.github.io/news-aggregator/`"

---

## Step 12 — Verify everything works (≈ 5 min)

1. Open `https://YOUR_USERNAME.github.io/news-aggregator/` — should show articles
2. **Turn your Mac off** — the VM keeps running
3. Wait 2+ hours
4. Open the website again → new articles appeared → ✅ fully autonomous!

Check VM is still running (from your Mac):
```bash
ssh YOUR_VM_IP "docker ps"
# Should show: n8n container Up X hours
```

---

## How the workflow works

```text
Schedule Trigger (every 2h)
  → fetches 8 Google News RSS topic feeds in parallel
  → Merge All Feeds: combines ~200-300 articles
  → Process Articles (Code):
       - deduplicates by URL
       - filters to last 24 hours only
       - extracts publisher from Google News source/title suffix
       - limits to 50 articles per run
  → Prepare Groq Request (Code):
       - builds the AI prompt with article title + description
       - prompt source-of-truth lives in prompts/news-curator.md
  → Groq AI Analysis (HTTP):
       - calls llama-3.3-70b-versatile
       - gets relevance score 1-10 + 2-sentence summary + topic tags
  → Parse Groq Response (Code):
       - extracts score, summary, topics from AI JSON response
  → Score Filter (IF):
       - score ≥ 6 → save to Supabase
       - score < 6 → discard
  → Save to Supabase (HTTP):
       - POST /articles?on_conflict=url with Prefer: resolution=ignore-duplicates
       - duplicates are silently skipped, no 409 errors
```

---

## RSS Feed Sources

Instead of maintaining 11 fragile direct-publisher RSS feeds (many of which get retired or change URLs without notice), the workflow now uses **8 Google News RSS topic queries**. One provider, one URL template, covers every topic, never 404s, and the topic is encoded directly in the URL.

URL template:

```text
https://news.google.com/rss/search?q=<URL-encoded query>&hl=en-US&gl=US&ceid=US:en
```

| Node | Query |
|------|-------|
| RSS - Ukraine War | `Ukraine war` |
| RSS - World Politics | `world politics` |
| RSS - Tech & Programming | `software engineering OR programming` |
| RSS - AI | `artificial intelligence` |
| RSS - Sports | `sports news` |
| RSS - Running | `running marathon` |
| RSS - Speedcubing | `speedcubing OR "rubiks cube"` |
| RSS - Science | `science breakthrough` |

Publisher (BBC, Reuters, Guardian, etc.) is extracted from the Google News item's `source` field or the `" - Publisher"` suffix at the end of the title. To add a new topic, just add an RSS Feed Read node with a new `q=` query and connect it to `Merge All Feeds`.

---

## Keeping the VM alive

Google Cloud e2-micro in Always Free regions never automatically shuts down (unlike Oracle Cloud). As long as Docker is running, n8n works. The `restart: unless-stopped` in `docker-compose.yml` means n8n auto-restarts if the VM reboots.

**If you reboot the VM:**
```bash
ssh YOUR_VM_IP
cd ~/news-aggregator
docker compose up -d
```

Or set Docker to start on boot (already done via `restart: unless-stopped`).

---

## Managing n8n remotely

To access n8n UI from your Mac at any time:
```bash
ssh -L 5678:localhost:5678 YOUR_VM_IP
# then open http://localhost:5678
```

To check n8n logs:
```bash
ssh YOUR_VM_IP "docker compose -f ~/news-aggregator/docker-compose.yml logs --tail=50"
```

To restart n8n:
```bash
ssh YOUR_VM_IP "cd ~/news-aggregator && docker compose restart"
```

---

## Troubleshooting

**Workflow runs but no articles appear in Supabase**
- Check Groq API key is correct in `.env`
- Check Supabase URL and anon key
- In n8n, open the workflow execution log — click "Executions" tab → see which node failed and why

**Website shows "Could not load articles"**
- Check SUPABASE_URL and SUPABASE_ANON_KEY in `website/index.html`
- Open browser DevTools Console for exact error message
- Make sure you ran the schema.sql in Supabase (Step 7)

**n8n not starting**
```bash
docker compose logs n8n  # check logs
# Common fix: regenerate N8N_ENCRYPTION_KEY in .env and restart
docker compose down && docker compose up -d
```

**RSS Feed node fails for a specific source**
Some feeds change URLs or go offline. Click the failed RSS node → check "Continue on fail" option, or remove the feed.

**Groq rate limit errors (429)**
This means you hit the free tier limit (14,400 req/day). With 50 articles × 12 runs = 600/day you're well under. If you added more feeds, reduce the LIMIT in the Process Articles code node.

---

## Cleanup old articles

Articles older than 14 days accumulate in Supabase. Run this in Supabase SQL Editor to clean up:
```sql
SELECT delete_old_articles();
```

Or automate it in n8n by adding a second workflow with a weekly schedule.

---

## Customization tips

**Add more RSS feeds:**
1. In n8n, add a new **RSS Feed Read** node
2. Set its URL
3. Connect: Schedule Trigger → new RSS node → Merge All Feeds (new input)
4. In Merge node settings, increase numberInputs

**Change AI model:**
In the Groq AI Analysis node, change `llama-3.3-70b-versatile` to any other Groq model:
- `llama-3.1-8b-instant` — faster, less accurate
- `mixtral-8x7b-32768` — good for longer context

**Adjust relevance threshold:**
In the Score Filter node, change `6` to `7` for stricter filtering.

**Change the update frequency:**
In the Schedule Trigger node, change `hoursInterval: 2` to `1` (every hour) or `3`.
