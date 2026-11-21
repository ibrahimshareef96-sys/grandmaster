// Klondike solitaire: click a card to pick it up, click where it goes; click
// it again to send it to a foundation. A surface module the pane's Client draws.
import type { ClientModule, ClientSurface, JsonValue, RenderElement } from 'claude-code'

import { resultId } from './result-id'
import {
  autoPlay,
  canFinish,
  cardLabel,
  deal,
  draw,
  isRed,
  isWon,
  lifted,
  move,
  readKlondike,
  toFoundation,
  type Klondike,
  type Source,
  type Target,
} from './solitaire-engine'

/** `startedAt` is when the deal's first move was made (`Date.now()`); the clock
 *  runs on wall time from then, so leaving the tab never makes a time faster. */
export type SolitaireSave = { game: Klondike; startedAt: number | null; finishedMs: number | null }

type State = SolitaireSave & {
  undo: Klondike[]
  selected: Source | null
  note: string
  /** The last ended deal, re-sent with every save until the board closes; the pane counts its id once. */
  lastResult: SolitaireResult | null
}

type SolitaireResult = { result: 'win' | 'abandoned'; ms: number; moves: number; id: string }

type Props = { saved?: JsonValue }

const CARD_W = 4
const STRIDE = CARD_W + 1
const TABLEAU_Y = 2
const UNDO_CAP = 200
const COLORS = {
  face: '#fafafa', red: '#c0392b', black: '#111111', back: '#2e5aa8', backText: '#6f93d6',
  selected: '#f4e04d', empty: '#555555',
}

export function readSave(raw: unknown): SolitaireSave | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const game = readKlondike(s.game)
  if (!game) return null
  const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
  const startedAt = time(s.startedAt)
  const finishedMs = isWon(game) ? time(s.finishedMs) ?? 0 : null
  return { game, startedAt: startedAt !== null && startedAt <= Date.now() ? startedAt : null, finishedMs }
}

const isOver = (s: SolitaireSave) => s.finishedMs !== null
const elapsed = (s: SolitaireSave) => s.finishedMs ?? (s.startedAt === null ? 0 : Date.now() - s.startedAt)

/** Saves the table with the last ended deal: a later post in the same frame
 *  replaces an earlier one, so every post carries that result again. */
function save(surface: ClientSurface<State>, s: State) {
  const data: SolitaireSave = { game: s.game, startedAt: s.startedAt, finishedMs: s.finishedMs }
  surface.post(s.lastResult
    ? { type: 'save', game: 'solitaire', data, result: s.lastResult }
    : { type: 'save', game: 'solitaire', data })
}

/** Takes a new position, keeping the old one for Undo and reporting a win once. */
function commit(surface: ClientSurface<State>, s: State, game: Klondike, note = ''): State {
  // Nothing changed (an empty stock, nothing to auto-play): no undo step, no save.
  if (game === s.game) return { ...s, selected: null, note }
  const finished = canFinish(game) ? autoPlay(game) : game
  const startedAt = s.startedAt ?? Date.now()
  const next: State = { ...s, game: finished, startedAt, undo: [...s.undo, s.game].slice(-UNDO_CAP), selected: null, note }
  if (!isWon(finished) || isOver(s)) {
    save(surface, next)
    return next
  }
  const ms = Date.now() - startedAt
  const won: State = {
    ...next, finishedMs: ms, note: 'You won.', lastResult: { result: 'win', ms, moves: finished.moves, id: resultId() },
  }
  save(surface, won)
  return won
}

function newDeal(surface: ClientSurface<State>, s: State, drawCount: 1 | 3): State {
  const abandoned = !isOver(s) && s.game.moves > 0
  const next: State = {
    game: deal(Math.random, drawCount), undo: [], selected: null, startedAt: null, finishedMs: null,
    note: `New deal, draw ${drawCount}.`,
    lastResult: abandoned
      ? { result: 'abandoned', ms: elapsed(s), moves: s.game.moves, id: resultId() }
      : s.lastResult,
  }
  save(surface, next)
  return next
}

const sameSource = (a: Source, b: Source) =>
  a.kind === b.kind &&
  (a.kind !== 'tableau' || (b.kind === 'tableau' && a.col === b.col && a.index === b.index)) &&
  (a.kind !== 'foundation' || (b.kind === 'foundation' && a.pile === b.pile))

