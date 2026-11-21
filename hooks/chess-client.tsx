// The chess board: a surface module the pane's Client draws. Click or use the
// arrow keys and Enter to move; the engine replies, thinking a depth per tick.
import type { ClientModule, ClientSurface, JsonValue, RenderElement } from 'claude-code'

import {
  START_FEN,
  legalMoves,
  makeMove,
  outcome,
  parseFen,
  pieceAt,
  positionKey,
  sideOf,
  squareName,
  inCheck,
  kingSquare,
  toFen,
  toSan,
  type Move,
  type Outcome,
  type Position,
  type Side,
} from './chess-engine'
import { LEVELS, pickMove, searchDepth, type SearchResult } from './chess-ai'
import { resultId } from './result-id'

export type ChessSave = {
  history: string[]
  sans: string[]
  moves: Array<[number, number]>
  side: Side
  level: number
  /** True once this game's result has gone to the record: an undo never counts it twice. */
  reported: boolean
  /** The weakest level played at any point in this game: what the rating is scored against. */
  ratedLevel: number
}

type Promo = 'q' | 'r' | 'b' | 'n'
type Think = { depth: number; best: SearchResult | null; startedAt: number; forHint: boolean }

type State = ChessSave & {
  selected: number | null
  cursor: number
  hint: Move | null
  think: Think | null
  promo: Promo
  note: string
  /** When New game was first pressed mid-game; a second press soon after resigns. */
  confirmAt: number
  /** The last finished game's result, re-sent with every save until the board closes. */
  lastResult: { result: 'win' | 'loss' | 'draw'; level: number; moves: number; id: string } | null
}

const PROMO_NAMES: Record<Promo, string> = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }
const PROMO_ORDER: readonly Promo[] = ['q', 'r', 'b', 'n']

type Props = { saved?: JsonValue }

const GLYPH: Record<string, string> = {
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟︎',
}
const COLORS = {
  light: '#e8c99b', dark: '#a8743f', selected: '#f4e04d', lastLight: '#d9d77a',
  lastDark: '#a9a43c', check: '#e5484d', cursor: '#7fb3ff', hint: '#6fd08c',
  target: '#3b2a14', capture: '#c0392b', white: '#ffffff', black: '#111111',
}
const THINK_SLICE_MS = 250
const THINK_MAX_MS = 3000
const LABEL_COLS = 2

const fresh = (side: Side = 'w', level = 1): ChessSave => ({
  history: [START_FEN], sans: [], moves: [], side, level, reported: false, ratedLevel: level,
})

const isLevel = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < LEVELS.length

/** Reads a save handed in through props; anything malformed starts afresh. */
export function readSave(raw: unknown): ChessSave {
  if (!raw || typeof raw !== 'object') return fresh()
  const s = raw as Record<string, unknown>
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
  const pairs = (v: unknown): v is Array<[number, number]> => Array.isArray(v) &&
    v.every(p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isInteger(n) && n >= 0 && n < 64))
  const side = s.side === 'b' ? 'b' : 'w'
  const level = isLevel(s.level) ? s.level : 1
  if (!strings(s.history) || !strings(s.sans) || !pairs(s.moves)) return fresh(side, level)
  const ok = s.history.length >= 1 && s.history.length === s.sans.length + 1 &&
    s.moves.length === s.sans.length && s.history.every(f => parseFen(f) !== null)
  if (!ok) return fresh(side, level)
  const ratedLevel = isLevel(s.ratedLevel) ? Math.min(s.ratedLevel, level) : level
  const base: ChessSave = {
    history: s.history, sans: s.sans, moves: s.moves, side, level, ratedLevel, reported: s.reported === true,
  }
  // A finished game saved before `reported` existed was counted when it ended.
  return outcomeOf(base).kind === 'playing' ? base : { ...base, reported: true }
}

const START = parseFen(START_FEN) as Position
/** The position after `n` moves; readSave has checked every entry parses. */
const positionAt = (s: ChessSave, n: number): Position => parseFen(s.history[n] ?? START_FEN) ?? START
const current = (s: ChessSave): Position => positionAt(s, s.history.length - 1)

function outcomeOf(s: ChessSave): Outcome {
  const keys = s.history.map(f => positionKey(parseFen(f) as Position))
  return outcome(current(s), keys)
}

const viewToSquare = (side: Side, row: number, col: number) =>
  side === 'w' ? row * 8 + col : (7 - row) * 8 + (7 - col)

function startThinking(s: State, forHint = false): State {
  return { ...s, think: { depth: 1, best: null, startedAt: Date.now(), forHint } }
}

function needsEngine(s: State): boolean {
  return outcomeOf(s).kind === 'playing' && current(s).turn !== s.side
}

