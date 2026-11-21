import { describe, expect, it } from 'vitest'
import { changesProfile, composePageOf, describeHeld, destinationMatches, fieldValueScript, formTextScript, isAttachControl, opensFileChooser, usesComposerDialog, looksLikeProgress, looksLikeSubmit, neverClicked, normalizeText, onComposePage, parseHeldText, platformWarning, replyTarget, sameContent } from './post-submit'

const HOSTS = ['reddit.com']
const COMMENT = 'https://www.reddit.com/r/astrology/comments/abc123/my_chart/def456/'
const CHANNEL = 'https://www.reddit.com/r/astrology'

describe('where the compose page must be', () => {
  it('accepts the thread of the comment for a reply, whatever follows the thread in the address, and either host form', () => {
    expect(destinationMatches('https://www.reddit.com/r/astrology/comments/abc123/my_chart/', COMMENT, 'reply', HOSTS)).toBe(true)
    expect(destinationMatches('https://old.reddit.com/r/Astrology/comments/abc123/my_chart/def456/?context=3', COMMENT, 'reply', HOSTS)).toBe(true)
    expect(destinationMatches('https://reddit.com/r/astrology/comments/abc123/', COMMENT, 'reply', HOSTS)).toBe(true)
  })

  it('refuses another thread, another community, another host and a page that is not an address', () => {
    expect(destinationMatches('https://www.reddit.com/r/astrology/comments/zzz999/other/', COMMENT, 'reply', HOSTS)).toBe(false)
    expect(destinationMatches('https://www.reddit.com/r/tarot/comments/abc123/my_chart/', COMMENT, 'reply', HOSTS)).toBe(false)
    expect(destinationMatches('https://www.reddit.com/r/astrology', COMMENT, 'reply', HOSTS)).toBe(false)
    expect(destinationMatches('https://evil.example/r/astrology/comments/abc123/', COMMENT, 'reply', HOSTS)).toBe(false)
    expect(destinationMatches('https://reddit.com.evil.example/r/astrology/comments/abc123/', COMMENT, 'reply', HOSTS)).toBe(false)
    expect(destinationMatches('about:blank', COMMENT, 'reply', HOSTS)).toBe(false)
    expect(destinationMatches('not an address', COMMENT, 'reply', HOSTS)).toBe(false)
    expect(destinationMatches('https://www.reddit.com/r/astrology/comments/abc123/', 'not an address', 'reply', HOSTS)).toBe(false)
  })

  it('accepts the channel and its submit page for a post, and no other channel', () => {
    expect(destinationMatches('https://www.reddit.com/r/astrology', CHANNEL, 'post', HOSTS)).toBe(true)
    expect(destinationMatches('https://www.reddit.com/r/astrology/submit?type=TEXT', CHANNEL, 'post', HOSTS)).toBe(true)
    expect(destinationMatches('https://old.reddit.com/r/astrology/submit', CHANNEL, 'post', HOSTS)).toBe(true)
    expect(destinationMatches('https://www.reddit.com/r/tarot/submit', CHANNEL, 'post', HOSTS)).toBe(false)
    expect(destinationMatches('https://www.reddit.com/submit', CHANNEL, 'post', HOSTS)).toBe(false)
  })

  it('keeps the query of the destination: a site that names the thread by a parameter', () => {
    const item = 'https://news.ycombinator.com/item?id=4242'
    expect(destinationMatches('https://news.ycombinator.com/item?id=4242', item, 'reply', ['ycombinator.com'])).toBe(true)
    expect(destinationMatches('https://news.ycombinator.com/item?id=4243', item, 'reply', ['ycombinator.com'])).toBe(false)
    expect(destinationMatches('https://news.ycombinator.com/item', item, 'reply', ['ycombinator.com'])).toBe(false)
  })

  it('refuses a destination that is itself not on the platform: the fence is configured wrongly, so nothing matches', () => {
    expect(destinationMatches('https://www.reddit.com/r/astrology', 'https://other.example/r/astrology', 'post', HOSTS)).toBe(false)
  })
})

