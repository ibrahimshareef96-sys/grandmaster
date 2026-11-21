// Klondike on the web page: drag cards (a run comes with the card you grab),
// or click a card then its destination; two clicks send a card home. Every
// card glides from where it was, whatever moved it.
function solitaireGame(root) {
  const saved = store.solitaire && typeof store.solitaire === 'object' ? store.solitaire : {}
  const savedGame = SO.readKlondike(saved.game)
  const okTime = v => typeof v === 'number' && Number.isFinite(v) && v >= 0
  let s = savedGame
    ? {
      game: savedGame, startedAt: okTime(saved.startedAt) && saved.startedAt <= Date.now() ? saved.startedAt : null,
      finishedMs: SO.isWon(savedGame) ? (okTime(saved.finishedMs) ? saved.finishedMs : 0) : null, note: 'Game resumed.',
    }
    : { game: SO.deal(Math.random, 1), startedAt: null, finishedMs: null, note: 'Fresh deal. Click the stock to draw.' }
  s = { ...s, undo: [], selected: null }
  const isOver = () => s.finishedMs !== null
  const elapsed = () => s.finishedMs ?? (s.startedAt === null ? 0 : Date.now() - s.startedAt)
  const persist = () => saveGame('solitaire', { game: s.game, startedAt: s.startedAt, finishedMs: s.finishedMs })
  const clock = ms => { const sec = Math.floor(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` }

  const table = h('div', { class: 'table' })
  const info = h('div', { class: 'rail' })
  root.replaceChildren(h('section', { class: 'panel' }, table, info))

  /** Takes a new position (gliding every card that moved), keeping the old one for Undo. */
  function commit(game, note = '') {
    if (game === s.game) { s = { ...s, selected: null, note }; return glideAll(table, render) }
    const done = SO.canFinish(game) ? SO.autoPlay(game) : game
    const startedAt = s.startedAt ?? Date.now()
    s = { ...s, game: done, startedAt, undo: [...s.undo, s.game].slice(-200), selected: null, note }
    if (SO.isWon(done) && !isOver()) {
      const ms = Date.now() - startedAt
      addResult({ game: 'solitaire', result: 'win', ms })
      s = { ...s, finishedMs: ms, note: `You won in ${clock(ms)} with ${done.moves} moves.` }
    }
    persist()
    glideAll(table, render)
  }
  function newDeal(drawCount) {
    if (!isOver() && s.game.moves > 0) addResult({ game: 'solitaire', result: 'abandoned', ms: elapsed() })
    s = { game: SO.deal(Math.random, drawCount), undo: [], selected: null, startedAt: null, finishedMs: null, note: `New deal, draw ${drawCount}.` }
    persist()
    render()
  }
  const same = (a, b) => Boolean(a && b) && a.kind === b.kind && a.col === b.col && a.index === b.index && a.pile === b.pile
  function pick(src, drop) {
    if (isOver()) return
    const sel = s.selected
    if (sel) {
      if (src && same(sel, src)) {
        const home = SO.toFoundation(s.game, sel)
        if (home) return commit(home)
        s = { ...s, selected: null }
        return glideAll(table, render)
      }
      const moved = drop ? SO.move(s.game, sel, drop) : null
      if (moved) return commit(moved)
    }
    // A selection change still glides, so a card mid-flight is never snapped into place.
    if (src && SO.lifted(s.game, src).length) { s = { ...s, selected: src, note: '' }; return glideAll(table, render) }
    s = { ...s, selected: null, note: sel ? 'That move is not allowed.' : '' }
    glideAll(table, render)
  }
  const undo = () => {
    const prev = s.undo[s.undo.length - 1]
    if (!prev || isOver()) return
    s = { ...s, game: prev, undo: s.undo.slice(0, -1), selected: null, note: 'Move taken back.' }
    persist()
    glideAll(table, render)
  }

  const targetOf = el => el.dataset.drop === 'foundation'
    ? { kind: 'foundation', pile: Number(el.dataset.pile) }
    : { kind: 'tableau', col: Number(el.dataset.col) }
  const isSel = src => {
    const sel = s.selected
    if (!sel) return false
    if (sel.kind === 'tableau' && src.kind === 'tableau') return sel.col === src.col && src.index >= sel.index
    return same(sel, src)
  }

  /** A press on a face-up card: drag it (and the run above it) or treat it as a click. */
  function press(e, src, drop) {
    if (isOver() || e.button > 0) return
    const lifted = SO.lifted(s.game, src)
    if (!lifted.length) return
    e.preventDefault()
    const nodes = lifted.map(card => table.querySelector(`[data-key="${card}"]`)).filter(Boolean)
    startDrag(e, nodes, {
      lift: () => {
        table.querySelectorAll('[data-drop]').forEach(el => {
          if (SO.move(s.game, src, targetOf(el))) el.classList.add('can-drop')
        })
      },
      click: () => pick(src, drop),
      drop: target => {
        table.querySelectorAll('.can-drop').forEach(el => el.classList.remove('can-drop'))
        const moved = target ? SO.move(s.game, src, targetOf(target)) : null
        if (!moved) return false
        commit(moved)
        return true
      },
    })
  }

  const face = (card, src, drop, top) => h('div', {
    class: `card up${SO.isRed(card) ? ' red' : ''}${isSel(src) ? ' selected' : ''}`,
    style: top ? `top:${top}` : '', 'data-key': card, role: 'button', tabindex: '0', 'aria-label': SO.cardLabel(card),
    onpointerdown: e => press(e, src, drop),
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); pick(src, drop) } },
  }, h('span', { class: 'corner' }, SO.cardLabel(card)), h('span', { class: 'pip' }, SO.SUITS[SO.suitOf(card)]))
  const back = (card, top) => h('div', { class: 'card down', style: top ? `top:${top}` : '', 'data-key': card })

  function render() {
    const g = s.game
    const wasteTop = g.waste[g.waste.length - 1]
    const stockTop = g.stock[g.stock.length - 1]
    const top = h('div', { class: 'row' },
      h('div', { class: 'pile' }, stockTop !== undefined
        ? h('div', {
          class: 'card down stock', 'data-key': stockTop, role: 'button', tabindex: '0', 'aria-label': `Stock, ${g.stock.length} cards. Draw`,
          onclick: () => { if (!isOver()) commit(SO.draw(g)) },
          onkeydown: e => { if (e.key === 'Enter' && !isOver()) { e.preventDefault(); commit(SO.draw(g)) } },
        })
        : h('button', { class: 'slot', 'aria-label': 'Turn the waste over', onclick: () => commit(SO.draw(g)) }, g.waste.length ? '↻' : '')),
      h('div', { class: 'pile' }, wasteTop === undefined ? h('div', { class: 'slot', style: 'cursor:default' }) : face(wasteTop, { kind: 'waste' }, null)),
      h('div', {}),
      ...g.foundations.map((p, pile) => {
        const drop = { kind: 'foundation', pile }
        const t = p[p.length - 1]
        return h('div', { class: 'pile', 'data-drop': 'foundation', 'data-pile': pile }, t === undefined
          ? h('button', { class: 'slot', 'aria-label': 'Empty foundation', onclick: () => pick(null, drop) }, 'A')
          : face(t, { kind: 'foundation', pile }, drop))
      }),
    )
    const rows = h('div', { class: 'row' }, g.tableau.map((col, ci) => {
      const drop = { kind: 'tableau', col: ci }
      let depth = 0
      const cards = []
      col.down.forEach(card => { cards.push(back(card, `calc(var(--cw) * ${depth})`)); depth += 0.16 })
      col.up.forEach((card, ui) => { cards.push(face(card, { kind: 'tableau', col: ci, index: ui }, drop, `calc(var(--cw) * ${depth})`)); depth += 0.34 })
      const reach = Math.max(0, depth - (col.up.length ? 0.34 : 0.16))
      return h('div', {
        class: 'pile', 'data-drop': 'tableau', 'data-col': ci, style: `min-height:calc(var(--ch) + var(--cw) * ${reach})`,
        onclick: e => { if (e.target === e.currentTarget || e.target.classList.contains('slot')) pick(null, drop) },
      }, cards.length ? cards : h('div', { class: 'slot', 'aria-label': 'Empty column, takes a king' }, 'K'))
    }))
    table.replaceChildren(top, rows)
    const homeCount = g.foundations.reduce((n, p) => n + p.length, 0)
    info.replaceChildren(
      h('div', { class: 'record' }, h('strong', {}, record.solitaire.wins), h('span', { class: 'muted' },
        `won of ${record.solitaire.played}${record.solitaire.bestMs ? ` · fastest ${clock(record.solitaire.bestMs)}` : ''}`)),
      h('div', { class: 'status', 'aria-live': 'polite' }, s.note || `${homeCount} of 52 cards home.`),
      h('p', { class: 'muted', id: 'sol-clock', style: 'font-variant-numeric:tabular-nums' }, `${g.moves} moves · ${clock(elapsed())} · draw ${g.drawCount}`),
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => newDeal(g.drawCount) }, 'New deal'),
        h('button', { class: 'btn', onclick: undo, disabled: !s.undo.length || isOver() }, 'Undo'),
        h('button', { class: 'btn', onclick: () => commit(SO.autoPlay(g), 'Played every card that could go up.') }, 'Auto-play'),
        h('button', { class: 'btn', onclick: () => newDeal(g.drawCount === 1 ? 3 : 1) }, g.drawCount === 1 ? 'Switch to draw 3' : 'Switch to draw 1')),
      h('p', { class: 'faint' }, 'Drag cards where they go, or click a card and then its place. Click a card twice to send it home. Keys: Space draws, U undoes, A auto-plays, N deals.'),
    )
  }
  render()
  const tick = setInterval(() => {
    const el = document.getElementById('sol-clock')
    if (el && s.startedAt !== null && !isOver()) el.textContent = `${s.game.moves} moves · ${clock(elapsed())} · draw ${s.game.drawCount}`
  }, 1000)
  const onKey = e => {
    // Shortcuts wait while a card is held, and a held key acts once.
    if (typing(e) || modified(e) || dragging()) return
    if (e.key === ' ') e.preventDefault()
    if (e.repeat) return
    const key = e.key.toLowerCase()
    if (key === ' ' && !isOver()) commit(SO.draw(s.game))
    else if (key === 'u') undo()
    else if (key === 'a' && !isOver()) commit(SO.autoPlay(s.game), 'Played every card that could go up.')
    else if (key === 'n') newDeal(s.game.drawCount)
  }
  document.addEventListener('keydown', onKey)
  return () => { clearInterval(tick); document.removeEventListener('keydown', onKey) }
}
