import type { Migration } from './migrations'

/** pipeline migrations. Ids must stay inside this area's range (see migrations.ts). */
export const PIPELINE_MIGRATIONS: Migration[] = [
  {
    id: 300,
    name: 'pipeline: approval uniqueness and lookup indexes',
    sql: `
-- A draft carries at most one valid approval at any time. Re-approving first invalidates the old one,
-- so two concurrent approvals can never both be usable by the SendGate.
CREATE UNIQUE INDEX idx_approvals_one_active ON approvals(draft_id) WHERE invalidated_at IS NULL;

-- Limit checks count the account's recent attempts; reconciliation scans unresolved ones.
CREATE INDEX idx_actions_state_time ON send_actions(state, attempted_at);

-- Scheduled standalone publications are found by kind, state and planned time.
CREATE INDEX idx_opp_kind_state_sched ON opportunities(kind, state, scheduled_at);

-- Thread context walks parent links and looks for the account's own replies under a comment.
CREATE INDEX idx_comments_parent ON comments(channel_id, parent_external_id);
`
  },
  {
    id: 301,
    name: 'pipeline: approvals remember the signed-in identity they were given under',
    sql: `
-- The content hash binds an approval to who is signed in to the account. The identity is stored next to it
-- only so the SendGate can say WHY an approval no longer applies (a changed login, not an edited text).
ALTER TABLE approvals ADD COLUMN signed_in_identity TEXT;
`
  },
  {
    id: 302,
    name: 'pipeline: the picture library of a product (DEC-030)',
    sql: `
-- A picture is a file in the data folder (media/<id>.<ext>) that never changes: an approval binds the bytes by their hash, and a draft that
-- uses a picture keeps pointing at the same file. One picture per product and content: adding the same file twice returns the first.
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  origin TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_media_product_hash ON media(product_id, sha256);
CREATE INDEX idx_media_product ON media(product_id, created_at);
`
  },
  {
    id: 303,
    name: 'pipeline: how the text of a draft is marked up (DEC-030)',
    sql: `
-- 'legacy': the text is sent as it is written (every draft before the post editor, replies, text the AI wrote).
-- 'markdown': written in the post editor; each platform gets the form it can show. Part of the approval hash only when it is 'markdown'.
ALTER TABLE drafts ADD COLUMN markup TEXT NOT NULL DEFAULT 'legacy';
`
  },
  {
    id: 304,
    name: 'pipeline: one post for several channels (DEC-032)',
    sql: `
-- A post group is a wrapper: the master text the owner wrote and the versions made from it. Each version is an ordinary standalone
-- opportunity of one channel (own drafts, own approval, own send, own failure); nothing else in the pipeline reads group_id.
CREATE TABLE post_groups (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  master_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
ALTER TABLE opportunities ADD COLUMN group_id TEXT;
CREATE INDEX idx_opportunities_group ON opportunities(group_id) WHERE group_id IS NOT NULL;
-- One live version per channel in a group (a cancelled one may be made again).
CREATE UNIQUE INDEX idx_opportunities_group_channel ON opportunities(group_id, channel_id) WHERE group_id IS NOT NULL AND state <> 'cancelled';
`
  },
  {
    id: 305,
    name: 'pipeline: the content mix and the owner\'s notes for own updates (DEC-033)',
    sql: `
-- A note the owner wrote about something they did. An own-update draft is written from one unused note and from nothing else.
CREATE TABLE product_updates (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_in_opportunity_id TEXT,
  -- How many times the AI could not make a post from it (it is set aside after a few, so one note never holds the others back).
  failed_tries INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_product_updates_product ON product_updates(product_id, created_at);

-- When the content mix last prepared a draft of a kind on a channel, and when it last tried (a failed try is not repeated at once).
CREATE TABLE mix_state (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  last_draft_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT,
  -- Failed tries in a row: the pause before the next one grows with it (3 hours, then 6, 12, and a day at most).
  failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, kind)
);
`
  },
  {
    id: 306,
    name: 'pipeline: a channel the app cannot read is a channel for own posts (DEC-034)',
    sql: `
-- 1 when the app can read the channel (a connector or a site profile reads it); 0 for a channel of a platform it does not read (Instagram,
-- Facebook, Threads...): such a channel is activated without a first read, is never monitored, and takes the owner's own posts only.
-- Decided from the connector when the channel is connected, assessed or activated; an older channel starts as 1 until then.
ALTER TABLE channels ADD COLUMN reads INTEGER NOT NULL DEFAULT 1;
`
  },
  {
    id: 307,
    name: 'pipeline: the source of an opportunity, and the baseline of the account inbox (DEC-039)',
    sql: `
-- What made the opportunity: 'comment' (a new comment in a discussion the channel reads), 'new_post' (a new post by someone else that matches the
-- channel's topics), 'reply_to_me' or 'mention' (found in the account's inbox). Every row from before the Feed is a comment.
ALTER TABLE opportunities ADD COLUMN source TEXT NOT NULL DEFAULT 'comment';
-- A new post has no comment, so the comment index cannot keep it from being queued twice: one opportunity per post, whatever reads it again.
CREATE UNIQUE INDEX idx_opp_one_new_post ON opportunities(discussion_id) WHERE source = 'new_post' AND discussion_id IS NOT NULL;
-- The Feed lists one product's opportunities by source.
CREATE INDEX idx_opp_product_source ON opportunities(product_id, source, updated_at);
-- When the account's inbox was first read for this channel: that first read only stores what is there (the baseline rule), it queues nothing.
ALTER TABLE channels ADD COLUMN inbox_baseline_done_at TEXT;
`
  },
  {
    id: 308,
    name: 'pipeline: watching on a schedule, a look-back, and findings of the AI triage (DEC-040)',
    sql: `
-- When a post was written on the platform (null when the platform did not say). The look-back reads back as far as this.
ALTER TABLE discussions ADD COLUMN posted_at TEXT;
-- When the one-time look-back of a channel was made (the last settings.lookBackDays days). Null: not yet, so the next check makes it.
ALTER TABLE channels ADD COLUMN looked_back_at TEXT;
-- Up to when the posts of the channel were LISTED, whole: the moment its last fully successful listing started. Internal to the triage (not part of the
-- shared Channel): the next listing reads from here less an hour, so a listing that failed or was interrupted leaves it alone and the posts written
-- meanwhile are listed at the next pass. Null: not listed yet, so the next pass makes the first look (looked_back_at is only the mark that it was made).
ALTER TABLE channels ADD COLUMN listed_through TEXT;
-- One row per post of a channel that the AI triage judged: by its title first, then (if it was relevant) by reading it. A post is judged once.
-- stage: 'pending' (found, not yet judged: the engine was not ready), 'title' (judged by its title alone), 'read' (opened and read).
-- label: 'reply' (worth a reply: opportunity_id points at it), 'notice' (worth noticing), 'skip' (not relevant). It is null while the stage is 'pending',
-- and also while the stage is 'title' and the post waits to be read (judged relevant by its title; a title judged not relevant is already 'skip').
CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  posted_at TEXT,
  stage TEXT NOT NULL,
  label TEXT,
  -- One line: how the post relates (or does not relate) to the product's goal. Written by the AI from the page; shown as data, never obeyed.
  relation TEXT NOT NULL DEFAULT '',
  -- 1 when the post was found by the look-back of a new channel, not by a later check.
  first_look INTEGER NOT NULL DEFAULT 0,
  -- How many passes the engine ANSWERED about this post and the answer could not be used even after the one repair, or the post could not be read while
  -- others could. Internal to the store (not part of the shared Finding). A post that was not judged because the engine was not ready, used tools, timed
  -- out, failed or the owner took the browser is not counted, nor is a pass in which the engine judged no other post, nor one in which no thread could
  -- be read. It also orders the posts that wait to be read (the fewest failures first). At 3 the post is settled as a notice (never dropped, never a
  -- skip or a reply): see FindingStore.recordUnusable and recordUnreadable.
  attempts INTEGER NOT NULL DEFAULT 0,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (channel_id, external_id)
);
CREATE INDEX idx_findings_product ON findings(product_id, label, created_at);
-- "Was anything judged lately?" (the engine counts as working for a day after a real judgment: FindingStore.recentJudgment).
CREATE INDEX idx_findings_judged ON findings(updated_at) WHERE label IS NOT NULL;
-- The default check interval is now 3 hours (it was 30 minutes): a channel still on the old default follows it; a value the owner chose stays.
-- json_valid first: json_extract throws on a text that is not JSON, and one such row would stop the whole migration (and with it the application).
UPDATE channels SET settings_json = json_set(settings_json, '$.checkIntervalMin', 180) WHERE json_valid(settings_json) AND json_extract(settings_json, '$.checkIntervalMin') = 30;
`
  },
  {
    id: 309,
    name: 'pipeline: the post type and the template card of a quick post (DEC-046)',
    sql: `
-- 'article': the long form (title, Markdown text); every draft that exists now. 'quick': one picture plus a caption in the text, with no title (DEC-046).
-- Screens choose their layout by this column, never by guessing from an empty title.
ALTER TABLE drafts ADD COLUMN post_type TEXT NOT NULL DEFAULT 'article';
-- The template card parameters of a quick post (style, colour, shape, headline, whether the owner edited the headline), so a saved card can be changed
-- and drawn again (REQ-003). Null when the picture is not a card, and for every article.
ALTER TABLE drafts ADD COLUMN card_json TEXT;
`
  },
  {
    id: 310,
    name: 'pipeline: the product keeps whether its site ends every new post (DEC-044)',
    sql: `
-- On for every product that exists: the owner asked for the site's address at the end of each post. The switch is on the product's page.
ALTER TABLE products ADD COLUMN add_site_link INTEGER NOT NULL DEFAULT 1;
`
  },
  {
    id: 311,
    name: 'pipeline: a post worth a reply keeps what the AI read in it: the post, the thread, whom to answer and a comment to leave',
    sql: `
-- Written by the AI after it opened a post in the account's browser and read what is said under it; plain text of a stranger's page, shown and never obeyed.
-- Empty for every finding that was not read that way (a skip, a notice, and everything found before this).
ALTER TABLE findings ADD COLUMN about TEXT NOT NULL DEFAULT '';
ALTER TABLE findings ADD COLUMN thread TEXT NOT NULL DEFAULT '';
ALTER TABLE findings ADD COLUMN reply_to TEXT NOT NULL DEFAULT '';
ALTER TABLE findings ADD COLUMN suggested_comment TEXT NOT NULL DEFAULT '';
`
  },
  {
    id: 312,
    name: 'pipeline: the comments the AI read under a post worth a reply, one row each, so the owner can pick the one to answer',
    sql: `
-- A stranger's text as the AI saw it in the browser (plain text, links shown as "[link]"), in reading order; shown, never obeyed.
-- \`url\` is the comment's own address when the AI could see it, empty otherwise.
CREATE TABLE finding_comments (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  author TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (finding_id, position)
);
`
  },
  {
    id: 313,
    name: 'pipeline: the owner can star a post of the Feed, and the posts the AI called worth a reply start starred',
    sql: `
-- The owner's own mark on a post (a star): null when there is none. It is a filter of the one list of posts, not a place of its own.
ALTER TABLE findings ADD COLUMN starred_at TEXT;
-- A post of the account itself (the owner's own post, found in the channel): its comments are what the owner wants answered first, so the Feed marks it and lists it first.
-- Nothing records one yet; the watch of the comments under our own posts does (it is built after the thread analysis).
ALTER TABLE findings ADD COLUMN is_own INTEGER NOT NULL DEFAULT 0;
-- What the AI called worth a reply before there was a star is starred now, so the owner loses none of them with the Worth a reply list.
UPDATE findings SET starred_at = created_at WHERE label = 'notice' AND relation LIKE 'Worth a reply: %';
`
  },
  {
    id: 314,
    name: 'pipeline: a post the AI read keeps the analysis of its thread, the topics it raises and its pictures',
    sql: `
-- What the AI wrote after it opened a post and read it in full: the analysis of the thread (what people say, where they agree and differ, what is left
-- unanswered) and the topics it raises, each with an idea for the owner's own post (a JSON list of { topic, idea }). Plain text of the AI about a stranger's
-- page: shown, never obeyed. \`read_at\` is when the AI last read the post in full (null: it has not).
ALTER TABLE findings ADD COLUMN analysis TEXT NOT NULL DEFAULT '';
ALTER TABLE findings ADD COLUMN topics_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE findings ADD COLUMN read_at TEXT;
-- How many times a look was sent to read a post it had noted and not read: a post that was offered \`WATCH_READ_TRIES\` times and still is not read (it is gone, or
-- the site will not show it) is left for the owner's "Check with AI" instead of costing every look its calls.
ALTER TABLE findings ADD COLUMN read_tries INTEGER NOT NULL DEFAULT 0;
-- Every post that was read before this (it has a summary of the post) was read at the time it was judged.
UPDATE findings SET read_at = updated_at WHERE about <> '';
-- The pictures of a post, as the page showed them. The file is kept in the application's own folder of post pictures (never in the owner's picture library:
-- these are strangers' pictures, not material for the owner's posts); it stays empty while the picture waits to be fetched, and \`failure\` says why it could not be.
CREATE TABLE finding_images (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  file TEXT,
  mime TEXT,
  bytes INTEGER,
  width INTEGER,
  height INTEGER,
  failure TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (finding_id, position)
);
`
  },
  {
    id: 315,
    name: 'pipeline: a reply the owner sends from a post of the Feed remembers the post it came from',
    sql: `
-- The owner writes a comment under a post (or under a comment) of the Feed and presses Send: the application then makes the same opportunity, draft and approval a
-- reply has always had, so the gate, the limits and the rule about an unknown result hold for it too. \`finding_id\` says which post of the Feed it answers: the
-- channel of such a post is one the application does not read, so the gate does not ask the platform for the thread, and the result is left for the owner to confirm.
ALTER TABLE opportunities ADD COLUMN finding_id TEXT REFERENCES findings(id) ON DELETE SET NULL;
CREATE INDEX idx_opp_finding ON opportunities(finding_id) WHERE finding_id IS NOT NULL;
`
  }
]