describe('text as a person compares it', () => {
  it('ignores spacing, line breaks, non-breaking spaces and zero-width characters, and nothing else', () => {
    expect(sameContent('Thanks,\n\n  glad it helps.', 'Thanks, glad it helps.')).toBe(true)
    expect(sameContent(`Thanks,${String.fromCharCode(0xa0)}glad${String.fromCharCode(0x200b)} it helps.`, 'Thanks, glad it helps.')).toBe(true)
    expect(sameContent('Thanks, glad it helps', 'Thanks, glad it helps.')).toBe(false)
    expect(sameContent('Thanks, glad it helps. extra', 'Thanks, glad it helps.')).toBe(false)
    expect(sameContent('thanks, glad it helps.', 'Thanks, glad it helps.')).toBe(false)
    expect(sameContent(null, 'x')).toBe(false)
    expect(sameContent(42, '42')).toBe(false)
    expect(normalizeText('  a \t b\n')).toBe('a b')
  })
})

describe('reading a field back', () => {
  it('builds a read-only script for one label, and refuses anything that is not a label', () => {
    const script = fieldValueScript('e12')
    expect(script).toContain('data-ppd-ref="e12"')
    expect(script).toContain('ppd-field e12')
    expect(script).not.toMatch(/\.value\s*=|innerText\s*=|click\(|submit\(/)
    for (const bad of ['', 'e', '12', 'e12"]; alert(1);//', 'e1 e2', 'E1']) expect(() => fieldValueScript(bad)).toThrow()
  })
})

describe('what the site says that makes publishing unwise', () => {
  it.each([
    "You're doing that too much. Try again in 9 minutes.",
    'Too many requests',
    'You are being rate limited',
    'Slow down, please',
    'Your account has been suspended',
    'We noticed unusual activity on your account',
    'Please verify your identity'
  ])('is found in: %s', (alert) => {
    expect(platformWarning(['Saved.', alert])).toBe(alert)
  })

  it.each(['Your comment is awaiting approval', 'This field is required', 'Reply posted', 'Comment cannot be empty'])('is not found in an ordinary message: %s', (alert) => {
    expect(platformWarning([alert])).toBeNull()
  })

  it('is null for no messages', () => {
    expect(platformWarning([])).toBeNull()
  })
})

describe('reading what the form holds', () => {
  /** A page as far as the script looks at it: elements that answer `querySelectorAll`, and shadow roots that have their own. */
  interface Node {
    tag: string
    type?: string
    value?: string
    editable?: boolean
    text?: string
    ref?: string
    role?: string
    shadow?: Node[]
    /** The `type` attribute as written, when it differs from the `type` property a browser resolves from it. */
    attribute?: string
    name?: string
    /** The document of a same-origin frame; `blocked` is a frame of another origin: the browser lets a script in neither way. */
    frame?: Node[]
    blocked?: boolean
    /** An element with no box on the page (display: none): a browser answers `getClientRects()` with nothing for it. */
    hidden?: boolean
  }
  const pageOf = (nodes: Node[]) => {
    const toElement = (n: Node): unknown => ({
      tagName: n.tag.toUpperCase(),
      value: n.value,
      isContentEditable: n.editable === true,
      innerText: n.text,
      textContent: n.text,
      // The property, as a browser resolves it: an input without a type, or with one it does not know, is a text input.
      type: n.tag === 'input' ? (n.type ?? 'text') : undefined,
      name: n.name ?? '',
      id: '',
      getClientRects: () => (n.hidden === true ? [] : [{}]),
      getAttribute: (name: string) => (name === 'type' ? (n.attribute ?? n.type ?? null) : name === 'data-ppd-ref' ? (n.ref ?? null) : null),
      shadowRoot: n.shadow ? rootOf(n.shadow) : null,
      get contentDocument(): unknown {
        if (n.blocked) throw new Error('Blocked a frame from accessing a cross-origin frame.')
        return n.frame ? rootOf(n.frame) : null
      }
    })
    const matches = (n: Node): boolean => ['input', 'textarea'].includes(n.tag) || n.editable === true || n.role === 'textbox'
    const rootOf = (list: Node[]): unknown => ({
      querySelectorAll: (selector: string) => (selector === '*' ? list.map(toElement) : selector.startsWith('iframe') ? list.filter((n) => n.tag === 'iframe').map(toElement) : list.filter(matches).map(toElement))
    })
    return rootOf(nodes)
  }
  const readFull = (nodes: Node[]) => parseHeldText(new Function('document', `return ${formTextScript()}`)(pageOf(nodes)))
  const read = (nodes: Node[]) => readFull(nodes)?.map(({ ref, text }) => ({ ref, text })) ?? null

  it('is a read-only script', () => {
    const script = formTextScript()
    expect(script).toContain('ppd-form-text')
    expect(script).not.toMatch(/\.value\s*=[^=]|innerText\s*=[^=]|click\(|submit\(|dispatchEvent/)
  })

  it('answers the text-entry places that hold text, with their label when the AI could have been shown them, and none that are empty', () => {
    expect(read([{ tag: 'textarea', value: '', ref: 'e1' }, { tag: 'input', type: 'text', value: '   ' }])).toEqual([])
    expect(
      read([
        { tag: 'textarea', value: 'A comment', ref: 'e1' },
        { tag: 'input', type: 'text', value: 'A title', ref: 'e2' },
        { tag: 'input', value: 'no type attribute is a text input' },
        { tag: 'input', type: 'url', value: 'https://example.org/' },
        { tag: 'div', editable: true, text: 'typed in an editor', ref: 'e7' },
        { tag: 'div', role: 'textbox', editable: true, text: 'a textbox' }
      ])
    ).toEqual([
      { ref: 'e1', text: 'A comment' },
      { ref: 'e2', text: 'A title' },
      { ref: null, text: 'no type attribute is a text input' },
      { ref: null, text: 'https://example.org/' },
      { ref: 'e7', text: 'typed in an editor' },
      { ref: null, text: 'a textbox' }
    ])
  })

  it('does not count what is not text a person typed: blanks, zero-width characters, passwords, check boxes, hidden inputs, buttons, an element that is not editable', () => {
    expect(
      read([
        { tag: 'textarea', value: ' \n\t ' },
        { tag: 'textarea', value: '\u200b\u200c\u200d\u2060\ufeff' },
        { tag: 'input', type: 'password', value: 'secret' },
        { tag: 'input', type: 'checkbox', value: 'on' },
        { tag: 'input', type: 'hidden', value: 'token', name: 'uh' },
        { tag: 'input', type: 'hidden', value: 'abc123', name: 'thing_id' },
        { tag: 'input', type: 'submit', value: 'Post' },
        { tag: 'input', type: 'file', value: 'C:\\fakepath\\x.png' },
        { tag: 'div', editable: false, role: 'textbox', text: 'not editable' }
      ])
    ).toEqual([])
  })

  it('reads the type PROPERTY, as a browser resolves it, not the attribute: a type it does not know is a text box', () => {
    // <input type="comment"> is a text box to a browser; its attribute says something that is not in any list.
    expect(read([{ tag: 'input', attribute: 'comment', type: 'text', value: 'typed', ref: 'e5' }])).toEqual([{ ref: 'e5', text: 'typed' }])
    expect(read([{ tag: 'input', attribute: 'TEXT', type: 'text', value: 'typed' }])).toEqual([{ ref: null, text: 'typed' }])
    // And a type the browser knows to be something else is not one, whatever it is called by the page.
    expect(read([{ tag: 'input', attribute: 'text', type: 'checkbox', value: 'on' }])).toEqual([])
  })

  it('reads a hidden input that mirrors a body, a title or a link, and not the hidden inputs that hold tokens and ids', () => {
    expect(
      read([
        { tag: 'input', type: 'hidden', name: 'selftext', value: 'a draft mirrored by an editor' },
        { tag: 'input', type: 'hidden', name: 'title', value: 'a title' },
        { tag: 'input', type: 'hidden', name: 'modhash', value: 'zzz' },
        { tag: 'input', type: 'hidden', name: 'sr', value: 'astrology' }
      ])
    ).toEqual([
      { ref: null, text: 'a draft mirrored by an editor' },
      { ref: null, text: 'a title' }
    ])
  })

  it('does not count a captcha token or any textarea nobody can see: Reddit keeps a hidden g-recaptcha-response of two thousand characters on every thread', () => {
    const token = 'x'.repeat(2361)
    expect(
      read([
        { tag: 'textarea', value: token, name: 'g-recaptcha-response', hidden: true },
        { tag: 'textarea', value: token, name: 'h-captcha-response' },
        { tag: 'textarea', value: 'abc', name: 'csrf_token' },
        { tag: 'textarea', value: 'a leftover of an editor', name: 'innerTextArea', hidden: true },
        { tag: 'textarea', value: '', name: 'q' }
      ])
    ).toEqual([])
    // The same page with a person's text in the visible comment box: that is the one place that holds text.
    expect(
      read([
        { tag: 'textarea', value: token, name: 'g-recaptcha-response', hidden: true },
        { tag: 'textarea', value: 'my comment', name: 'innerTextArea', ref: 'e3' }
      ])
    ).toEqual([{ ref: 'e3', text: 'my comment' }])
  })

  it('still counts a hidden textarea that an editor mirrors its body, title or link into, because a form posts that one', () => {
    expect(read([{ tag: 'textarea', value: 'a draft mirrored', name: 'text', hidden: true }, { tag: 'textarea', value: 'a title', name: 'title', hidden: true }])).toEqual([
      { ref: null, text: 'a draft mirrored' },
      { ref: null, text: 'a title' }
    ])
  })

  it('says what holds the text and how long it is, and never the text', () => {
    const held = readFull([{ tag: 'textarea', value: 'a secret draft', name: 'innerTextArea' }, { tag: 'input', type: 'search', value: 'chart', name: 'q' }, { tag: 'div', editable: true, text: 'typed' }])
    expect(held?.map((h) => h.field)).toEqual(['textarea innerTextArea', 'input search q', 'div'])
    const said = describeHeld(held ?? [])
    expect(said).toBe('textarea innerTextArea, 14 characters; input search q, 5 characters; and 1 more')
    expect(said).not.toContain('secret')
  })

  it('walks into a frame of the same origin, and does not fail on one of another origin, which it cannot read', () => {
    expect(
      read([
        { tag: 'iframe', frame: [{ tag: 'textarea', value: 'in a frame', ref: 'e9' }] },
        { tag: 'iframe', blocked: true },
        { tag: 'iframe' },
        { tag: 'textarea', value: 'outside' }
      ])
    ).toEqual([
      { ref: null, text: 'outside' },
      { ref: 'e9', text: 'in a frame' }
    ])
    // A frame of another origin is not known to be empty and is not reported as holding text.
    expect(read([{ tag: 'iframe', blocked: true }])).toEqual([])
  })

  it('looks into shadow roots, where a site keeps its editors', () => {
    expect(read([{ tag: 'comment-composer', shadow: [{ tag: 'textarea', value: 'inside', ref: 'e3' }] }])).toEqual([{ ref: 'e3', text: 'inside' }])
  })

  it('keeps what it reads in bounds', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ tag: 'textarea', value: `text ${i}` }))
    expect(read(many)).toHaveLength(20)
    expect(read([{ tag: 'textarea', value: 'x'.repeat(50_000) }])?.[0]?.text).toHaveLength(20_000)
  })

  it('treats an answer that is not a list of entries as unreadable, and a label that is not one as none', () => {
    expect(parseHeldText(undefined)).toBeNull()
    expect(parseHeldText('text')).toBeNull()
    expect(parseHeldText([{ ref: 'e1' }])).toBeNull()
    expect(parseHeldText([null])).toBeNull()
    expect(parseHeldText([{ ref: 'e1; drop', text: 'a' }])).toEqual([{ ref: null, text: 'a', field: '' }])
    expect(parseHeldText([{ ref: null, text: 'a', field: 'textarea q'.repeat(20) }])?.[0]?.field).toHaveLength(60)
  })
})

