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
