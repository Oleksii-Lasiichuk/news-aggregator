-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Articles table
CREATE TABLE IF NOT EXISTS articles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        TEXT NOT NULL,
  url          TEXT UNIQUE NOT NULL,
  source       TEXT NOT NULL,
  summary      TEXT,
  score        INTEGER CHECK (score >= 1 AND score <= 10),
  topics       TEXT[] DEFAULT '{}',
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Fast topic filtering (GIN index for array column)
CREATE INDEX IF NOT EXISTS idx_articles_topics       ON articles USING GIN (topics);
-- Fast date sorting
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles (published_at DESC);
-- URL uniqueness check
CREATE INDEX IF NOT EXISTS idx_articles_url          ON articles (url);
-- Score sorting
CREATE INDEX IF NOT EXISTS idx_articles_score        ON articles (score DESC);

-- Row Level Security: website reads without authentication
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access"
  ON articles
  FOR SELECT
  TO anon
  USING (true);

-- Only the service role (n8n via anon key + RLS disabled for insert) can write.
-- We allow anon INSERT too so n8n can use the anon key for everything:
CREATE POLICY "Allow anon insert"
  ON articles
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Cleanup function: delete articles older than 14 days (run manually in Supabase SQL editor)
CREATE OR REPLACE FUNCTION delete_old_articles()
RETURNS void AS $$
BEGIN
  DELETE FROM articles WHERE created_at < NOW() - INTERVAL '14 days';
END;
$$ LANGUAGE plpgsql;