describe('which control is named like one that publishes', () => {
  it.each(['Share', 'Share post', 'Поделиться', 'Post', 'Reply', 'Comment', 'Submit', 'Publish', 'Save', 'Send', 'post', 'COMMENT', 'Add comment', 'Add a comment', 'Post comment', 'Post reply', 'Submit post', 'Publish post', 'Save comment', 'Comment ›', 'Post the new comment', 'Опубликовать', 'Отправить', 'Ответить', 'Добавить комментарий', 'Оставить комментарий'])('is: %s', (name) => {
    expect(looksLikeSubmit(name)).toBe(true)
  })

  it.each(['', '  ', 'Delete', 'Delete comment', 'Report', 'Report comment', 'Cancel', 'Edit', 'Award', 'Comment as u/someone', 'Reply to everyone and notify all of them now', 'Log in', 'Sign up to post', 'Posts', 'Удалить', 'Пожаловаться', 'Отмена', 'Post (disabled)', 'Save to bookmarks and share it', 'Post the your new comment'])('is not: "%s"', (name) => {
    expect(looksLikeSubmit(name)).toBe(false)
  })
})

describe('which name is that of a control that does something else to the account', () => {
  it.each(['Join', 'Joined', 'Follow', 'Following', 'Following the rules', 'Unfollow', 'Vote', 'Upvote', 'Votes tab', 'Block user', 'Delete', 'Report', 'Log out', 'Sign out', 'Allow', 'Authorize app', 'Подписаться', 'Удалить'])('is: %s', (name) => {
    expect(neverClicked(name)).toBe(true)
  })

  // The word is looked for as a whole word: letters before it or after it make another word.
  it.each(['Devoted fans', 'Adjoining rooms', 'Rejoice', 'Banner', 'Bandwidth', 'Blockquote', 'Blockchain', 'Allowance', 'Reportage', 'Followers', 'Granted', 'Grants program', 'Unvoted', 'Removal', 'Flagship', 'Subscribers', 'Authorization code', 'Mutex', 'Expand comment'])('is not: "%s"', (name) => {
    expect(neverClicked(name)).toBe(false)
  })
})

