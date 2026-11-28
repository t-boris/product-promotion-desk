# Scheduled publishing, comments and replies on every channel: implementation plan

Status: **built through 0.101.0 (all phases A-J + follow-ups DEC-092..DEC-100); live proofs on the owner's real accounts and apps remain** (section 6a). Originally written 2026-11-27 from the owner's request ("post, see comments and reply automatically; create posts and spread them over time") at 0.50.0.

## 1. Why

| What the owner meets | Cause today |
|---|---|
| A time cannot be set on a post for Instagram, Facebook, Threads, X, LinkedIn, Telegram, Pinterest | `publications.ts:244-246` refuses a schedule for a channel the app cannot read; an unattended send never drives the AI browser (`send-ways.ts:33`; DEC-031, DEC-035, DEC-043) |
| A scheduled Reddit post fails or ends unknown | The scheduled path always uses the connector (`sending.ts:511-545`), and the connector ignores the flair (`request.ts:20` sets it, `reddit/publish.ts` never reads it) and carries one picture at most (`publish.ts:58-74`). Inferred from code, not yet reproduced live |
| Every post outside Reddit ends as "Result unknown" | The app does not read such channels back (`mission-publisher.ts:343-349`); no platform id is stored (`sending.ts:481`), so there is no standing re-check and no likes or views |
| Nothing is sent while the app is closed or the Mac sleeps; a late post returns to review | The scheduler is an in-process timer (`scheduler.ts:123-130`), no start at login (`main/lifecycle.ts:28-29`), one hour of lateness allowed (`sending.ts:34-35`); DEC-003 |
| Posts cannot be spread over time | One fixed time per post (`opportunities.scheduled_at`); no queue, no recurring slots |
| Comments are seen only on Reddit | Real comment and inbox reads exist only in `RedditConnector`; every other channel gets AI notes every 3 h (`browser-watch.ts`), with no tracking of comments under the owner's own posts |
| A reply to a comment cannot be scheduled on a read channel | `publications.ts:240`; only Feed comments can be scheduled (DEC-049), always with an unknown result |
| No official API is used anywhere | Only `RedditConnector` and `UniversalConnector` exist (`connectors/index.ts:11-13`); official APIs were rejected earlier as out of reach (DEC-031 alt. 2, DEC-045 alt. 3) |

## 2. What the research found

Marks: **V** = read on the platform's official page on 2026-11-27, **S** = secondary sources only, **T** = must be proven by a live test before building (section 5).