function resultMessage(s: ChessSave, o: Outcome): string {
  if (o.kind === 'checkmate') return o.winner === s.side ? 'Checkmate. You win.' : 'Checkmate. The engine wins.'
  if (o.kind === 'draw') return `Draw by ${o.reason}.`
  return ''
}

/** Saves the game, with the last result this board produced: a later post in
 *  the same frame replaces an earlier one, so every post carries it again and
 *  the pane counts its id once. */
function post(surface: ClientSurface<State>, s: State) {
  const save: ChessSave = {
    history: s.history, sans: s.sans, moves: s.moves, side: s.side, level: s.level,
    reported: s.reported, ratedLevel: s.ratedLevel,
  }
  surface.post(s.lastResult
    ? { type: 'save', game: 'chess', data: save, result: s.lastResult }
    : { type: 'save', game: 'chess', data: save })
}

const isOver = (s: ChessSave) => outcomeOf(s).kind !== 'playing'

/** Plays `m`, saves, and reports a finished game once. */
function play(surface: ClientSurface<State>, s: State, m: Move): State {
  const pos = current(s)
  const after = makeMove(pos, m)
  let next: State = {
    ...s,
    history: [...s.history, toFen(after)],
    sans: [...s.sans, toSan(pos, m)],
    moves: [...s.moves, [m.from, m.to]],
    selected: null,
    hint: null,
    think: null,
    note: '',
  }
  const o = outcomeOf(next)
  if (o.kind === 'playing') {
    post(surface, next)
    return needsEngine(next) ? startThinking(next) : next
  }
  next = { ...next, note: resultMessage(next, o) }
  if (next.reported) {
    post(surface, next)
    return { ...next, note: `${next.note} Already counted once.` }
  }
  const result = o.kind === 'draw' ? 'draw' : o.winner === s.side ? 'win' : 'loss'
  next = { ...next, reported: true, lastResult: { result, level: s.ratedLevel, moves: next.sans.length, id: resultId() } }
  post(surface, next)
  return next
}

function thinkTick(surface: ClientSurface<State>) {
  const s = surface.state
  if (!s?.think) return
  const pos = current(s)
  const level = LEVELS[s.level] ?? LEVELS[1]
  const maxDepth = s.think.forHint ? 3 : level.depth
  const elapsed = Date.now() - s.think.startedAt
  const found = searchDepth(pos, s.think.depth, Date.now() + THINK_SLICE_MS, s.think.best?.move)
  const finish = (r: SearchResult) => {
    if (s.think?.forHint) {
      surface.setState({ ...s, think: null, hint: r.move, note: `Hint: ${toSan(pos, r.move)}` })
    } else {
      surface.setState(play(surface, s, pickMove(pos, r, s.level, Math.random)))
    }
  }
  if (found) {
    if (found.depth >= maxDepth || elapsed > THINK_MAX_MS || Math.abs(found.score) > 50000) finish(found)
    else surface.setState({ ...s, think: { ...s.think, depth: s.think.depth + 1, best: found } })
  } else if (s.think.best) finish(s.think.best)
}

/** A press on square `sq`: select one of the player's pieces, or move to it. */
function pressSquare(surface: ClientSurface<State>, s: State, sq: number): State {
  if (s.think || isOver(s) || current(s).turn !== s.side) return { ...s, cursor: sq }
  const pos = current(s)
  const own = sideOf(pieceAt(pos.board, sq)) === s.side
  if (s.selected === null || own) {
    return own ? { ...s, selected: sq === s.selected ? null : sq, cursor: sq } : { ...s, cursor: sq }
  }
  const options = legalMoves(pos).filter(m => m.from === s.selected && m.to === sq)
  if (options.length === 0) return { ...s, selected: null, cursor: sq }
  // A promotion becomes the piece the Promote button names (a queen unless changed).
  const move = options.find(m => !m.promo || m.promo === s.promo) ?? options[0]
  if (!move) return { ...s, selected: null, cursor: sq }
  return play(surface, { ...s, cursor: sq }, move)
}

function undo(surface: ClientSurface<State>, s: State): State {
  let n = s.history.length - 1
  if (n === 0) return s
  // Step back to the last position where it was the player's turn.
  n--
  while (n > 0 && positionAt(s, n).turn !== s.side) n--
  if (positionAt(s, n).turn !== s.side) return s
  const next: State = {
    ...s, history: s.history.slice(0, n + 1), sans: s.sans.slice(0, n), moves: s.moves.slice(0, n),
    selected: null, hint: null, think: null,
    note: s.reported ? 'Move taken back. This game is already in your record.' : 'Move taken back.',
  }
  post(surface, next)
  return next
}

function newGame(surface: ClientSurface<State>, s: State, side: Side): State {
  const base: State = { ...s, ...fresh(side, s.level), selected: null, hint: null, think: null, note: '', cursor: side === 'w' ? 52 : 12, confirmAt: 0 }
  post(surface, base)
  return needsEngine(base) ? startThinking(base) : base
}