describe('which name is about the account\'s own profile (DEC-035): a post mission never presses it, chooses it or gives it a file', () => {
  it.each([
    'Edit profile', 'Edit Profile', 'Edit your profile', 'Edit bio', 'Edit name', 'Change profile photo', 'Change Profile Photo', 'Add profile photo', 'Update profile picture', 'Upload profile picture', 'Profile photo',
    'Profile picture', 'New profile photo', 'Change your profile', 'Set a profile photo', 'Change cover photo', 'Cover photo', 'Avatar', 'Change avatar', 'Bio', 'Add bio', 'Add a bio', 'Username', 'User name',
    'Change username', 'Display name', 'Change display name', 'Phone number', 'Add phone number', 'Phone', 'Add your phone number', 'Change email', 'Update e-mail', 'Birthday', 'Gender', 'Pronouns', 'Password',
    'Change password', 'Personal information', 'Personal details', 'Settings', 'Account settings', 'Advanced settings', 'Profile settings',
    'Biografía', 'Biografia', 'Biografie', 'Biographie', 'Editar perfil', 'Editar tu perfil', 'Cambiar foto del perfil', 'Foto de perfil', 'Imagen de perfil', 'Nombre de usuario', 'Contraseña', 'Configuración', 'Editar o perfil', 'Foto do perfil', 'Senha', 'Modifica profilo', 'Foto del profilo', 'Impostazioni',
    'Profilbild ändern', 'Profilbild', 'Profil bearbeiten', 'Benutzername', 'Passwort', 'Einstellungen', 'Modifier le profil', 'Photo de profil', "Nom d'utilisateur", 'Mot de passe', 'Paramètres',
    'Редагувати профіль', 'Змінити фото профілю', 'Фото профілю', 'Пароль', 'Налаштування', 'Ім’я користувача', 'Изображение профиля',
    'profilepic', 'profile.photo', 'profile:photo', 'profileimage', 'userpic', 'pfp', 'photo_profile', 'profile_avatar', 'user-pic',
    'Edit page', 'Edit Page info', 'Edit public details', 'profile_pic', 'profile-photo', 'profilePhoto', 'cover_photo', 'coverPhoto', 'user_name', 'userName', 'old-password', 'phoneNumber',
    'Редактировать профиль', 'Изменить профиль', 'Сменить фото профиля', 'Фото профиля', 'Изменить фото профиля', 'Добавить аватар', 'Аватар', 'Биография', 'Изменить биографию', 'Имя пользователя',
    'Номер телефона', 'Добавить номер телефона', 'Телефон', 'Пароль', 'Изменить пароль', 'Настройки', 'Настройки профиля', 'Дата рождения', 'День рождения'
  ])('is: %s', (name) => {
    expect(changesProfile(name), name).toBe(true)
    expect(neverClicked(name), name).toBe(true)
  })

  // What a post's own wizard says is not about the profile, and a word inside another word is not the word.
  it.each([
    'Next', 'Continue', 'Share', 'Post', 'Create', 'Create post', 'New post', 'Select from computer', 'Select from device', 'Add photo', 'Add photos/videos', 'Photo/video', 'Add photos or video', 'Write a caption...',
    'Add location', 'Tag people', 'Add alt text', 'Crop', 'Back', 'Close', 'Discard', 'Edit', 'Aspect ratio', 'Browse', 'Attach media', 'Posting', 'Biology', 'Biography of a star', 'Phones', 'Phoned in', 'Passwords are hard',
    'Settingsmith', 'Genderless', 'Siguiente', 'Compartir', 'Añadir fotos', 'Weiter', 'Teilen', 'Suivant', 'Partager', 'Далі', 'Поділитися', 'Додати фото', 'Pfpfp', 'Pfpx', 'Profile', 'Profilbildung',  'post_caption', 'media-upload', 'photoVideo', 'createPost', 'Pageant', 'Homepage', 'Next-step', 'Avatars of Mars', 'Далее', 'Поделиться', 'Опубликовать', 'Выбрать с компьютера', 'Добавить фото', 'Добавить подпись', 'Телефония', 'Биологический', 'Назад'
  ])('is not: %s', (name) => {
    expect(changesProfile(name), name).toBe(false)
  })
})

