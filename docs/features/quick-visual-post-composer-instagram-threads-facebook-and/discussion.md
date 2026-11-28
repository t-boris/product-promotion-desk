# Discussion — Quick visual post composer (Instagram / Threads / Facebook) and a more colourful UI

### Answer to Q-001 · 2026-11-21

Как далеко идти с «больше цвета»: только в композере быстрых постов, во всём приложении или только в виде цветов площадок?

Создай систему тем, themes. Должны быть разные themes. Не просто темные и светлые, а интересные темные, интересные светлые. Бэкграунд должен быть анимирован тоже, как вариант, если захочется. Ну, в общем, главное сделать это более красивым, конечно.

### Answer to Q-002 · 2026-11-21

Откуда берётся «захватывающая» картинка для быстрого поста?

C. Оба пути: по умолчанию карточка-шаблон, плюс кнопки «AI-иллюстрация» и «свой файл».

### Answer to Q-003 · 2026-11-21

Как владелец выбирает тип поста: явным переключателем или тип выводится из выбранного канала?

B. Тип определяется автоматически по выбранному каналу (Instagram/Threads/Facebook → быстрый пост).

### Answer to Q-004 · 2026-11-21

Насколько AI должен делать быстрый пост сам: одним действием из короткого описания или только по запросу в каждом поле?

B. Отдельные AI-кнопки для подписи и для картинки, как в существующих полях.

### Boris Tsekinovsky · 2026-11-21

Главное тут еще не забывать, что AI должен выступать в роли, так сказать, анализатора. Какие темы, например, интересуют сейчас людей, то есть рейтинги, тренды, он должен определять тренды. Потом, кроме этого, он должен быть маркетологом, то есть абсолютным идеальным маркетологом, который рассматривает все тексты, подписи не просто так, потому что у нас есть общая цель, которую он видит изначально для этого продукта.

### AI · 2026-11-21

Принято: AI в композере работает не просто как «писатель», а в двух ролях: **аналитик трендов** и **маркетолог**, который видит общую цель продукта.

**Что я фиксирую (ваше решение):**
- Аналитик: подсказывает, какие темы сейчас интересуют людей (рейтинги, тренды), и предлагает угол поста.
- Маркетолог: оценивает подпись и картинку не сами по себе, а относительно цели продукта.

**Что пока неясно (это мои вопросы, не факты):**
1. **Откуда берутся тренды?** Если у AI нет доступа в сеть, он будет опираться только на свои знания, которые могут устареть. Варианты: (A) только знания модели с честной пометкой «может быть неактуально»; (B) поиск через браузер AI (см. DEC-035), что медленнее, но свежее; (C) владелец сам вводит тему или ссылку на тренд. Я рекомендую A на старте и B позже.
2. **Где задаётся «общая цель продукта»?** Есть ли для неё поле в карточке продукта или она берётся из одобренных знаний? Если поля нет, его нужно добавить.
3. **Когда AI даёт анализ?** Это отдельная кнопка «Идеи и тренды» перед подписью или он встроен в существующие AI-кнопки подписи и картинки? Решение DEC-039 оставляет кнопки раздельными, поэтому я предлагаю не добавлять новую.
4. **Открытый вопрос Q-005:** что делать, если в одном посте выбраны каналы разных типов, например Reddit и Instagram.

Я записал решение о ролях AI. Детали источника трендов оставляю открытыми.

### Answer to Q-005 · 2026-11-21

Что делать, если в одном посте выбраны каналы разных типов — например, Reddit и Instagram одновременно?

A. Нельзя смешивать: каналы картинка+подпись и «статейные» каналы выбираются раздельно; выбор одного типа блокирует другой.

### Answer to Q-006 · 2026-11-21

Откуда AI-аналитик берёт тренды и интересы людей?

B. Поиск через браузер AI (DEC-035) по запросу владельца.

### Answer to Q-007 · 2026-11-21

Где задаётся «общая цель продукта», по которой маркетолог оценивает подпись и картинку?

A. Брать цель из одобренных знаний о продукте, без нового поля.

### AI updated the requirements · 2026-11-21

DEC-036, DEC-037, DEC-038, DEC-039, DEC-040, DEC-041, DEC-042, DEC-043 written into the overview.

### AI updated the requirements · 2026-11-21

DEC-044 written into REQ-002, the overview.

