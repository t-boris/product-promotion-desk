# Lessons

## 2026-11-08: Entity scope and menu structure are requirements

**What happened.** I built accounts, the Channels screen and the Results screen as global lists shared by all products, following the entity table in SRC-001 section 1 literally (one account may serve several products). The owner works product-first: the product determines which channels exist, enabling a channel and its login are per product and per platform, results are per product, and the AI should help create a new channel. The owner noticed it while looking at the menus, after the implementation was already written.

**Rules for myself.**

1. Before building a data model or navigation for an entity, decide with the owner whether it is global or per product (and per what else). Where the spec offers a loose relation ("may be used by several products"), ask which default the owner wants before building the screens around it.
2. Treat the menu structure as a requirement. Check the list of screens against how the owner talks about the work, not only against the spec's screen table.
3. A spec sentence such as "can be proposed by the AI" or "may create a profile" is a feature, not an extension point. Check that it exists end to end (API and screen) before calling a work item done; never leave it as a known gap in a worker report.
4. In every walkthrough, tick each step of the spec scenarios (SRC-001 sections 2-5) against something visible in the UI.

## 2026-11-08 (later): an account is a voice, not only a login

**What happened.** After the product-scoping change the owner added that one product may connect to the same channel with several logins, each writing in a different role (astrologer, developer, ...). I had modelled an account as a credential only, with no role, and nothing stopped two logins of one product from answering the same comment or each other, which platforms treat as manipulation.

**Rules for myself.**

5. When a model has an entity that stands for a person on a platform, ask early what distinguishes several of them (voice, topics) and what must never happen between them (answering each other, speaking in the same thread). Put the guard in the SendGate, not only in drafting.
6. When something an AI produces is shown to the owner as ready to use (a channel address, a site profile), check it against reality before it reaches the button: a real address the connector can parse, selectors that match something on the page that was read. A valid shape is not a correct answer.
7. A label that names a state must follow the state. In a walkthrough, after each action (save, discard, send, connect) re-read every badge and note on the screen, not only the message the action produced: the saved site profile kept the badge "Draft, not saved" next to "Saved as version 1".

## 2026-11-08 (later): bootstrapping rules from the owner (DEC-011)

**What happened.** While I was waiting for CI on a follow-up PR the owner said that during bootstrapping everything goes straight to main without branches or CI waiting, that the installer matters most, and that every change must bump the version.

**Rules for myself.**

8. Follow the owner's latest process instruction over the earlier goal text when they conflict, and record it (decision, README, memory) so the next session does not undo it.
9. Every change that reaches main bumps the version (patch by default), gets a tag vX.Y.Z and is installed with `npm run deploy:local`; check the installed version against package.json. Do not leave main and the installed build on different numbers.
10. Speed does not drop the safety rules of the product: nothing is published without explicit in-app approval, and the app never handles passwords.

## 2026-11-08 (later): one UI standard for controls

**What happened.** The owner pointed at two "Use this engine" buttons of different sizes in Settings and asked for one button standard and a more standardized UI. Cause: `.btn` had no fixed height, no `nowrap` and could shrink in a flex row; the primary variant was bolder (wider) and wrapped first; buttons (35 px) and inputs (37 px) disagreed.

**Rules for myself.**

11. Buttons, inputs and selects take their size from the tokens in `styles.css` (`--control-h`, `--control-radius`, `--control-pad-x`, `--control-min-w`); variants change colour only, never size or weight. A button never shrinks or wraps: the text next to it gives way. Font sizes come from the `--fs-*` scale, not from pixel values.
12. Check a UI standard by measuring every control on every route (heights, wrapped labels, horizontal scroll), not by looking at one screenshot.
13. The same action keeps the same label in every state (disable it, show the state elsewhere) so its size does not change.

## 2026-11-08 (later): window scroll, narrow columns, specificity, icon

**What happened.** The owner sent a screenshot of the installed app: the whole window scrolled (the sidebar slid under the window buttons), the product card was squeezed to "Natal Mysti c", and the Dock showed the default Electron icon.

**Rules for myself.**

14. The shell is exactly as tall as the window: the grid row is `minmax(0, 1fr)` and every flex or grid child that holds a scroller has `min-height: 0`. Test it by making the window short (set the html height), not in one tall viewport: a layout that fits a 930 px browser tab hid this bug.
15. A page rule that restyles a shared class needs more specificity (`.list-row.account-row`), because the bundle does not guarantee that a page stylesheet comes after `styles.css`. Check the computed style in the running app, not the source order.
16. Do not put `overflow-wrap: anywhere` on a flex item beside content that does not shrink: it collapses to one letter. Narrow columns get a stacked layout instead; a nested two-column layout inside a column is too tight.
17. The app has its own icon: `scripts/make-icon.py` draws `build/icon.png` and `build/icon.icns`, `electron-builder.yml` sets `mac.icon`. Check the bundle for `Contents/Resources/icon.icns` after a build.
18. The standard sweep for any UI change: every route, with a short window, measuring button heights, wrapped labels, elements outside the page edge and window scroll.