describe('the compose page of a community, and what a reply answers', () => {
  const CHANNEL = 'https://www.reddit.com/r/Astrology'
  it('is /r/<community>/submit for a destination of Reddit\'s shape, in any of the shapes the connector opens', () => {
    expect(composePageOf(CHANNEL)).toEqual(['r', 'astrology', 'submit'])
    for (const page of ['https://old.reddit.com/r/astrology/submit?selftext=true', 'https://www.reddit.com/r/Astrology/submit/?type=IMAGE', 'https://www.reddit.com/r/astrology/submit/', 'https://www.reddit.com/r/astrology/submit#x']) {
      expect(onComposePage(page, CHANNEL)).toBe(true)
    }
    for (const page of ['https://www.reddit.com/r/astrology', 'https://www.reddit.com/r/astrology/new', 'https://www.reddit.com/r/astrology/submit/more', 'https://www.reddit.com/r/astrology/submitted', 'https://www.reddit.com/submit', 'https://www.reddit.com/r/tarot/submit', 'not an address']) {
      expect(onComposePage(page, CHANNEL)).toBe(false)
    }
  })

  it('is not guessed for a destination of another shape: every page is taken for it', () => {
    expect(composePageOf('https://forum.example.com/c/general')).toBeNull()
    expect(composePageOf('not an address')).toBeNull()
    expect(onComposePage('https://forum.example.com/c/general/new', 'https://forum.example.com/c/general')).toBe(true)
  })

  it('names the post and the comment of a reply destination of Reddit\'s shape, and nothing for another shape', () => {
    expect(replyTarget('https://www.reddit.com/r/astrology/comments/abc123/my_chart/def456/')).toEqual({ post: 't3_abc123', comment: 't1_def456' })
    expect(replyTarget('https://old.reddit.com/r/Astrology/comments/ABC123/_/DEF456/?context=3')).toEqual({ post: 't3_abc123', comment: 't1_def456' })
    expect(replyTarget('https://www.reddit.com/r/astrology/comments/abc123/my_chart/')).toEqual({ post: 't3_abc123', comment: null })
    expect(replyTarget('https://www.reddit.com/r/astrology')).toBeNull()
    expect(replyTarget('https://news.ycombinator.com/item?id=4242')).toBeNull()
    expect(replyTarget('not an address')).toBeNull()
  })
})

