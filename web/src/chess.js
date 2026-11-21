// Chess on the web page: drag a piece or click it then its square; the engine
// replies with a sliding move. Rules and engine are the pane's own.
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
const PROMO = ['q', 'r', 'b', 'n']
const PROMO_NAME = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }
const TIERS = [
  [1700, 'Legendary', 'var(--tier-legendary)'], [1400, 'Epic', 'var(--tier-epic)'],
  [1200, 'Rare', 'var(--tier-rare)'], [1000, 'Uncommon', 'var(--tier-uncommon)'], [0, 'Common', 'var(--tier-common)'],
]
const tierOf = rating => TIERS.find(([min]) => rating >= min) || TIERS[TIERS.length - 1]
const ENGINE_BUDGET_MS = 3000
const RESIGN_WINDOW_MS = 4000

/** A worker running the page's own engine bundle, so the search never blocks the
 *  page and plays to its full depth on any machine. Null where workers are refused. */
function engineWorker() {
  const source = document.getElementById('gm-engine')?.textContent
  if (!source || typeof Worker === 'undefined') return null
  const code = `${source}
;self.onmessage = e => {
  const { fen, maxDepth, budgetMs, token } = e.data
  const pos = GM.chess.parseFen(fen)
  const deadline = Date.now() + budgetMs
  let best = null
  for (let d = 1; d <= maxDepth; d++) {
    const r = GM.ai.searchDepth(pos, d, deadline, best ? best.move : undefined)
    if (!r) break
    best = r
    if (Math.abs(r.score) > 50000) break
  }
  self.postMessage({ token, best })
}`
  try {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    const worker = new Worker(url)
    URL.revokeObjectURL(url)
    return worker
  } catch {
    return null
  }
}

function readChess(raw) {
  const fresh = { history: [C.START_FEN], sans: [], moves: [], side: 'w', level: 1, reported: false, ratedLevel: 1 }
  if (!raw || typeof raw !== 'object') return fresh
  const strings = v => Array.isArray(v) && v.every(x => typeof x === 'string')
  const okLevel = v => Number.isInteger(v) && v >= 0 && v < AI.LEVELS.length
  const okMoves = v => Array.isArray(v) && v.every(m => Array.isArray(m) && m.length === 2 && m.every(n => Number.isInteger(n) && n >= 0 && n < 64))
  const side = raw.side === 'b' ? 'b' : 'w'
  const level = okLevel(raw.level) ? raw.level : 1
  const empty = { ...fresh, side, level, ratedLevel: level }
  if (!strings(raw.history) || !strings(raw.sans) || !okMoves(raw.moves)) return empty
  if (raw.history.length !== raw.sans.length + 1 || raw.moves.length !== raw.sans.length) return empty
  if (!raw.history.every(f => C.parseFen(f))) return empty
  return {
    history: raw.history, sans: raw.sans, moves: raw.moves, side, level,
    reported: raw.reported === true, ratedLevel: okLevel(raw.ratedLevel) ? Math.min(raw.ratedLevel, level) : level,
  }
}

