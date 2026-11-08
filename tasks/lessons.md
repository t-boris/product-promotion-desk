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
