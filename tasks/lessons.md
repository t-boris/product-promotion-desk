# Lessons

## 2026-11-08: Entity scope and menu structure are requirements

**What happened.** I built accounts, the Channels screen and the Results screen as global lists shared by all products, following the entity table in SRC-001 section 1 literally (one account may serve several products). The owner works product-first: the product determines which channels exist, enabling a channel and its login are per product and per platform, results are per product, and the AI should help create a new channel. The owner noticed it while looking at the menus, after the implementation was already written.

**Rules for myself.**

1. Before building a data model or navigation for an entity, decide with the owner whether it is global or per product (and per what else). Where the spec offers a loose relation ("may be used by several products"), ask which default the owner wants before building the screens around it.
2. Treat the menu structure as a requirement. Check the list of screens against how the owner talks about the work, not only against the spec's screen table.
3. A spec sentence such as "can be proposed by the AI" or "may create a profile" is a feature, not an extension point. Check that it exists end to end (API and screen) before calling a work item done; never leave it as a known gap in a worker report.
4. In every walkthrough, tick each step of the spec scenarios (SRC-001 sections 2-5) against something visible in the UI.