const RESIGN_WINDOW_MS = 4000

/** Starting over in the middle of a game is resigning it: the first press asks,
 *  a second press within a few seconds counts the loss and starts afresh. */
function requestNewGame(surface: ClientSurface<State>, s: State, side: Side): State {
  const inProgress = !isOver(s) && !s.reported && s.sans.length >= 2
  if (!inProgress) return newGame(surface, s, side)
  if (Date.now() - s.confirmAt > RESIGN_WINDOW_MS) {
    return { ...s, confirmAt: Date.now(), note: 'Press again to resign this game. It counts as a loss.' }
  }
  const loss = { result: 'loss' as const, level: s.ratedLevel, moves: s.sans.length, id: resultId() }
  const next = newGame(surface, { ...s, lastResult: loss }, side)
  return { ...next, note: 'Resigned. The loss is in your record.' }
}

/** Next level; a game already under way is then scored against the weaker of the two. */
function changeLevel(surface: ClientSurface<State>, s: State): State {
  const level = (s.level + 1) % LEVELS.length
  const ratedLevel = s.sans.length === 0 ? level : Math.min(s.ratedLevel, level)
  const next: State = { ...s, level, ratedLevel }
  post(surface, next)
  return next
}

function onKey(surface: ClientSurface<State>, key: string, modified: boolean) {
  const s = surface.state
  if (!s || modified) return
  const flip = s.side === 'b' ? -1 : 1
  const r = Math.floor(s.cursor / 8)
  const c = s.cursor % 8
  const moveCursor = (dr: number, dc: number) => {
    const nr = Math.min(7, Math.max(0, r + dr * flip))
    const nc = Math.min(7, Math.max(0, c + dc * flip))
    surface.setState({ ...s, cursor: nr * 8 + nc })
  }
  switch (key) {
    case 'up': return moveCursor(-1, 0)
    case 'down': return moveCursor(1, 0)
    case 'left': return moveCursor(0, -1)
    case 'right': return moveCursor(0, 1)
    case 'return': case ' ': return surface.setState(pressSquare(surface, s, s.cursor))
    case 'u': return surface.setState(undo(surface, s))
    case 'h': return requestHint(surface, s)
    case 'n': return surface.setState(requestNewGame(surface, s, s.side))
  }
}

function requestHint(surface: ClientSurface<State>, s: State) {
  if (s.think || isOver(s) || current(s).turn !== s.side) return
  surface.setState(startThinking({ ...s, note: 'Looking for a hint...' }, true))
}

function geometry(columns: number) {
  return columns === 0 || columns >= LABEL_COLS + 8 * 6 ? { sw: 6, sh: 3 } : { sw: 3, sh: 1 }
}

function onPointer(surface: ClientSurface<State>, x: number, y: number) {
  const s = surface.state
  if (!s) return
  const { sw, sh } = geometry(surface.columns)
  const col = Math.floor((x - LABEL_COLS) / sw)
  const row = Math.floor(y / sh)
  if (x < LABEL_COLS || col > 7 || row > 7 || row < 0) return
  surface.setState(pressSquare(surface, s, viewToSquare(s.side, row, col)))
}

function squareColor(s: State, pos: Position, sq: number, targets: Set<number>): string {
  const light = (Math.floor(sq / 8) + (sq % 8)) % 2 === 0
  const last = s.moves[s.moves.length - 1]
  if (sq === s.selected) return COLORS.selected
  if (s.hint && (sq === s.hint.from || sq === s.hint.to)) return COLORS.hint
  if (inCheck(pos) && sq === kingSquare(pos.board, pos.turn)) return COLORS.check
  if (targets.has(sq) && pos.board[sq] !== '') return COLORS.capture
  if (last && (sq === last[0] || sq === last[1])) return light ? COLORS.lastLight : COLORS.lastDark
  return light ? COLORS.light : COLORS.dark
}

function cellText(piece: string, isTarget: boolean, width: number): string {
  const glyph = piece !== '' ? GLYPH[piece.toLowerCase()] : isTarget ? '·' : ' '
  const left = Math.floor((width - 1) / 2)
  return ' '.repeat(left) + glyph + ' '.repeat(width - 1 - left)
}