## 2026-11-08 (later): "Save goal does nothing"

**What happened.** The owner pressed "Save goal" and saw nothing, and did not understand what the goal is for. The save worked (checked through the API), but the only sign was a small grey "Saved" word beside the button, and the screen never said what the goal does.

**Rules for myself.**

19. Every save shows a result the owner cannot miss: a visible confirmation with a way forward ("Show on Results"), the button disabled while there is nothing to save, and a reason when it cannot be pressed. A quiet label next to the button is not feedback.
20. Every field or tab states its purpose in plain words, including what it does not do in this version (here: the goal is a note, it does not steer the AI and does not count conversions). Say it on the screen, not only in the specification.
21. "Nothing happens" is a report about what the owner saw, not about the data: test it in the running app from the owner's point of view (what is visible after the click), not only with the API.

## 2026-11-08 (later): "Can there not be several goals?"

**What happened.** The owner asked why a product can have only one promotion goal. The specification already said "promotion goals" in the plural; I had stored a single object because it was the shortest thing to build.

**Rules for myself.**

22. When the specification or the domain counts something in the plural, model a list from the start. A singular field is a decision the owner never made; if I choose it for speed, I say so and ask.
23. When one card is replaced by another (a draft becomes a stored item), any state the owner must see, such as "saved", lives in the parent. Otherwise it disappears at the moment it matters. Run the add flow in the app, not only the edit flow.
24. A change of the stored shape is tested twice: on a row in the old shape, and on a copy of the owner's real database, before it is deployed. Back the real database up first.

## 2026-11-08 (later): crooked "Add an account" form

**What happened.** The owner sent a screenshot of the Add an account form: the labels of fields in one row stood at different heights and the fields had different widths. Cause: fields in a `.row` that centres its items, where one field has a hint under its input and the next has none.

**Rules for myself.**

25. Fields side by side go in `.form-row` (grid, equal columns, labels aligned at the top), never in the button `.row`. After any form change, measure it: in every group of fields that share a row, the label tops must be equal. This is part of the sweep (lesson 18).

## 2026-11-08 (later): more channels than Reddit

**What happened.** The owner asked for Instagram, Facebook, TikTok and "any channel", with the AI deciding what to do in each.

**Rules for myself.**

26. When the owner asks for "any" of something, first find the mechanism that already covers "any" (here the universal connector and site profiles) and extend it with data, not with code per case. Then say plainly what the new thing cannot do (here: no media upload, platforms that restrict automation, nothing verified without live accounts) and let the owner choose the scope.
27. An AI feature is checked once with the real engine, not only with the scripted one: the scripted engine proves the parser, only a real answer proves the prompt. The real run showed the plan follows the language of the product data.
28. When a catalog gets new entries, tests that assert the whole list are updated for what they meant (prepared first, universal last), not just for the new values.

## 2026-11-08 (later): passwords and mail

**What happened.** The owner asked for stored passwords, automatic sign-in, e-mail addresses for new accounts and one inbox for all mail. That reversed a recorded principle (DEC-008, REQ-010: no credentials are stored) and asked for things a platform treats as abuse (creating mailboxes and accounts automatically).

**Rules for myself.**