| Platform | Publish by API | Comments: read / reply | Native schedule | Needs | Cost |
|---|---|---|---|---|---|
| Telegram channel | Yes, local files (V) | Yes / yes, through the linked discussion group (V, thread flow T) | No | Bot from BotFather, admin of the channel and of the group; long polling, no server | Free |
| Facebook Page | Yes, local files (V) | Yes / yes (V) | **Yes**, 10 min to 30 days (V) | Own Meta app; Page token without expiry; app in Live mode so posts are public (T) | Free |
| Threads | Yes; text and link need nothing else; pictures and video must be on a public URL (V) | Yes / yes, polling only (V) | No | Same Meta app, account added as tester; token refreshed within 60 days | Free |
| Instagram | Yes: picture, carousel, Reels, Stories; no text-only post, no link; media on a public URL (V) | Yes / yes (V) | No | Professional account; same Meta app; token refreshed within 60 days | Free |
| X | Yes, local files (V) | Read through own mentions (V); reply allowed only when the author "summoned" the replier (V), whether a reply under the owner's own post counts is T | No | Own X developer app, OAuth with PKCE, callback `http://127.0.0.1` | Pay per use: $0.015 a post, $0.20 a post with a link, $0.001 an owned read; about $2-25 a month per account |
| Pinterest | Yes, picture from a local file as base64, video upload (V) | **Not in the API** (V) | No | Standard access (demo video with the sign-in flow); with Trial access pins are visible only to their creator | Free |
| LinkedIn profile | Yes, local files (V) | **Closed** (`r_member_social` not granted) (V) | No | Self-serve app; sign-in again every 60 days | Free |
| LinkedIn company page | Only for a registered legal organisation after vetting (V) | Same | No | Not planned | Free |
| Reddit | New API access reported closed, public Data API reported to end in March 2027 (S; Reddit's own pages could not be read) | Same | No | Stays on the account's browser session, as today | Free |
| Facebook profile, Facebook Groups | No API (V) | No | No | AI browser only | — |
| TikTok, YouTube | Not researched | — | — | — | — |

Unified services (Zernio, Postiz cloud, Ayrshare) were considered and are **not proposed**: they schedule posts on all platforms for $39-149 a month without app reviews, but the tokens of every account are held by a third party, comment reading is partial, and Telegram is complete and free when done directly. Postiz is open source (AGPL) and its provider files are a useful checklist of endpoints and scopes; no code is copied.

Sources are listed in section 9.

## 3. Decisions the owner has to make

The recommended answer is in bold. None is assumed.

| # | Question | Recommended |
|---|---|---|
| D1 | May a scheduled post be sent by the AI browser without a press on channels that have no API (Reddit communities the app does not read, LinkedIn comments aside, Pinterest before approval, Facebook profile and groups)? This reverses DEC-031 (7), DEC-035 and DEC-043 for posts the owner approved and gave a time | **Yes**, only for a post approved with its exact content and a time set by the owner |
| D2 | May the application start at login and keep the Mac awake around a due post? This reverses DEC-003 | **Yes**, both as switches in Settings, on by default after the owner's first schedule |
| D3 | How late may a scheduled post still go out by itself (today 1 hour)? | **A setting, default 6 hours**; later than that it returns to review as today |
| D4 | Will the owner create their own developer apps: Meta (free), X (paid per use), Pinterest (demo video)? | **Meta and Telegram bot first; X and Pinterest when their phase comes** |
| D5 | Instagram and Threads fetch pictures and video from a public address. Where may a file stand for the minutes of a publication? | **A storage bucket of the owner's own** (the file is uploaded before the send and deleted after the platform has read it); the alternative for Instagram video only is Facebook Login with a linked Page |
| D6 | Order of platforms | **Telegram → Facebook Page → Threads → Instagram → X → Pinterest and LinkedIn (publish only)** |
| D7 | Queue: fixed slots per channel (for example Mon/Wed/Fri 10:00) into which ready posts fall in order, in addition to a time set by hand | **Yes** |
| D8 | Facts needed before phase E: is the Instagram account professional; is Facebook a Page or a personal profile; does the Telegram channel have a linked discussion group | Owner's answer |

Each accepted answer is recorded as a decision (DEC-053 onward) through MarkView before its phase starts.

## 4. Principles

1. **Approval does not change.** Every post is approved by the owner with its exact content, account and destination; the send gate, the single-use ticket, the per-account limits and "one attempt per item" stay (`gate.ts`, `tickets.ts`, `sending.ts`). A schedule decides only *when* an approved post is sent.
2. **One connector interface.** An API connector implements the existing `Connector` (`ports.ts:512-569`): `publish`, `findPublished`, `fetchActivity`, `fetchThread`, `readInbox`, `fetchMetrics`, `readStanding`. Nothing in the pipeline learns what an "API channel" is; it sees a channel that is read (`reads = true`) and a result that is confirmed with an id and an address.
3. **The site is the judge.** A result is "confirmed" only when the platform returned the post's id; a failed or unreadable call is "unknown" and is settled by the existing re-check, never guessed.
4. **No per-site patches.** What every API connector needs (tokens, refresh, HTTP with rate-limit handling, upload of a local file, polling of own posts) is built once in phase D.
5. **Secrets stay in the vault.** App keys and tokens are stored like passwords (`core/vault.ts`, safeStorage); the AI is never shown them; the core still never imports Electron (DEC-005) and reaches the network through a port.
6. **The browser stays for what has no API**, and is the fallback, not a second way to do the same send: a channel has one send way at a time.
7. **A layout is shown before a screen is built** (schedule and queue, channel connection).

## 5. Phase 0: proofs before building

Each is a throwaway probe with the owner's own account; the result decides the phase it belongs to. No product code depends on an unproven answer.

| # | Proof | Decides |
|---|---|---|
| T1 | Telegram: a test bot in a channel and its discussion group receives a comment through `getUpdates` and replies inside the thread of the post | Phase E |
| T2 | Meta: a post made by the app in Development mode is, or is not, visible to another account; what the dashboard asks to switch the app to Live with Standard Access only | Phases F-H |
| T3 | Meta: which redirect addresses the Instagram and Threads dashboards accept (loopback or not), or whether the dashboard's own token generator is enough for one owner | Phase D sign-in flow |
| T4 | X: a programmatic reply to a person who commented under the owner's own post is accepted or refused | Whether phase I includes replies |
| T5 | Reddit: a scheduled post with a required flair through the connector path (old.reddit form) fails as predicted; the flair field of that form can be set | Phase C |
| T6 | Reddit: the account's own-submitted list (`readStanding` uses it, lesson 328) finds a post made by the AI browser in a community the app does not read | Phase C read-back |

## 6. Phases

Versions are proposals; each phase is one release, installed and checked on the real screen before the next starts.

### Phase A: a time and a queue for every channel (0.51.0) — needs D1, D3, D7

- Remove the schedule refusal for channels that are not read (`publications.ts:244-246`, `post-format.ts:947-959`) and let a due, approved post take the channel's send way, including the AI browser (`send-ways.ts:27-58`), under the same ticket rule as a pressed send (`mission-publisher.ts:145-179`).
- Queue slots per channel: a new table (pipeline migration 322) of weekday and time slots; "Add to queue" places an approved post on the next free slot; a post keeps one time (`scheduled_at`), the slot is only how the time is chosen.
- Multi-channel groups (DEC-032): a group may be scheduled as a whole or spread, one version per slot of its channel; "Send all" keeps its snapshot rule.
- The lateness limit becomes a setting (D3).
- Scheduled replies for reply items of read channels (`publications.ts:240`).
- Screen: schedule control, queue editor and the Posts calendar; sketch shown first.
- Proven by: unit tests of slot placement and lateness; a live scheduled send on one read Reddit community and one AI-browser channel.

### Phase B: working while the owner is away (0.52.0) — needs D2

- Start at login as a menu-bar application (`app.setLoginItemSettings`), switch in Settings.
- Keep the Mac from sleeping from a few minutes before a due post until its result is known (`powerSaveBlocker`), only while a post is due within the window. Waking a Mac that is already asleep needs an administrator's `pmset` schedule; this plan does not do it and says so on the screen ("the Mac must be awake at ...").
- On wake and on start, due posts within the lateness limit are sent first, spaced as today (`scheduler.ts:158-172`).
- Proven by: a post due while the lid is closed for less than the limit goes out on wake; one due beyond it returns to review with the existing sentence.

### Phase C: the Reddit path completed (0.53.0) — needs T5, T6

- The connector path sets the approved flair, or a post with a flair or several pictures takes the AI browser when the connector cannot carry it (`send-ways.ts:50-58`); the choice is by what the post holds, never silent loss of the flair.
- Read-back for communities the app does not read, through the account's own-submitted list, so such posts become confirmed, get an id, the standing re-check and comment reads through the inbox.
- Proven by: live sends to r/beginnerastrology (flair required) by schedule and by press.

### Phase D: the base for API connectors (0.54.0) — needs D4, T3

- A network port for the core (HTTP with timeouts, rate-limit and retry-after handling, streamed upload of a local file by path; lesson 322).
- Vault entries for an app's keys and an account's tokens; a refresh job in the scheduler that renews tokens well before they expire and raises a sign-in item in Inbox when it cannot.
- Channel connection: "Connect with the platform's API" in the one Add-a-channel flow (0.46.0), with the steps the owner must do on the platform's side written out; a channel connected this way is stored with its API connector and `reads = true`.
- Tracking of the owner's own posts: every confirmed post's id is polled for new comments (interval by age, like the standing re-check, `standing.ts:17-34`); new comments become reply items in Inbox and the conversation in Feed. This is connector-agnostic and also serves Reddit.
- Per-post likes and views (the plan of 2026-11-22, slices A-C) read through `fetchMetrics` by post id.
- Proven by: contract tests of the port against a fake server; a fake API connector run through the whole pipeline (schedule, confirm, comment, reply, re-check).

### Phase E: Telegram (0.55.0) — needs T1, D8

- `TelegramBotConnector`: text, pictures, albums, video up to 50 MB, link in the text; comments from the linked discussion group by long polling (updates are kept 24 h by Telegram; a longer absence is shown as a gap, not hidden); reply in the thread; reactions count. Views are not available to a bot and are shown as such.
- Proven by: live post, comment, reply on the owner's channel.

### Phase F: Facebook Page (0.56.0) — needs T2, D8

- `FacebookPageConnector`: text, link, photos, video and Reels from local files; comments and replies; insights. A scheduled post is handed to Facebook's own schedule (`scheduled_publish_time`) when it is 10 minutes to 30 days ahead, so it goes out with the Mac off; the app shows it as "scheduled on Facebook" and reads the result when it can.
- Personal profiles and Groups keep the AI browser.

### Phase G: Threads (0.57.0) — needs T2, D5 for media

- `ThreadsConnector`: text and link posts first (no hosting needed), then pictures and video through D5; replies read by polling `conversation`; reply; hide; insights. Limits enforced before the send: 500 characters, 5 links.

### Phase H: Instagram (0.58.0) — needs T2, D5, D8

- `InstagramConnector` (Instagram Login): picture, carousel, Reels through the container flow with status polling; comments, replies, hide; insights. JPEG only: other formats are converted before upload. The caption's "Link in bio" rule (DEC-036) stays.

### Phase I: X (0.59.0) — needs D4, T4

- `XConnector`: post with media from local files; replies read through own mentions; reply only if T4 allows it; metrics. The price of each send is shown before approval (a post with a link costs $0.20) and a monthly spending limit is set on X's side.

### Phase J: Pinterest and LinkedIn, publishing only (0.60.0) — needs D4

- `PinterestConnector` after Standard access is granted: pins with picture or video, board choice from the account's own list, analytics. Comments stay with the AI browser.
- `LinkedInConnector` for a personal profile: text, link, pictures, video. Comments, replies and metrics stay with the AI browser; the 60-day sign-in is raised in Inbox a week ahead.

## 6a. Status (2026-11-28, version 0.101.0)

| Phase | State | Version | Not proven on a real site |
|---|---|---|---|
| A | built | 0.51.0 (DEC-053), 0.94.0 (DEC-093: scheduling a group of approved versions at one time or spread across each channel's next free posting time), 0.98.0 (DEC-098: scheduled comments and scheduled Feed answers shown in the Posts list and calendar with full review and reschedule controls) | a scheduled send carried by the AI browser |
| B | built | 0.52.0 (DEC-054) | a real start at login; the sleep blocker over a night |
| C | built | 0.53.0; 0.95.0 (DEC-095: Q-008 answered and enforced — mixed post kinds rejected, Reddit supports flair/editor parity) | a flair send by schedule; the read-back from the account's own posts |
| D | built, with E | 0.55.0 (DEC-055); 0.95.0 (DEC-094: single access mode per account — browser OR API, not dual-mode); 0.99.0 (DEC-099: B4 own-posts-first browser comment watch + tabbed account browser window); 0.100.0 (DEC-100: read-only IMAP mailboxes and unified Mail inbox) | — (the fake server only) |
| E | built | 0.55.0 | everything: needs the owner's bot (proof T1) |
| F | built | 0.78.0 (DEC-076), 0.79.0 (DEC-077: Facebook's own schedule, views of a post), 0.89.0 (DEC-088: one video with the post's words), 0.93.0 (DEC-092: Reels through Facebook's Reels Publishing API, chosen under the video and bound by approval), 0.96.0 (DEC-096: hiding and unhiding a Page comment via `POST /{comment-id}` `is_hidden`) | everything: needs the owner's Meta app and a Page access token; for a video also that its post carries the video's description as its words; for a Reel also upload/processing on `rupload.facebook.com`, whether a Reel appears in the Page's feed for comments and numbers, and the 30 Reels/day limit; comment hide/unhide on a real Page |
| G | built | 0.82.0 (DEC-080): connector `threads-api`, the token of an hour exchanged for a 60-day one with the Threads app secret (used once, not kept) and renewed by the scheduler job `api-keys`. 0.83.0 (DEC-081): pictures, video and several of them as one post, through the owner's place for files (D5: Settings, "A place for files"; an S3 bucket, a file put for the send, an address signed for an hour, deleted afterwards). 0.90.0 (DEC-089): hiding/unhiding a top-level reply. 0.96.0 (DEC-096): reading daily publishing limit (`channels.publishingQuota` via `threads_publishing_limit`) | everything: needs the owner's Meta app with the Threads use case and the owner's bucket. Not said by Meta: whether a file is read from an address with a signature in its query; live quota response |
| H | built | 0.84.0 (DEC-082): connector `instagram-api` (Instagram API with Instagram Login): one picture, one video as a reel, or a carousel, through the place for files; a picture that is not JPEG goes as a JPEG copy (0.84.1, DEC-083); comments read (50 newest per post) and answered; likes, comments, views; the dashboard's 60-day token renewed by the times the application remembers (`api_key_times`). 0.90.0 (DEC-089): hiding/unhiding a comment. 0.96.0 (DEC-096): reading daily publishing limit (`content_publishing_limit`). 0.97.0 (DEC-097): Stories (`media_type=STORIES` + `/stories` reconciliation), `alt_text`, and `user_tags` (migration 411, approval-hash bound, editor + quick composer) | everything: needs the owner's Meta app with the Instagram use case, a professional account and the bucket; live Stories, `alt_text`, `user_tags`, and daily publishing quota |
| I | built | 0.87.0 (DEC-086): connector `x-api` (OAuth 2.0 PKCE via `http://127.0.0.1:47821/signin`, token renewed on use, up to 4 pictures or 1 GIF, price line before approval). 0.88.0 (DEC-087): replies read and answered (`users/{id}/tweets` and `users/{id}/mentions`, reply price line). 0.92.0 (DEC-091): chunked video upload (MP4/MOV). 0.96.0 (DEC-096): standalone mentions from other people surfaced as Inbox items (`XApiConnector.readInbox`) | everything: needs the owner's X app with credits; whether X takes an answer to a reply under the owner's own post is proof T4; live standalone mentions and chunked video upload. Not built: a quote (X removed it from its API). Not said by X's price list: whether the name of a reply's writer is charged as a person read |
| J | built | 0.85.0 (DEC-084): connector `linkedin-api` for a personal profile (words, article share, 1-9 pictures, or one MP4 video up to 200 MB; 60-day token reminder). 0.86.0 (DEC-085): connector `pinterest-api` (client-credentials token, board pin with JPEG/PNG, 90-day analytics). 0.91.0 (DEC-090): video pin with cover image. 0.97.0 (DEC-097): multi-image carousel pins (2-5 JPEG/PNG images via `multiple_image_base64`). Single access mode per account kept by owner decision (DEC-094) | everything: needs the owner's LinkedIn app tied to a LinkedIn Page, and the owner's Pinterest app on a business account with two-factor authentication (Standard access for public pins); live video pins and multi-image carousel pins |

T2 and T3 from the documentation (Meta's pages read on 2026-11-27; nothing tried with a real app):
- T2. One general rule, on the page about app modes: "Any data generated while an app is in Development mode, such as test posts, can only be seen by role users. However, that data will be visible to non-role users once the app is switched to Live mode." The Pages, Threads and Instagram pages do not repeat or contradict it. An app used only by people who have a role on it needs Standard Access and no App Review. Going live asks for an app icon, a privacy policy address and a data deletion address; whether it also asks for business verification is said differently on two pages. So the Page guide in the application ends with "Go live", and the real answer is still the owner's first post seen from another account.
- T3. Facebook Page: a Page access token taken from `me/accounts` with a long-lived token of the person "do not have an expiration date"; the application takes that token pasted, like a bot token. Instagram (Instagram Login): the app dashboard has "Generate token" that gives a 60-day token, refreshed with `GET graph.instagram.com/refresh_access_token` and no app secret. Threads: the documentation names only the Graph API Explorer "while you are testing" and an exchange that needs the app secret; Meta's sample app says Threads accepts no `localhost` redirect and only HTTPS. A loopback sign-in is therefore out for Threads, and where a long-lived Threads token comes from for one owner has to be seen in the dashboard.
- Instagram's limit of API posts in 24 hours is written as 100 in one place and 50 in two others.

Built differently from the text above, and why:
- Queue slots are a channel setting (`postingSlots`), not a table: a slot is only how a time is chosen, and nothing refers to a slot.
- Keeping the Mac awake starts 12 hours before a due item on mains power (15 minutes on battery), not "a few minutes": a Mac that fell asleep an hour before cannot be woken.
- An API channel belongs to an account of its own kind (a bot), connected with a key the owner pastes; there is no "Connect with the platform's API" step inside Add a channel.
- Phase F was built on Meta's documentation before proof T2, as phase E was before T1: the answer to T2 changes what the owner does in Meta's dashboard (the last step of the guide), not the connector. It is one account per Page with a pasted token, checked against the Page's address.
- Phase G (0.82.0) was built on Meta's documentation as E and F were. What the documentation leaves open is handled, not assumed: the shape of a refusal is read both ways (the Graph's `error.message` and the token calls' `error_message` with `error_type`), a container is asked for its state before it is published instead of waiting 30 seconds blindly, a token Threads says nothing about is kept as it is. The token refresh job of phase D came with it (`src/core/channels/key-renewal.ts`); it writes no Inbox item, the account's own sign-in check says when a token ended.
- From phase D, not built yet because nothing needs it: a job that polls every confirmed post for comments (Telegram receives comments as updates, Reddit through its inbox) and a token refresh job (a bot token does not expire). Phase F did not need them either: the Page's last 25 posts are read with their comments at every reading, and a Page token does not end. They come with the first connector whose token ends (G or H: 60 days).
- Facebook's own schedule (0.79.0, DEC-077) is not a state of a send. A post kept by Facebook is a row of `platform_schedules` (`src/core/pipeline/own-schedule.ts`); the send is recorded when Facebook has published it. A post is handed over when its time is a quarter of an hour or more ahead (and at most 30 days: Meta's guide says 30, its reference says 75); anything nearer goes out from this application as before. An edit, another time, a deletion, a paused channel or paused automation takes the kept post back first. Two things Meta's pages do not say are handled, not assumed: a published post that got another number is found on the page by its words; a kept post Facebook will not delete is said on the card and blocks a second send.
- A video to a Page (0.89.0, DEC-088; Meta's pages read again 2026-11-28, Graph API v27.0): one request `POST graph.facebook.com/v27.0/{page-id}/videos` with the Page's token, the file as `source` and the words as `description` (the overview calls `graph-video.facebook.com` deprecated; the reference documents this form). The answer names the video, and no documentation page leads from it to the post, so the post is taken from `/{page-id}/feed` by its words and time, as for a lost answer. A post with a video and a time goes out from the application (it is not given to Facebook's schedule). The resumable upload (`/{app-id}/uploads`) needs a person's token and is not used.
- Views of a Page post are `post_media_view` (lifetime) from `/{post-id}/insights`: the metric Meta gives in place of `post_impressions`. Facebook gives it only with the permission `read_insights` and to a Page with 100 or more likes; without it reactions and comments are still read.

## 7. What does not change

- Reddit stays on the account's browser session; no Reddit API app is registered.
- Automatic replies stay limited to "thanks" and "faq" in auto mode (`mode-rules.ts:22-30`); this plan adds no new automatic text.
- The content mix stays drafts-only (DEC-033).
- No community-rule reader, block or warning is added (DEC-050).
- No new libraries without approval; the API calls use the platform's HTTP endpoints directly.

## 8. Risks

| Risk | Answer |
|---|---|
| Meta posts from a Development-mode app are invisible to others | T2 before phase F; the app is switched to Live, which needs no App Review for role users |
| A token expires unnoticed and scheduled posts fail | Refresh job with an Inbox item well ahead; a send with a dead token fails before the call, it is never "unknown" |
| A send by the AI browser at night goes wrong with nobody watching | The same guards as a pressed send; the result is unknown and blocks a retry until settled; the run's steps are kept (DEC-051) |
| The Mac is asleep at the due time | Phase B; Facebook's native schedule; the calendar marks posts that need the Mac awake |
| Platform API changes (three Graph API versions in 2026, X pricing changed twice) | The version is pinned per connector; a contract test per endpoint used; a failure names the endpoint |
| Reddit closes the session path too | Out of this plan's control; the AI browser remains |
| X refuses replies under own posts | T4 first; replies on X then stay with the AI browser |

## 9. Sources

- Telegram: core.telegram.org/bots/api, /bots/api-changelog, /bots/faq, /method/messages.sendMessage, /method/messages.getMessagesViews
- Meta: developers.facebook.com/docs/instagram-platform/content-publishing, /instagram-platform/comment-moderation, /instagram-platform/app-review, /pages-api/posts, /pages-api/comments-mentions, /video-api/guides/publishing, /threads/posts, /threads/retrieve-and-manage-replies, /threads/get-started/long-lived-tokens, /development/build-and-test/app-modes, /graph-api/overview/access-levels, /graph-api/changelog/version19.0
- X: docs.x.com/x-api/getting-started/pricing, /x-api/posts/create-post, /x-api/fundamentals/rate-limits, /changelog, /developer-guidelines
- LinkedIn: learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin, /linkedin/marketing/community-management/community-management-overview, /linkedin/marketing/community-management/shares/comments-api, /linkedin/shared/authentication/programmatic-refresh-tokens
- Pinterest: developers.pinterest.com/docs/key-concepts/access-tiers, /docs/reference/rate-limits, github.com/pinterest/api-description (v5 OpenAPI)
- Reddit (secondary only): techrepublic.com/article/news-reddit-rss-public-api-shutdown, ppc.land/reddit-to-halt-public-data-api-access-in-march-2027-as-14-000-apps-register
- Reference for endpoints and scopes: github.com/gitroomhq/postiz-app, `libraries/nestjs-libraries/src/integrations/social/*.provider.ts`