function drawBoard(surface: ClientSurface<State>, s: State, pos: Position): RenderElement[] {
  const { Box, Text } = surface.elements
  const { sw, sh } = geometry(surface.columns)
  const targets = new Set(
    s.selected === null ? [] : legalMoves(pos).filter(m => m.from === s.selected).map(m => m.to),
  )
  const lines: RenderElement[] = []
  for (let row = 0; row < 8; row++) {
    for (let line = 0; line < sh; line++) {
      const mid = line === Math.floor(sh / 2)
      const rank = s.side === 'w' ? 8 - row : row + 1
      const cells = Array.from({ length: 8 }, (_, col) => {
        const sq = viewToSquare(s.side, row, col)
        const piece = pieceAt(pos.board, sq)
        const cursorHere = sq === s.cursor && current(s).turn === s.side
        return (
          <Text
            backgroundColor={cursorHere && mid ? COLORS.cursor : squareColor(s, pos, sq, targets)}
            color={piece === '' ? COLORS.target : sideOf(piece) === 'w' ? COLORS.white : COLORS.black}
            bold
          >
            {mid ? cellText(piece, targets.has(sq), sw) : ' '.repeat(sw)}
          </Text>
        )
      })
      lines.push(
        <Box flexDirection="row">
          <Text dimColor>{mid ? `${rank} ` : '  '}</Text>
          {cells}
        </Box>,
      )
    }
  }
  const files = Array.from({ length: 8 }, (_, col) => squareName(viewToSquare(s.side, 7, col)).slice(0, 1))
  lines.push(
    <Text dimColor>{'  ' + files.map(f => cellText(f, false, sw)).join('')}</Text>,
  )
  return lines
}

function moveList(sans: readonly string[]): string {
  const pairs: string[] = []
  for (let i = 0; i < sans.length; i += 2) {
    pairs.push(`${i / 2 + 1}. ${sans[i]}${sans[i + 1] ? ` ${sans[i + 1]}` : ''}`)
  }
  return pairs.slice(-4).join('  ')
}

function status(s: State, pos: Position): string {
  if (s.note) return s.note
  const o = outcomeOf(s)
  if (o.kind !== 'playing') return resultMessage(s, o)
  if (s.think && !s.think.forHint) return `Engine thinking (depth ${s.think.depth})...`
  return pos.turn === s.side ? `Your move${inCheck(pos) ? ', you are in check' : ''}.` : 'Engine to move.'
}

const ChessBoard: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text, Button } = surface.elements
  let s = surface.state
  if (!s) {
    const save = readSave(props.saved)
    s = { ...save, selected: null, cursor: save.side === 'w' ? 52 : 12, hint: null, think: null, promo: 'q', note: '', lastResult: null, confirmAt: 0 }
    if (needsEngine(s)) s = startThinking(s)
    surface.every(50, () => thinkTick(surface))
    surface.onPointer(e => {
      if (e.type === 'down' && e.button !== 'right') onPointer(surface, e.x, e.y)
    })
    surface.onKey(e => onKey(surface, e.key, e.ctrl === true || e.meta === true))
    surface.setState(s)
  }
  const state = s
  const pos = current(state)
  const level = LEVELS[state.level] ?? LEVELS[1]
  // A press acts on the state as it is when pressed, not as it was drawn: the
  // engine may have moved in between.
  const act = (fn: (cur: State) => State | void) => () => {
    const cur = surface.state
    if (!cur) return
    const next = fn(cur)
    if (next) surface.setState(next)
  }

  return (
    <Box flexDirection="column">
      {drawBoard(surface, state, pos)}
      <Text bold>{status(state, pos)}</Text>
      <Text dimColor>{moveList(state.sans) || 'No moves yet. You play ' + (state.side === 'w' ? 'White.' : 'Black.')}</Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="chess-new" onPress={act(cur => requestNewGame(surface, cur, cur.side))}>New game</Button>
        <Button key="chess-undo" onPress={act(cur => undo(surface, cur))}>Undo</Button>
        <Button key="chess-hint" onPress={act(cur => requestHint(surface, cur))}>Hint</Button>
        <Button key="chess-level" onPress={act(cur => changeLevel(surface, cur))}>
          {`Level: ${level.name}`}
        </Button>
        <Button key="chess-side" onPress={act(cur => requestNewGame(surface, cur, cur.side === 'w' ? 'b' : 'w'))}>
          {state.side === 'w' ? 'Play Black' : 'Play White'}
        </Button>
        <Button
          key="chess-promo"
          onPress={act(cur => ({ ...cur, promo: PROMO_ORDER[(PROMO_ORDER.indexOf(cur.promo) + 1) % PROMO_ORDER.length] ?? 'q' }))}
        >
          {`Promote to: ${PROMO_NAMES[state.promo]}`}
        </Button>
      </Box>
      {state.ratedLevel !== state.level && state.sans.length > 0 && (
        <Text dimColor>{`This game is rated at ${LEVELS[state.ratedLevel]?.name ?? 'Club'}, the weakest level it was played at.`}</Text>
      )}
      <Text dimColor>Click a piece, then a square. Keys: arrows + Enter, u undo, h hint, n new.</Text>
    </Box>
  )
}

export default ChessBoard
