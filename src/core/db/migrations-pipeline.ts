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
  },
  {
    id: 316,
    name: 'pipeline: a post of the Feed keeps the numbers its site shows for it',
    sql: `
-- How many comments a post has and its score, as the SITE said them on a page the AI looked at (the AI has no field to say them itself): \`stats_at\` is when a
-- page last gave them. Null while no page has: a platform that shows no such numbers (Instagram, Threads) stays null.
ALTER TABLE findings ADD COLUMN reply_count INTEGER;
ALTER TABLE findings ADD COLUMN score INTEGER;
ALTER TABLE findings ADD COLUMN stats_at TEXT;
`
  },
  {
    id: 317,
    name: 'pipeline: the analysis of the whole Feed, kept with its date',
    sql: `
-- The AI's reading of the posts of a period as a whole: the themes they raise, which posts belong to which, and the questions nobody answered. One row per
-- product, channel (\`channel_key\` is empty for every channel) and period, replaced by the next analysis. \`signature\` says which posts it was made from, so the Feed
-- can tell when new posts came since. The counts shown next to a theme are never stored: they are counted from the posts when the card is shown.
CREATE TABLE feed_analyses (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE,
  channel_key TEXT NOT NULL DEFAULT '',
  days INTEGER NOT NULL,
  signature TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (product_id, channel_key, days)
);
`
  },
  {
    id: 318,
    name: 'pipeline: an approval can carry what the owner knowingly let through (Send anyway)',
    sql: `
-- What the owner knowingly let through when they gave this approval, as a JSON list of names (today only 'community_rules': the community's own rules forbid
-- what is sent, and the owner pressed Send anyway). It belongs to the approval, so it dies with it: a changed text needs a new approval, and a new press.
-- DEC-050 removed "Send anyway" (0.38.1): nothing reads or writes this column any more. It stays, with its default, because an applied migration is never edited.
ALTER TABLE approvals ADD COLUMN acknowledged_json TEXT NOT NULL DEFAULT '[]';
`
  },
  {
    id: 319,
    name: 'pipeline: the post\'s own text, its translations, the AI\'s explanation of it, and tags',
    sql: `
-- The post's own text, as the SITE showed it on the page of the post the AI opened (the AI has no field to write it: it is read from the page by the
-- application). Empty until a page of the post gave it; \`body_at\` is when a page last did (an empty text with a date means the post has no text of its own).
ALTER TABLE findings ADD COLUMN body TEXT NOT NULL DEFAULT '';
ALTER TABLE findings ADD COLUMN body_at TEXT;
-- When the AI last gave this post its tags (also when it gave none), so a post is not offered again and again.
ALTER TABLE findings ADD COLUMN tagged_at TEXT;

-- A post and its comments in the language the owner picked, kept so a second look is free. \`signature\` says which text it was made from: when the text
-- changed (the post was read again) the kept translation is not shown as the translation of the new one.
CREATE TABLE finding_translations (
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  signature TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (finding_id, language)
);

-- The AI's explanation of one post (what it is about, what the person wants, what is worth noticing, where they are right and wrong, what could be answered),
-- in the language the owner picked. \`signature\` says which text it was made from.
CREATE TABLE finding_assists (
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  signature TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (finding_id, language)
);

-- Tags of the product's posts: a few words each, the AI's name for what a post is about. They are counted by the application, never by the AI.
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (product_id, name)
);
CREATE TABLE finding_tags (
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (finding_id, tag_id)
);
CREATE INDEX idx_finding_tags_tag ON finding_tags (tag_id);
`
  },
  {
    id: 320,
    name: 'pipeline: what a community\'s rules text said about AI or promotion is forgotten (DEC-050)',
    sql: `
-- Until 0.38.0 the application read a community's rules and kept what it thought of them in the channel's capabilities: an AI/automation ban as a restriction of
-- publish_post and publish_reply, a note about promotion in the detail of publish_post, and a 'rules' capability of its own. DEC-050 removed all of it: the
-- rules text restricts nothing and warns about nothing. This rewrites what is already stored so it does not go on saying it.
--   - the 'rules' capability is dropped (the key does not exist any more);
--   - a restriction that only said "the rules appear to forbid automation or AI-generated content" goes back to needs_check (what a channel never assessed says);
--   - a detail that carries the promotion note (the form check put its own sentence before it) says "Not checked yet." and keeps its status.
-- A restriction the site itself enforces (banned, only approved users) has other words and is not touched. Only the channels that carry any of it are rewritten.
UPDATE channels
SET capabilities_json = (
  SELECT json_group_array(json(
    CASE
      WHEN json_extract(e.value, '$.status') = 'restricted'
        AND json_extract(e.value, '$.key') IN ('publish_post', 'publish_reply')
        AND json_extract(e.value, '$.detail') LIKE '%Community rules appear to forbid automation or AI-generated content%'
        THEN json_set(e.value, '$.status', 'needs_check', '$.detail', 'Not checked yet.')
      WHEN json_extract(e.value, '$.detail') LIKE '%Rules mention promotion%'
        THEN json_set(e.value, '$.detail', 'Not checked yet.')
      ELSE e.value
    END
  ))
  FROM json_each(channels.capabilities_json) AS e
  WHERE json_extract(e.value, '$.key') IS NOT 'rules'
)
WHERE json_valid(capabilities_json)
  AND json_type(capabilities_json) = 'array'
  AND (
    capabilities_json LIKE '%"rules"%'
    OR capabilities_json LIKE '%Community rules appear to forbid automation%'
    OR capabilities_json LIKE '%Rules mention promotion%'
  );
`
  },
  {
    id: 321,
    name: 'drafts: the flair of a post',
    sql: `
-- The name of the label a community asks of a post (Reddit's flair), chosen from the community's own list; null: none. Part of what an approval binds.
ALTER TABLE drafts ADD COLUMN flair TEXT;
`
  },
  {
    id: 322,
    name: 'products: the site link names the platform and the channel it stands on',
    sql: `
-- Off unless the owner turns it on: the address that ends a post carries utm tags, so the site's own analytics can tell where a visit came from.
ALTER TABLE products ADD COLUMN tag_site_link INTEGER NOT NULL DEFAULT 0;
`
  },
  {
    id: 323,
    name: 'positioning of a product and the audience\'s own words',
    sql: `
-- Five answers about the product's place (DEC-059). The proposal of the AI and what the owner approved are kept apart: a new proposal never
-- replaces what is in force.
CREATE TABLE product_positioning (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  proposed_json TEXT,
  proposed_at TEXT,
  approved_json TEXT,
  approved_at TEXT
);
-- What the audience asks, objects to and calls things, taken from the posts the Feed read. hidden: the owner took it out; kept so it is not offered again.
CREATE TABLE audience_words (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX audience_words_by_product ON audience_words (product_id, hidden);
CREATE TABLE audience_word_posts (
  word_id TEXT NOT NULL REFERENCES audience_words(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  PRIMARY KEY (word_id, finding_id)
);
-- The read posts a collection has taken already.
CREATE TABLE audience_word_seen (
  finding_id TEXT PRIMARY KEY REFERENCES findings(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  seen_at TEXT NOT NULL
);
`
  }
  ,
  {
    id: 324,
    name: 'the seasonal calendar of a product',
    sql: `
-- The calendars the owner follows for a product (DEC-060): moon, zodiac, seasons, gifts. The dates themselves are computed, not stored.
CREATE TABLE product_calendars (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  PRIMARY KEY (product_id, kind)
);
-- The owner's own dates: every year (year NULL) or once.
CREATE TABLE product_dates (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  month INTEGER NOT NULL,
  day INTEGER NOT NULL,
  year INTEGER,
  created_at TEXT NOT NULL
);
-- The post prepared for a date and a channel, and the dates the owner skipped.
CREATE TABLE seasonal_posts (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (product_id, event_key, channel_id)
);
CREATE TABLE seasonal_skipped (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (product_id, event_key)
);
`
  }
  ,
  {
    id: 325,
    name: 'the people met while promoting a product',
    sql: `
-- The owner's own notes about people (DEC-066): typed by hand, never given to the AI. owed '' : nothing is owed. permission: none, asked, given.
CREATE TABLE people (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  handle TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  where_met TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  owed TEXT NOT NULL DEFAULT '',
  testimonial TEXT NOT NULL DEFAULT '',
  testimonial_source TEXT NOT NULL DEFAULT '',
  permission TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX people_by_product ON people (product_id, updated_at);
`
  }
  ,
  {
    id: 326,
    name: 'a number and a date on a promotion goal',
    sql: `
-- DEC-067: what the application counts for a goal, the number to reach and the local day it is due by; the count starts at since_at.
CREATE TABLE goal_targets (
  goal_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  measure TEXT NOT NULL,
  number INTEGER NOT NULL,
  by_day TEXT NOT NULL,
  since_at TEXT NOT NULL
);
CREATE INDEX goal_targets_by_product ON goal_targets (product_id);
`
  }
  ,
  {
    id: 327,
    name: 'a warm-up plan the owner started for an account',
    sql: `
-- DEC-068: the day the plan was started; how far it is is counted from what the account sent since.
CREATE TABLE account_warmups (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL
);
`
  }
  ,
  {
    id: 328,
    name: 'themes: named stretches of days of a product',
    sql: `
-- DEC-070: from_day and to_day are local days, both included.
CREATE TABLE themes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  from_day TEXT NOT NULL,
  to_day TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX themes_by_product ON themes (product_id, from_day);
`
  }
  ,
  {
    id: 329,
    name: 'the owner\'s choices about how a product is worked, and the launch venues\' ticks',
    sql: `
-- DEC-071: all off until the owner sets them. channel_limit NULL: no limit.
CREATE TABLE product_choices (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  channel_limit INTEGER,
  low_time INTEGER NOT NULL DEFAULT 0,
  software INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE launch_venues (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  venue TEXT NOT NULL,
  steps_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (product_id, venue)
);
`
  }
  ,
  {
    id: 330,
    name: 'site visits: where a product\'s site is counted and the last reading',
    sql: `
-- DEC-073: source is none, plausible or google. The key is in the vault (visits:<product id>), never here.
CREATE TABLE site_visits (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'none',
  site_id TEXT NOT NULL DEFAULT '',
  host TEXT NOT NULL DEFAULT '',
  read_at TEXT,
  error TEXT,
  total INTEGER,
  rows_json TEXT NOT NULL DEFAULT '[]'
);
`
  }
]