describe('which control only goes on to the next step of a form', () => {
  it.each(['Next', 'next', 'Continue', 'Next step', 'Next ›', 'Далее', 'Продолжить', 'Дальше'])('%s is one', (name) => {
    expect(looksLikeProgress(name)).toBe(true)
  })

  it.each(['', 'Next post', 'Continue reading', 'Next page of comments', 'Share', 'Post', 'Done', 'Skip', 'Back', 'Select from computer', 'Next and publish', 'Next step step', 'Create', 'OK'])('%s is not', (name) => {
    expect(looksLikeProgress(name)).toBe(false)
  })

  it('is never a control that publishes', () => {
    for (const name of ['Next', 'Continue', 'Далее']) expect(looksLikeSubmit(name)).toBe(false)
    for (const name of ['Share', 'Post', 'Publish']) expect(looksLikeProgress(name)).toBe(false)
  })
})

describe('which element takes a file', () => {
  it('is a file input that is not disabled, and never a button that opens a chooser', () => {
    expect(isAttachControl({ role: 'input:file' })).toBe(true)
    expect(isAttachControl({ role: 'input:file', disabled: true })).toBe(false)
    expect(isAttachControl({ role: 'button', })).toBe(false)
    expect(isAttachControl({ role: 'link' })).toBe(false)
    expect(isAttachControl({ role: 'input:text' })).toBe(false)
  })
})