/** What a click at (x, y) points at: a card to lift, a place to drop, or the stock. */
type Hit = { kind: 'stock' } | { kind: 'card'; src: Source; drop: Target | null } | { kind: 'drop'; drop: Target }

function hitTest(g: Klondike, x: number, y: number): Hit | null {
  const col = Math.floor(x / STRIDE)
  if (col < 0 || col > 6 || x % STRIDE === CARD_W) return null
  if (y === 0) {
    if (col === 0) return { kind: 'stock' }
    if (col === 1) return g.waste.length ? { kind: 'card', src: { kind: 'waste' }, drop: null } : null
    if (col >= 3) {
      const pile = col - 3
      const drop: Target = { kind: 'foundation', pile }
      return g.foundations[pile]?.length ? { kind: 'card', src: { kind: 'foundation', pile }, drop } : { kind: 'drop', drop }
    }
    return null
  }
  if (y < TABLEAU_Y) return null
  const column = g.tableau[col]
  if (!column) return null
  const row = y - TABLEAU_Y
  const drop: Target = { kind: 'tableau', col }
  const upIndex = row - column.down.length
  if (upIndex >= 0 && upIndex < column.up.length) {
    return { kind: 'card', src: { kind: 'tableau', col, index: upIndex }, drop }
  }
  return row >= column.down.length + column.up.length || column.up.length === 0 ? { kind: 'drop', drop } : null
}

function click(surface: ClientSurface<State>, s: State, hit: Hit): State {
  if (isOver(s)) return s
  if (hit.kind === 'stock') return commit(surface, s, draw(s.game))
  const sel = s.selected
  if (sel) {
    if (hit.kind === 'card' && sameSource(sel, hit.src)) {
      const up = toFoundation(s.game, sel)
      return up ? commit(surface, s, up) : { ...s, selected: null }
    }
    const moved = hit.drop ? move(s.game, sel, hit.drop) : null
    if (moved) return commit(surface, s, moved)
  }
  if (hit.kind === 'card' && lifted(s.game, hit.src).length > 0) return { ...s, selected: hit.src, note: '' }
  return { ...s, selected: null, note: sel ? 'That move is not allowed.' : '' }
}

function onKey(surface: ClientSurface<State>, key: string, modified = false) {
  const s = surface.state
  if (!s || modified) return
  if (key === 'u') {
    const prev = s.undo[s.undo.length - 1]
    if (!prev || isOver(s)) return
    const next: State = { ...s, game: prev, undo: s.undo.slice(0, -1), selected: null, note: 'Move taken back.' }
    save(surface, next)
    return surface.setState(next)
  }
  if (key === 'a') return surface.setState(commit(surface, s, autoPlay(s.game), 'Played every card that could go up.'))
  if (key === 'n') return surface.setState(newDeal(surface, s, s.game.drawCount))
  if (key === ' ' || key === 'space') return surface.setState(click(surface, s, { kind: 'stock' }))
}

function cardCell(surface: ClientSurface<State>, card: number | null, opts: { selected?: boolean; back?: boolean; empty?: string }): RenderElement {
  const { Text } = surface.elements
  if (opts.back) return <Text backgroundColor={COLORS.back} color={COLORS.backText}>{'░'.repeat(CARD_W)}</Text>
  if (card === null) return <Text color={COLORS.empty}>{(opts.empty ?? '[  ]').padEnd(CARD_W)}</Text>
  return (
    <Text backgroundColor={opts.selected ? COLORS.selected : COLORS.face} color={isRed(card) ? COLORS.red : COLORS.black} bold>
      {cardLabel(card).padStart(CARD_W - 1).padEnd(CARD_W)}
    </Text>
  )
}

function isSelected(s: State, src: Source) {
  if (!s.selected) return false
  if (s.selected.kind === 'tableau' && src.kind === 'tableau') {
    return s.selected.col === src.col && src.index >= s.selected.index
  }
  return sameSource(s.selected, src)
}