function chessGame(root) {
  let s = { ...readChess(store.chess), selected: null, hint: null, promo: 'q', note: '', thinking: null, confirmAt: 0 }
  let thinkToken = 0
  let timer = 0
  let alive = true
  let worker = engineWorker()
  const pos = () => C.parseFen(s.history[s.history.length - 1])
  // The outcome reads the whole history (repetition), so it is worked out once per position.
  let outcomeCache = { key: '', value: null }
  const result = () => {
    const key = `${s.history.length}|${s.history[s.history.length - 1]}`
    if (outcomeCache.key !== key) {
      outcomeCache = { key, value: C.outcome(pos(), s.history.map(f => C.positionKey(C.parseFen(f)))) }
    }
    return outcomeCache.value
  }
  const over = () => result().kind !== 'playing'
  const myTurn = () => !s.thinking && !over() && pos().turn === s.side
  const persist = () => saveGame('chess', {
    history: s.history, sans: s.sans, moves: s.moves, side: s.side, level: s.level, reported: s.reported, ratedLevel: s.ratedLevel,
  })
  const message = o => o.kind === 'checkmate'
    ? (o.winner === s.side ? 'Checkmate. You win.' : 'Checkmate. The engine wins.')
    : o.kind === 'draw' ? `Draw by ${o.reason}.` : ''

  const board = h('div', { class: 'board', role: 'grid', 'aria-label': 'Chess board' })
  const statusEl = h('div', { class: 'status', 'aria-live': 'polite' })
  const recordEl = h('div', { class: 'record' })
  const movesEl = h('div', { class: 'moves', 'aria-label': 'Moves' })
  const controls = h('div', { class: 'controls' })
  root.replaceChildren(h('section', { class: 'panel' }, h('div', { class: 'board-wrap' }, board),
    h('div', { class: 'rail' }, recordEl, statusEl, movesEl, controls,
      h('p', { class: 'faint' }, 'Drag a piece to its square, or click the piece and then the square. Keys: U takes back, H hints, N starts a new game.'))))

  const squareEl = sq => board.querySelector(`[data-sq="${sq}"]`)

  /** Plays `move`; the piece glides in from `from` (a screen rect) or from its old square. */
  function play(move, from) {
    const start = from || squareEl(move.from)?.querySelector('.piece')?.getBoundingClientRect()
    const before = pos()
    const san = C.toSan(before, move)
    s = {
      ...s, history: [...s.history, C.toFen(C.makeMove(before, move))], sans: [...s.sans, san],
      moves: [...s.moves, [move.from, move.to]], selected: null, hint: null, note: '', thinking: null,
    }
    const o = result()
    if (o.kind !== 'playing') {
      if (s.reported) s = { ...s, note: `${message(o)} Already counted once.` }
      else {
        addResult({ game: 'chess', result: o.kind === 'draw' ? 'draw' : o.winner === s.side ? 'win' : 'loss', level: s.ratedLevel })
        s = { ...s, reported: true, note: message(o) }
      }
    }
    persist()
    render()
    glideFrom(squareEl(move.to)?.querySelector('.piece'), start, from ? 140 : 260)
    if (!over() && pos().turn !== s.side) think(false)
  }

  function think(forHint) {
    const token = ++thinkToken
    const start = pos()
    const maxDepth = forHint ? 3 : (AI.LEVELS[s.level] || AI.LEVELS[1]).depth
    const startedAt = Date.now()
    let depth = 1
    let best = null
    s = { ...s, thinking: { forHint, depth } }
    render()
    const finish = found => {
      // A reply shown at once reads as a glitch: let the engine take a breath.
      const wait = forHint ? 0 : Math.max(0, 450 - (Date.now() - startedAt))
      timer = setTimeout(() => {
        if (!alive || token !== thinkToken) return
        if (forHint) {
          s = { ...s, thinking: null, hint: found.move, note: `Hint: ${C.toSan(start, found.move)}` }
          render()
        } else play(AI.pickMove(start, found, s.level, Math.random))
      }, wait)
    }
    // Fallback where workers are refused: one depth per slice on the page itself.
    const slice = () => {
      if (!alive || token !== thinkToken) return
      const found = AI.searchDepth(start, depth, Date.now() + 120, best ? best.move : undefined)
      if (found) {
        best = found
        if (depth >= maxDepth || Date.now() - startedAt > ENGINE_BUDGET_MS || Math.abs(found.score) > 50000) return finish(best)
        depth++
        s = { ...s, thinking: { forHint, depth } }
        renderStatus()
      } else if (best) return finish(best)
      timer = setTimeout(slice, 0)
    }
    if (!worker) {
      timer = setTimeout(slice, 0)
      return
    }
    worker.onmessage = e => {
      if (!alive || e.data.token !== token || token !== thinkToken) return
      if (e.data.best) finish(e.data.best)
      else timer = setTimeout(slice, 0)
    }
    worker.onerror = () => {
      worker?.terminate()
      worker = null
      if (alive && token === thinkToken) timer = setTimeout(slice, 0)
    }
    worker.postMessage({ fen: s.history[s.history.length - 1], maxDepth, budgetMs: ENGINE_BUDGET_MS, token })
  }

  function cancelThinking() {
    thinkToken++
    clearTimeout(timer)
    s = { ...s, thinking: null }
  }

  /** The legal move from the selected square to `sq`, promoting to the chosen piece. */
  function moveTo(fromSq, sq) {
    const options = C.legalMoves(pos()).filter(m => m.from === fromSq && m.to === sq)
    return options.find(m => !m.promo || m.promo === s.promo) || options[0] || null
  }

  function clickSquare(sq) {
    if (!myTurn()) return
    const own = C.sideOf(C.pieceAt(pos().board, sq)) === s.side
    if (s.selected !== null && !own) {
      const move = moveTo(s.selected, sq)
      if (move) return play(move)
    }
    s = { ...s, selected: own && sq !== s.selected ? sq : null }
    render()
  }

  function pressPiece(e, sq, pieceEl) {
    if (!myTurn() || C.sideOf(C.pieceAt(pos().board, sq)) !== s.side) return
    e.preventDefault()
    startDrag(e, [pieceEl], {
      lift: () => {
        s = { ...s, selected: sq }
        markTargets()
      },
      click: () => clickSquare(sq),
      drop: (target, rect) => {
        // No square under the pointer: the piece eases back and stays selected.
        if (!target) return false
        const move = moveTo(sq, Number(target.dataset.sq))
        if (!move) return false
        play(move, rect)
        return true
      },
    })
  }

  function undo() {
    // Find the position to return to first: with nothing to take back, the
    // engine's search (if running) carries on untouched.
    let n = s.history.length - 2
    while (n > 0 && C.parseFen(s.history[n]).turn !== s.side) n--
    if (n < 0 || C.parseFen(s.history[n]).turn !== s.side) return
    cancelThinking()
    s = {
      ...s, history: s.history.slice(0, n + 1), sans: s.sans.slice(0, n), moves: s.moves.slice(0, n),
      selected: null, hint: null, note: s.reported ? 'Move taken back. This game is already in your record.' : 'Move taken back.',
    }
    persist()
    render()
  }

  function newGame(side) {
    cancelThinking()
    s = { ...s, ...readChess(null), side, level: s.level, ratedLevel: s.level, selected: null, hint: null, note: '', confirmAt: 0 }
    persist()
    render()
    if (pos().turn !== s.side) think(false)
  }

  /** Starting over in the middle of a game is resigning it: the first press
   *  asks, a second press within a few seconds counts the loss and deals afresh. */
  function requestNewGame(side) {
    const inProgress = !over() && !s.reported && s.sans.length >= 2
    if (!inProgress) return newGame(side)
    if (Date.now() - s.confirmAt > RESIGN_WINDOW_MS) {
      s = { ...s, confirmAt: Date.now(), note: 'Press again to resign this game. It counts as a loss.' }
      return render()
    }
    addResult({ game: 'chess', result: 'loss', level: s.ratedLevel })
    newGame(side)
    s = { ...s, note: 'Resigned. The loss is in your record.' }
    renderStatus()
  }

  function renderStatus() {
    const o = result()
    const p = pos()
    statusEl.textContent = s.note || (o.kind !== 'playing' ? message(o)
      : s.thinking && !s.thinking.forHint ? `Engine thinking, depth ${s.thinking.depth}...`
      : s.thinking ? 'Looking for a hint...'
      : p.turn === s.side ? `Your move${C.inCheck(p) ? '. You are in check.' : '.'}` : 'Engine to move.')
  }

  /** Marks where the selected piece may go, without redrawing the board (a drag is under way). */
  function markTargets() {
    board.querySelectorAll('.target').forEach(n => n.classList.remove('target', 'capture'))
    board.querySelectorAll('.sel').forEach(n => n.classList.remove('sel'))
    if (s.selected === null) return
    squareEl(s.selected)?.classList.add('sel')
    for (const m of C.legalMoves(pos())) {
      if (m.from !== s.selected) continue
      const el = squareEl(m.to)
      el?.classList.add('target')
      if (C.pieceAt(pos().board, m.to)) el?.classList.add('capture')
    }
  }

  function render() {
    const p = pos()
    const mine = myTurn()
    const last = s.moves[s.moves.length - 1]
    const checked = C.inCheck(p) ? C.kingSquare(p.board, p.turn) : -1
    const squares = []
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = s.side === 'w' ? r * 8 + c : (7 - r) * 8 + (7 - c)
        const piece = C.pieceAt(p.board, sq)
        const name = C.squareName(sq)
        const cls = ['sq', (Math.floor(sq / 8) + (sq % 8)) % 2 === 0 ? 'light' : 'dark']
        if (last && (sq === last[0] || sq === last[1])) cls.push('last')
        if (s.hint && (sq === s.hint.from || sq === s.hint.to)) cls.push('hint')
        if (sq === checked) cls.push('check')
        const pieceEl = piece
          ? h('span', {
            class: `piece ${C.sideOf(piece)}${C.sideOf(piece) === s.side && mine ? ' movable' : ''}`,
            onpointerdown: e => pressPiece(e, sq, e.currentTarget),
          }, `${GLYPH[piece.toLowerCase()]}︎`)
          : null
        squares.push(h('div', {
          class: cls.join(' '), role: 'gridcell', 'data-sq': sq, 'data-drop': 'square',
          'aria-label': `${name}${piece ? ` ${C.sideOf(piece) === 'w' ? 'white' : 'black'} ${piece.toLowerCase()}` : ''}`,
          // A press on one of your own pieces is handled by its drag (a click
          // there is a select); every other click, captures included, lands here.
          tabindex: '-1', onclick: e => { if (!e.target.closest('.piece.movable')) clickSquare(sq) },
        },
        r === 7 ? h('span', { class: 'coord file' }, name[0]) : null,
        c === 0 ? h('span', { class: 'coord rank' }, name[1]) : null,
        pieceEl))
      }
    }
    board.replaceChildren(...squares)
    markTargets()
    const [, tierName, tierColor] = tierOf(record.chess.rating)
    recordEl.replaceChildren(
      h('strong', {}, record.chess.rating),
      h('span', { class: 'chip', style: `color:${tierColor}` }, tierName),
      h('span', { class: 'muted' }, `${record.chess.wins}W ${record.chess.losses}L ${record.chess.draws}D`),
    )
    const pairs = []
    for (let i = 0; i < s.sans.length; i += 2) pairs.push(`${i / 2 + 1}. ${s.sans[i]}${s.sans[i + 1] ? ` ${s.sans[i + 1]}` : ''}`)
    movesEl.textContent = pairs.join('\n') || `No moves yet. You play ${s.side === 'w' ? 'White' : 'Black'}.`
    movesEl.scrollTop = movesEl.scrollHeight
    const level = AI.LEVELS[s.level] || AI.LEVELS[1]
    controls.replaceChildren(
      h('button', { class: 'btn primary', onclick: () => requestNewGame(s.side) }, 'New game'),
      h('button', { class: 'btn', onclick: undo, disabled: s.sans.length === 0 }, 'Undo'),
      h('button', { class: 'btn', disabled: !mine, onclick: () => think(true) }, 'Hint'),
      h('button', {
        class: 'btn',
        onclick: () => {
          const lv = (s.level + 1) % AI.LEVELS.length
          s = { ...s, level: lv, ratedLevel: s.sans.length === 0 ? lv : Math.min(s.ratedLevel, lv) }
          persist()
          render()
        },
      }, `Level: ${level.name}`),
      h('button', { class: 'btn', onclick: () => requestNewGame(s.side === 'w' ? 'b' : 'w') }, s.side === 'w' ? 'Play Black' : 'Play White'),
      h('button', { class: 'btn', onclick: () => { s = { ...s, promo: PROMO[(PROMO.indexOf(s.promo) + 1) % 4] }; render() } }, `Promote to: ${PROMO_NAME[s.promo]}`),
    )
    renderStatus()
  }

  render()
  if (!over() && pos().turn !== s.side) think(false)
  const onKey = e => {
    // Shortcuts wait while a piece is held, so a redraw cannot pull it from under the pointer.
    if (typing(e) || modified(e) || dragging() || e.repeat) return
    const key = e.key.toLowerCase()
    if (key === 'u') undo()
    else if (key === 'n') requestNewGame(s.side)
    else if (key === 'h' && myTurn()) think(true)
    else if (e.key === 'Escape' && s.selected !== null) { s = { ...s, selected: null }; render() }
  }
  document.addEventListener('keydown', onKey)
  return () => {
    alive = false
    cancelThinking()
    worker?.terminate()
    document.removeEventListener('keydown', onKey)
  }
}