describe('where a post of a platform with a dialog for new posts may be worked on', () => {
  const INSTAGRAM = 'https://www.instagram.com/brand/'
  const HOSTS_I = ['instagram.com']

  it('is the profile and the front page of the site, and no other page of it', () => {
    expect(destinationMatches('https://www.instagram.com/brand/', INSTAGRAM, 'post', HOSTS_I)).toBe(true)
    expect(destinationMatches('https://www.instagram.com/', INSTAGRAM, 'post', HOSTS_I)).toBe(true)
    expect(destinationMatches('https://www.instagram.com/accounts/logout/', INSTAGRAM, 'post', HOSTS_I)).toBe(false)
    expect(destinationMatches('https://www.instagram.com/other/', INSTAGRAM, 'post', HOSTS_I)).toBe(false)
    expect(destinationMatches('https://evil.example/', INSTAGRAM, 'post', HOSTS_I)).toBe(false)
  })

  it('is a closed list of the platforms with a recipe, not everything that is not Reddit', () => {
    for (const url of ['https://www.instagram.com/brand/', 'https://www.facebook.com/groups/x', 'https://fb.com/x', 'https://www.threads.net/@brand', 'https://threads.com/@brand']) expect(usesComposerDialog(url)).toBe(true)
    for (const url of ['https://www.reddit.com/r/astrology', 'https://www.reddit.com/user/brand', 'https://x.com/brand', 'https://example.org/', 'https://evilinstagram.com/', 'https://instagram.com.evil.example/', 'not an address']) expect(usesComposerDialog(url)).toBe(false)
    // a Reddit destination of another shape does not open the front page
    expect(destinationMatches('https://www.reddit.com/', 'https://www.reddit.com/user/brand', 'post', ['reddit.com'])).toBe(false)
    expect(destinationMatches('https://www.example.org/', 'https://www.example.org/brand/', 'post', ['example.org'])).toBe(false)
  })

  it('treats a destination with no path as the root and nothing under it: the host alone is not a place', () => {
    const root = 'https://www.instagram.com/'
    expect(destinationMatches('https://www.instagram.com/', root, 'post', HOSTS_I)).toBe(true)
    for (const path of ['accounts/edit/', 'direct/inbox/', 'accounts/logout/', 'brand/']) expect(destinationMatches(`https://www.instagram.com/${path}`, root, 'post', HOSTS_I)).toBe(false)
    expect(destinationMatches('https://www.example.org/anything', 'https://www.example.org/', 'post', ['example.org'])).toBe(false)
  })

  it('is not so for Reddit, whose community pages are the place, nor for a reply', () => {
    expect(destinationMatches('https://www.reddit.com/', 'https://www.reddit.com/r/astrology', 'post', ['reddit.com'])).toBe(false)
    expect(destinationMatches('https://www.instagram.com/', 'https://www.instagram.com/p/abc/', 'reply', HOSTS_I)).toBe(false)
  })
})