### AI updated the requirements · 2026-11-21

DEC-045 written into REQ-002, REQ-003.

### AI updated the requirements · 2026-11-21

DEC-046 written into REQ-001, REQ-002, REQ-003.

### AI updated the requirements · 2026-11-21

DEC-047 written into REQ-005, the overview.

### Agent · 2026-11-21

Implementation review of 0.24.0 (two independent read-only reviews of the code against REQ-001..003, REQ-006 and DEC-038..048, plus a bug hunt on the AI help, the read-only trend search, the composer and the draft core). No criterion was found unmet; 34 of 54 were met on tests or plain reading, 17 partly, 3 could not be told because they are real-site sends. Fixed after the review: a card headline over the stored limit was drawn and added to the library before the core refused it (the field now stops at 140 and Save is blocked with a reason); card breaks and cuts could split an emoji sequence; group 'Adapt with AI' left the old card on a saved card post (it is now offered for saving and drawn again); the review screens enabled Save and Approve for a card with its headline cleared (they now follow the composer's own reason); 'Also post to…' classified an old article in a Facebook channel as a picture post; the preview listed a platform twice; a caption without spaces made an unbounded label. Contradictions in the records, for the owner: (1) REQ-002 and REQ-006 say the approval flow and the rest of the pipeline stay unchanged, while REQ-006's own text and criterion 6 require a quick post to be refused at Approve, which changes review.ts, gate.ts and the group view; DEC-048 reads 'picture sending' to include the fit judgement. (2) REQ-001 and DEC-046 say the title is 'not required and stored empty', but the core refuses any title on a quick post. (3) REQ-002 says 'a normal draft per ticked channel'; several channels make a post-group wrapper with one version per channel (DEC-032). (4) tasks/todo.md said 'REQ-006 stays draft: approval is the owner's'; REQ-006 was approved by someone else during the work and is left as found. Not covered by an automated test: the renderer has no component test runner, so the screens (disabled channels with their reason, the counter, the preview switch, the card being drawn on save) rest on reading and on the walk-through of the installed app.

### Agent · 2026-11-21

Walk-through of the installed 0.24.0 (2026-11-20), in a MarkView browser tab on an own instance (own data folder, example.com demo data, accounts not signed in, automation paused, nothing sent). Seen: Instagram opens the quick composer (caption, counter 'n / 2,200', card with headline, style, colour, shape, live 'Preview as' sketch); ticking Reddit disables Facebook, Instagram and Threads with 'A picture post and an article cannot go together…', ticking a picture channel disables Reddit with the mirror reason, clearing every tick enables all four and shows the article form, and the caption and the owner's headline survive switching kind and back; the headline follows the first line until it is typed over, then stays; a 200-character headline is stopped at 140; Save for 2 channels made a group of two quick drafts (Instagram, Threads) with title empty, markup plain, the card parameters stored, and exactly one 1080x1350 PNG of origin 'card' in the library; reopening the saved post restored its card, clearing the headline there disabled Save and both Approve buttons with 'Write a headline for the card…', and changing the colour and saving drew a new PNG that the draft then referenced; 'Own picture' shows Make a picture / Choose a file / From the library, hides the card controls, and saving with a library picture stored card null and added no PNG; Approve on the caption went through the existing text check and was held ('must be fixed', nothing approved); Settings shows Follow macOS and six themes plus the Animated background switch, each theme applied with the accent of the design table and was stored, the switch toggled the layer, and I left it off. Not proven: the real Instagram, Threads and Facebook post forms, a real AI engine and the AI browser trend search (the buttons and texts were seen, none was pressed), the window material and first paint inside Electron under each theme, reduced motion on this Mac. Two observations: the browser tool's simulated keystrokes did not register in this page's text fields (the same in an unrelated field), while real key input through the Electron window's debug port and native input events did; and during the walk the stored theme was changed to Midnight with the animated background on by something other than my steps, which I did not investigate.

### Answer to Q-008 · 2026-11-28

Should the core, not only the screens, refuse a quick post on a channel that is not Instagram, Threads or Facebook (and a group that mixes t

Option A: Core refuses postType 'quick' on channels outside QUICK_PLATFORMS (Instagram, Threads, Facebook) and refuses mixed quick/article groups (existing article drafts on Facebook/Threads/Instagram remain allowed), and drafts.check checks card.headline under the same rules as the caption.