29. When the owner reverses a recorded principle, first find every place that states it (spec records, on-screen text, code comments) and write one decision that replaces it, naming what stays. Here the old rule was also written on two screens and in a ticked criterion.
30. A feature that handles secrets is proven by looking for the secret where it must not be (database, log, files, API results, error messages), not by reading the code. The check searches the whole data folder for the dummy password.
31. Say plainly, before building, what will not be built and why (automatic sign-up needs getting around CAPTCHA and phone checks), and offer what works instead (assisted sign-up, aliases, an address on the owner's own domain).
32. A script that carries a secret never lets its error out: the page operation catches everything and reports in fixed words.
33. A test page that cannot be reached over https gets the https check lifted in the test server only, never in the shipped script.


## 2026-11-08 (later): accounts as a library, and a window that does not grow

**What happened.** The owner asked how to make an account when there is none, and said accounts, roles and mailboxes are separate things used across projects: create an account, then link it to channels. I had modelled an account as owned by one product (DEC-009), so the screen could not even say "an account without a product". Then, mid-turn, the owner wrote that widening the window did not widen the page and the left menu could not be collapsed ("дико раздражает").

**Rules for myself.**

34. When the owner describes things "created separately, then linked", model a library and links, not nested ownership. Ask at the start of a feature whether the thing belongs to one parent or is shared, and keep the parent only as information ("made for") when in doubt.
35. Changing who owns something means finding every rule that was attached to the owner (here: the same-role rule at account creation, the consent box, the product-scoped account list, the attention link) and moving each to the place where the new relation is made (here: connecting a channel).
36. Moving state out of a component that renders before its data arrives: derive it from the current props at render time, never copy props into `useState` at mount (the mailbox choice was frozen empty and "Propose" stayed disabled; found only by driving the real screen).
37. A fixed `max-width` on the page and a fixed-width menu are decisions the owner feels at once. The sweep now also checks that the page width follows the window and that the menu can be hidden, with the menu open and closed.
38. A one-off page-wide control (hide the menu) needs its state kept in browser storage behind try/catch, and the renderer file that holds the logic stays free of browser globals so the node tests can import it.
39. When the owner adds a request in the middle of a task, record it at once as a draft requirement with the open question (here: how icons are made), do the small fix that was clearly asked for now, and do not start the big new feature before the choice is made.

## 2026-11-08 (later): the Accounts screen was not understandable

**What happened.** The owner looked at the finished Accounts screen (screenshot) and said the UI is very badly made: it is not clear how to add an account, a password or a role, and an account screen must not mention channels at all (an account is used by channels, but that is shown where a channel is connected). I had stacked every control of every account into one long scroll, in no order, and kept "used by <product> (n channels)" and a multi-product warning on the account.

**Rules for myself.**

40. A new screen is shown to the owner as a layout (a small mock) before it is built, with the question "can you do X without reading anything?" answered for each task the screen exists for (here: add an account, give it an address, save a password, give it a role, sign in).
41. A screen about one kind of thing shows only that thing. Links to other kinds (channels, products) belong on the screen of the other kind, where the link is made. Cross-references on a library screen are noise even when they are true.
42. Order the controls of an entity in the order the owner does things (who it is, address, password, sign in) and say what comes next ("Next: give it an e-mail address") instead of showing every button at once. Rare controls (take control, remove) go behind a fold.
43. Long explanations are not a substitute for layout: one sentence next to the control it explains, never a paragraph above the list.
44. A feature that failed in real use is a finding even when it was listed as not verified: the owner pressed "Sign in with saved password" on Reddit and got "form not found". Diagnose it with the real page before claiming the sign-in works on any platform.
45. A button inside a form submits it unless it says `type="button"`. The shared Button now defaults to type button and a submit says so. Every new form is tested by pressing each of its buttons once (not only the submit), because "Propose" and "Cancel" created an account half-way through filling in the form.

## 2026-11-08 (later): "what CAPTCHA?"

**What happened.** The owner saw "CAPTCHA to solve" on the account and asked what captcha. The label came from one "Check sign-in" at 17:31 (log: "The site asks for a human check") and was never refreshed; the screen shows it as if it were the present state, without saying what was seen or when. A clean browser session in the scratch app reads Reddit as "Not signed in", with no captcha, so the label is not Reddit always demanding one.

**Rules for myself.**

46. A remembered status is shown with what was seen and when it was seen ("last checked 17:31: a CAPTCHA frame on the page"), and with the one button that refreshes it. A bare label reads as a current fact and the owner cannot tell a real wall from an old one.
47. A detector that can fire on something the owner cannot see (a hidden CAPTCHA frame, a page text) must say which signal fired; otherwise a false positive cannot be told from a real wall.

48. A state that lives in a window the owner may not see (the account browser) must be shown in the screen the owner is looking at, with a way to bring the window forward. "In your hands" while the window is hidden behind the main window reads as "broken". Look at the real windows (System Events) instead of assuming.
49. Never guess why a real site fails: run the app's own scripts against the real page in real Chromium (a dry run that fills but sends nothing). Two "mysteries" (a fake CAPTCHA and "form not found") were a hidden frame and a three-second delay.
50. A script written into a template string must run in a test: a regex `/\/\//` typed with single backslashes inside the template becomes `//`, a comment, and silently breaks the whole script (a test caught it). Keep the fake-DOM test for every page script.
51. A message that sends the owner to a control must name a control that works there: the error pointed to "Give control back" under More, which refused while the window was open.
52. A form never chooses for the owner what the owner must know: the Platform field silently took the first platform (Reddit), so a "Facebook" account was created on Reddit and the whole screen then spoke about Reddit. Required choices start empty, the submit stays off until they are made, and a name that contradicts the choice is flagged.
53. Before telling the owner that a flow works on a platform, run it on that platform. The sign-in check was only ever run on Reddit; on any other platform it answers "no site profile", so such an account can never become "Signed in". Test each platform of the list, not the one in front of me.

## 2026-11-08 (later): "I log in once, the cookies stay, you check that you are in"

**What happened.** I asked the owner which mechanism should tell that a Facebook account is signed in (cookie check, an "I am signed in" button, both). The owner answered that this is obvious: the internal browser keeps the cookies, the app opens the known URL, asks only for what it cannot know, and then checks by itself that it got in. The question offered mechanisms to someone who had already described the behaviour; the real gap (the check needed a site profile that only exists after a channel) was mine, not a product choice.

**Rules for myself.**

54. When the owner has described the behaviour they expect, build that behaviour; do not turn a gap in my own implementation into a menu of mechanisms. Ask only when two readings of their words lead to different behaviour for them.
55. A check that must work before anything is configured (an account with no channel yet) cannot depend on configuration that is made later (a site profile). Look at what the check really needs (a page and a way to read it) and build it from that.
56. A "signed in" answer must be earned by a signal that a signed-out visitor does not show; run the real detection loop signed out on every platform to see that it says "signed out" for each, and say in the report that the "signed in" side still needs the owner's real login.
