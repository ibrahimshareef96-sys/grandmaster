// The Rubik's Cube: an unfolded net, turn buttons, keys, a solve timer and a
// shelf of algorithms to drill. A surface module the pane's Client draws.
import type { ClientModule, ClientSurface, JsonValue, RenderElement } from 'claude-code'

import { ALGS, apply, isSolved, readCube, scramble, solved, type Cube, type Face } from './cube-engine'
import { resultId } from './result-id'
import { formatMs } from './time'

export type CubeSave = {
  cube: Face[]
  scrambledWith: string[]
  moves: number
  history: string[]
  /** When the timed solve's first turn was made (`Date.now()`), kept so a solve
   *  resumed after a tab switch or a restart still counts the time away. */
  startedAt: number | null
}

type State = CubeSave & {
  now: number
  finishedMs: number | null
  showAlgs: boolean
  note: string
  /** The last solve, re-sent with every save until the board closes; the pane counts its id once. */
  lastResult: { ms: number; moves: number; id: string } | null
}

type Props = { saved?: JsonValue }

const COLOR: Record<Face, string> = {
  U: '#ffffff', R: '#d62828', F: '#2a9d4b', D: '#ffd500', L: '#ff7f11', B: '#1d5fd1',
}
const TURN_ROWS = [
  ['U', "U'", 'D', "D'", 'R', "R'", 'L', "L'"],
  ['F', "F'", 'B', "B'", 'M', "M'", 'x', 'y', 'z'],
]
const HISTORY_CAP = 500

const fresh = (): CubeSave => ({ cube: [...solved()], scrambledWith: [], moves: 0, history: [], startedAt: null })

export function readSave(raw: unknown): CubeSave {
  if (!raw || typeof raw !== 'object') return fresh()
  const s = raw as Record<string, unknown>
  const cube = readCube(s.cube)
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
  if (!cube || !strings(s.scrambledWith) || !strings(s.history)) return fresh()
  const moves = Number.isInteger(s.moves) && (s.moves as number) >= 0 ? (s.moves as number) : 0
  const startedAt = typeof s.startedAt === 'number' && Number.isFinite(s.startedAt) && s.startedAt <= Date.now() &&
    s.scrambledWith.length > 0 ? s.startedAt : null
  return { cube: [...cube], scrambledWith: s.scrambledWith, moves, history: s.history.slice(-HISTORY_CAP), startedAt }
}

/** Saves the cube with the last solve: a later post in the same frame replaces
 *  an earlier one, so every post carries the solve again. */
function save(surface: ClientSurface<State>, s: State) {
  const data: CubeSave = {
    cube: s.cube, scrambledWith: s.scrambledWith, moves: s.moves, history: s.history, startedAt: s.startedAt,
  }
  surface.post(s.lastResult ? { type: 'save', game: 'cube', data, result: s.lastResult } : { type: 'save', game: 'cube', data })
}

/** Turns the cube by `alg`; starts the clock on the first turn of a solve and stops it when solved. */
function turnBy(s: State, alg: string): State {
  const tokens = alg.split(/\s+/).filter(Boolean)
  const cube = [...apply(s.cube, alg)]
  const solving = s.scrambledWith.length > 0 && s.finishedMs === null
  const now = Date.now()
  const startedAt = solving ? s.startedAt ?? now : s.startedAt
  const next: State = {
    ...s, cube, moves: s.moves + tokens.length, history: [...s.history, ...tokens].slice(-HISTORY_CAP),
    startedAt, now, note: '',
  }
  if (!solving || !isSolved(cube)) return next
  const ms = now - (startedAt ?? now)
  return {
    ...next, finishedMs: ms, scrambledWith: [], startedAt: null, note: `Solved in ${formatMs(ms)} with ${next.moves} turns.`,
    lastResult: { ms, moves: next.moves, id: resultId() },
  }
}

function doTurns(surface: ClientSurface<State>, s: State, alg: string): State {
  const next = turnBy(s, alg)
  save(surface, next)
  return next
}

function doScramble(surface: ClientSurface<State>, s: State): State {
  const moves = scramble(Math.random)
  const next: State = {
    ...s, cube: [...apply(solved(), moves.join(' '))], scrambledWith: moves, moves: 0, history: [],
    startedAt: null, finishedMs: null, note: 'Scrambled. The clock starts on your first turn.',
  }
  save(surface, next)
  return next
}

function doUndo(surface: ClientSurface<State>, s: State): State {
  const last = s.history[s.history.length - 1]
  if (!last) return s
  const inverse = last.endsWith("'") ? last.slice(0, -1) : last.endsWith('2') ? last : `${last}'`
  // Undoing is a real turn of the cube: it counts, and it can finish a solve.
  const turned = turnBy({ ...s, history: s.history.slice(0, -1) }, inverse)
  const next: State = { ...turned, history: turned.history.slice(0, -1), note: turned.note || `Undid ${last}.` }
  save(surface, next)
  return next
}

function doReset(surface: ClientSurface<State>, s: State): State {
  const next: State = { ...s, ...fresh(), finishedMs: null, note: 'Reset to solved.' }
  save(surface, next)
  return next
}