describe('which control opens the system\'s file chooser', () => {
  it.each(['Select from computer', 'Select From Computer', 'select from your computer', 'Select files', 'Choose file', 'Choose files', 'Choose a photo', 'Browse files', 'Upload file', 'Upload files', 'Upload a photo', 'Upload photos', 'Add photo', 'Add a picture', 'Select photos from your device', 'Select photos and videos from your device', 'Add media', 'Upload', 'Browse', 'Upload from computer', 'Upload from your device', 'Add photos/videos', 'Add photo/video', 'Add Photos/Videos', 'Add photos / videos', 'Select photos/videos from your device', 'Выбрать файл', 'Выбрать файлы', 'Выбрать с компьютера', 'Загрузить фото', 'Добавить изображение'])('the button %s does', (name) => {
    expect(opensFileChooser({ role: 'button', name })).toBe(true)
    expect(opensFileChooser({ role: 'link', name })).toBe(true)
  })

  it('does so for a file input of any name', () => {
    expect(opensFileChooser({ role: 'input:file', name: '' })).toBe(true)
    expect(opensFileChooser({ role: 'input:file', name: 'Next' })).toBe(true)
  })

  it.each(['', 'Next', 'Select', 'Choose', 'Pick', 'Browse communities', 'Upload date', 'Select a community', 'Choose a community', 'Choose flair', 'Upload date', 'Photo/video', 'Photos', 'Create', 'Add comment', 'Add a tag', 'Select all', 'Browse communities', 'Files of the month', 'Share', 'Continue'])('the button %s does not', (name) => {
    expect(opensFileChooser({ role: 'button', name })).toBe(false)
  })

  it('is about controls: a text box named like one is not one', () => {
    expect(opensFileChooser({ role: 'input:text', name: 'Select from computer' })).toBe(false)
    expect(opensFileChooser({ role: 'textarea', name: 'Choose file' })).toBe(false)
  })
})