function drawTable(surface: ClientSurface<State>, s: State): RenderElement[] {
  const { Box, Text } = surface.elements
  const g = s.game
  const gap = <Text> </Text>
  const wasteTop = g.waste[g.waste.length - 1]
  const topRow = (
    <Box flexDirection="row">
      {g.stock.length ? cardCell(surface, null, { back: true }) : cardCell(surface, null, { empty: g.waste.length ? '[ ↻]' : '[  ]' })}
      {gap}
      {cardCell(surface, wasteTop ?? null, { selected: isSelected(s, { kind: 'waste' }) })}
      {gap}
      <Text>{' '.repeat(CARD_W)}</Text>
      {gap}
      {g.foundations.flatMap((p, pile) => [
        // Any ace starts any foundation, so the empty ones carry no suit.
        cardCell(surface, p[p.length - 1] ?? null, { selected: isSelected(s, { kind: 'foundation', pile }), empty: '[ A]' }),
        gap,
      ])}
    </Box>
  )
  const height = Math.max(1, ...g.tableau.map(c => c.down.length + c.up.length))
  const rows: RenderElement[] = [topRow, <Text> </Text>]
  for (let row = 0; row < height; row++) {
    rows.push(
      <Box flexDirection="row">
        {g.tableau.flatMap((c, col) => {
          const upIndex = row - c.down.length
          const cell = row < c.down.length
            ? cardCell(surface, null, { back: true })
            : upIndex < c.up.length
              ? cardCell(surface, c.up[upIndex] ?? null, { selected: isSelected(s, { kind: 'tableau', col, index: upIndex }) })
              : row === 0 ? cardCell(surface, null, { empty: '[  ]' }) : <Text>{' '.repeat(CARD_W)}</Text>
          return [cell, gap]
        })}
      </Box>,
    )
  }
  return rows
}

const formatClock = (ms: number) => {
  const sec = Math.floor(ms / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

const SolitaireTable: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text, Button } = surface.elements
  let s = surface.state
  if (!s) {
    const saved = readSave(props.saved)
    const game = saved?.game ?? deal(Math.random, 1)
    s = {
      game, undo: [], selected: null, startedAt: saved?.startedAt ?? null, finishedMs: saved?.finishedMs ?? null,
      note: saved ? 'Game resumed.' : 'Fresh deal. Click the stock to draw.', lastResult: null,
    }
    surface.every(1000, () => {
      const cur = surface.state
      if (cur && !isOver(cur) && cur.startedAt !== null) surface.setState({ ...cur })
    })
    surface.onPointer(e => {
      const cur = surface.state
      if (!cur || e.type !== 'down' || e.button === 'right') return
      const hit = hitTest(cur.game, e.x, e.y)
      surface.setState(hit ? click(surface, cur, hit) : { ...cur, selected: null })
    })
    surface.onKey(e => onKey(surface, e.key, e.ctrl === true || e.meta === true))
    surface.setState(s)
  }
  const state = s
  const act = (fn: (cur: State) => State) => () => {
    const cur = surface.state
    if (cur) surface.setState(fn(cur))
  }
  const found = state.game.foundations.reduce((n, p) => n + p.length, 0)

  return (
    <Box flexDirection="column">
      {drawTable(surface, state)}
      <Text> </Text>
      <Text bold>
        {isOver(state) ? `Won in ${formatClock(elapsed(state))}` : `${found}/52 home`}
        <Text dimColor>{`  ${state.game.moves} moves  ${formatClock(elapsed(state))}  draw ${state.game.drawCount}`}</Text>
      </Text>
      {state.note !== '' && <Text>{state.note}</Text>}
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="sol-new" variant="primary" onPress={act(cur => newDeal(surface, cur, cur.game.drawCount))}>New deal</Button>
        <Button key="sol-undo" onPress={() => onKey(surface, 'u')}>Undo</Button>
        <Button key="sol-auto" onPress={() => onKey(surface, 'a')}>Auto-play</Button>
        <Button key="sol-draw" onPress={act(cur => newDeal(surface, cur, cur.game.drawCount === 1 ? 3 : 1))}>
          {state.game.drawCount === 1 ? 'Switch to draw 3' : 'Switch to draw 1'}
        </Button>
      </Box>
      <Text dimColor>Click a card, then where it goes. Click it twice to send it home. Keys: Space draw, u undo, a auto, n new.</Text>
    </Box>
  )
}

export default SolitaireTable