function onKey(surface: ClientSurface<State>, key: string, shift: boolean, modified: boolean) {
  const s = surface.state
  if (!s || modified) return
  if (key === ' ' || key === 'space') return surface.setState(doScramble(surface, s))
  if (key === 'backspace') return surface.setState(doUndo(surface, s))
  const lower = key.toLowerCase()
  const base = 'udrlfbmes'.includes(lower) ? lower.toUpperCase() : 'xyz'.includes(lower) ? lower : null
  if (!base || key.length !== 1) return
  const prime = shift || key !== lower
  surface.setState(doTurns(surface, s, prime ? `${base}'` : base))
}

function geometry(columns: number) {
  return columns === 0 || columns >= 12 * 4 + 3 ? { sw: 4, sh: 2 } : { sw: 2, sh: 1 }
}

function faceRow(surface: ClientSurface<State>, cube: Cube, face: number, row: number, sw: number): RenderElement[] {
  const { Text } = surface.elements
  return [0, 1, 2].map(c => (
    <Text backgroundColor={COLOR[cube[face * 9 + row * 3 + c] ?? 'U']}>{' '.repeat(sw)}</Text>
  ))
}

function drawNet(surface: ClientSurface<State>, cube: Cube): RenderElement[] {
  const { Box, Text } = surface.elements
  const { sw, sh } = geometry(surface.columns)
  const gap = <Text> </Text>
  const pad = <Text>{' '.repeat(sw * 3 + 1)}</Text>
  const out: RenderElement[] = []
  const repeat = (make: () => RenderElement) => {
    for (let i = 0; i < sh; i++) out.push(make())
  }
  // Face order in `cube`: U0 R1 F2 D3 L4 B5. Net: U above F; L F R B across; D below F.
  for (let r = 0; r < 3; r++) repeat(() => <Box flexDirection="row">{pad}{faceRow(surface, cube, 0, r, sw)}</Box>)
  out.push(<Text> </Text>)
  for (let r = 0; r < 3; r++) {
    repeat(() => (
      <Box flexDirection="row">
        {faceRow(surface, cube, 4, r, sw)}{gap}{faceRow(surface, cube, 2, r, sw)}{gap}
        {faceRow(surface, cube, 1, r, sw)}{gap}{faceRow(surface, cube, 5, r, sw)}
      </Box>
    ))
  }
  out.push(<Text> </Text>)
  for (let r = 0; r < 3; r++) repeat(() => <Box flexDirection="row">{pad}{faceRow(surface, cube, 3, r, sw)}</Box>)
  return out
}

function clockText(s: State): string {
  if (s.finishedMs !== null) return `Time ${formatMs(s.finishedMs)}`
  if (s.startedAt !== null && s.scrambledWith.length > 0) return `Time ${formatMs(s.now - s.startedAt)}`
  return s.scrambledWith.length > 0 ? 'Time 0.00 (starts on first turn)' : 'Press Scramble to start a timed solve'
}

const CubeBoard: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text, Button } = surface.elements
  let s = surface.state
  if (!s) {
    const saved = readSave(props.saved)
    const resumed = saved.startedAt !== null ? 'Solve resumed. The clock kept running while you were away.' : ''
    s = { ...saved, now: Date.now(), finishedMs: null, showAlgs: false, note: resumed, lastResult: null }
    surface.every(100, () => {
      const cur = surface.state
      if (cur && cur.startedAt !== null && cur.finishedMs === null && cur.scrambledWith.length > 0) {
        surface.setState({ ...cur, now: Date.now() })
      }
    })
    surface.onKey(e => onKey(surface, e.key, e.shift === true, e.ctrl === true || e.meta === true))
    surface.setState(s)
  }
  const state = s
  // A press acts on the state as it is when pressed: the clock ticks between draws.
  const act = (fn: (cur: State) => State) => () => {
    const cur = surface.state
    if (cur) surface.setState(fn(cur))
  }

  return (
    <Box flexDirection="column">
      {drawNet(surface, state.cube)}
      <Text bold>{clockText(state)}  <Text dimColor>{`${state.moves} turns`}</Text></Text>
      {state.note !== '' && <Text>{state.note}</Text>}
      {state.scrambledWith.length > 0 && <Text dimColor>{`Scramble: ${state.scrambledWith.join(' ')}`}</Text>}
      {TURN_ROWS.map(row => (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {row.map(m => (
            <Button key={`cube-turn-${m}`} onPress={act(cur => doTurns(surface, cur, m))}>{m}</Button>
          ))}
        </Box>
      ))}
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="cube-scramble" variant="primary" onPress={act(cur => doScramble(surface, cur))}>Scramble</Button>
        <Button key="cube-undo" onPress={act(cur => doUndo(surface, cur))}>Undo</Button>
        <Button key="cube-reset" onPress={act(cur => doReset(surface, cur))}>Reset</Button>
        <Button key="cube-algs" onPress={act(cur => ({ ...cur, showAlgs: !cur.showAlgs }))}>
          {state.showAlgs ? 'Hide algorithms' : 'Algorithms'}
        </Button>
      </Box>
      {state.showAlgs && (
        <Box flexDirection="column">
          {ALGS.map(a => (
            <Button key={`cube-alg-${a.name}`} plain onPress={act(cur => doTurns(surface, cur, a.alg))}>
              {a.name}  <Text dimColor>{`${a.alg}  (x${a.order} = back to start)`}</Text>
            </Button>
          ))}
        </Box>
      )}
      <Text dimColor>Keys: u d r l f b m x y z turn, Shift for prime, Space scramble, Backspace undo.</Text>
    </Box>
  )
}

export default CubeBoard
