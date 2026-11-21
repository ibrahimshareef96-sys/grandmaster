// The runner board: the mascot runs along the bottom, bugs scroll in, Space,
// the up arrow or a click jumps. Drawn in half-block cells, two pixels a cell.
import type { ClientModule, ClientSurface, JsonValue, RenderElement } from 'claude-code'

import { FRAMES, PALETTE, halve } from './mascot'
import { resultId } from './result-id'
import {
  GROUND, HEIGHT, MASCOT_X, RESTART_DELAY_MS, WIDTH, jump, newRun, readBest, score, step, type Runner,
} from './runner-engine'

type State = { run: Runner; best: number; newBest: boolean; overAt: number }
type Props = { saved?: JsonValue }

const FRAME_MS = 50
const SKY = '#101418'
const GROUND_COLOR = '#3a3f47'
const SPECK = '#59606b'
const BUG = '#e5484d'
const BUG_DARK = '#8f2a31'
const BUG_EYE = '#ffffff'
const SPRITES = {
  idle: halve(FRAMES.idle), walkA: halve(FRAMES.walk_a), walkB: halve(FRAMES.walk_b),
  think: halve(FRAMES.think), cheer: halve(FRAMES.cheer),
}

function sprite(s: State): string[] {
  if (s.run.phase === 'over') return s.newBest ? SPRITES.cheer : SPRITES.think
  if (s.run.phase === 'ready' || s.run.y > 0) return SPRITES.idle
  return Math.floor(s.run.tick / 3) % 2 === 0 ? SPRITES.walkA : SPRITES.walkB
}

/** The field as a grid of colours, row 0 at the top. */
function paint(s: State): string[][] {
  const grid = Array.from({ length: HEIGHT }, () => Array<string>(WIDTH).fill(SKY))
  const set = (x: number, y: number, color: string) => {
    const row = grid[y]
    if (row && x >= 0 && x < WIDTH) row[x] = color
  }
  const groundTop = HEIGHT - GROUND
  for (let x = 0; x < WIDTH; x++) {
    set(x, groundTop, GROUND_COLOR)
    // Specks on the ground move with the distance run, so running reads as running.
    if ((x + Math.floor(s.run.distance)) % 9 === 0) set(x, groundTop + 1, SPECK)
  }
  for (const o of s.run.obstacles) {
    const left = Math.round(o.x)
    for (let dx = 0; dx < o.w; dx++) {
      for (let dy = 0; dy < o.h; dy++) {
        const legs = dy === 0 && dx % 2 === 1
        set(left + dx, groundTop - 1 - dy, legs ? SKY : dy === o.h - 1 ? BUG_DARK : BUG)
      }
    }
    set(left, groundTop - o.h + 1, BUG_EYE)
  }
  const art = sprite(s)
  const feet = groundTop - 1 - Math.round(s.run.y)
  art.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      const key = line[col] ?? '.'
      if (key !== '.') set(MASCOT_X + col, feet - (art.length - 1) + row, PALETTE[key] ?? SKY)
    }
  })
  return grid
}

/** Two pixel rows a text row: the upper half block drawn in the top colour on the bottom colour. */
function toCells(surface: ClientSurface<State>, grid: string[][]): RenderElement[] {
  const { Box, Text } = surface.elements
  const rows: RenderElement[] = []
  for (let y = 0; y + 1 < grid.length; y += 2) {
    const top = grid[y] ?? []
    const bottom = grid[y + 1] ?? []
    const runs: RenderElement[] = []
    let x = 0
    while (x < WIDTH) {
      const t = top[x] ?? SKY
      const b = bottom[x] ?? SKY
      let end = x + 1
      while (end < WIDTH && top[end] === t && bottom[end] === b) end++
      runs.push(t === b
        ? <Text backgroundColor={b}>{' '.repeat(end - x)}</Text>
        : <Text color={t} backgroundColor={b}>{'▀'.repeat(end - x)}</Text>)
      x = end
    }
    rows.push(<Box flexDirection="row">{runs}</Box>)
  }
  return rows
}

function onJump(surface: ClientSurface<State>) {
  const s = surface.state
  if (!s) return
  // Keys mashed at the moment of the crash must not restart the run before it is seen.
  if (s.run.phase === 'over' && Date.now() - s.overAt < RESTART_DELAY_MS) return
  surface.setState({ ...s, run: jump(s.run), newBest: s.run.phase === 'over' ? false : s.newBest })
}

function onFrame(surface: ClientSurface<State>) {
  const s = surface.state
  if (!s || s.run.phase !== 'running') return
  const run = step(s.run)
  if (run.phase !== 'over') return surface.setState({ ...s, run })
  const points = score(run)
  const best = Math.max(s.best, points)
  // One post carries the save and the result, with an id so a resend counts once.
  surface.post({ type: 'save', game: 'runner', data: { best }, result: { score: points, id: resultId() } })
  surface.setState({ run, best, newBest: points > s.best, overAt: Date.now() })
}

function message(s: State): string {
  if (s.run.phase === 'ready') return 'Press Space, the up arrow or click to run. Jump the bugs.'
  if (s.run.phase === 'over') {
    return s.newBest ? `New best: ${score(s.run)}! Space to run again.` : `Caught by a bug at ${score(s.run)}. Space to run again.`
  }
  return 'Space, up arrow or click to jump.'
}

const RunnerBoard: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text, Button } = surface.elements
  let s = surface.state
  if (!s) {
    const saved = props.saved && typeof props.saved === 'object' && !Array.isArray(props.saved) ? props.saved : {}
    s = { run: newRun(Math.floor(Math.random() * 2 ** 31)), best: readBest((saved as Record<string, unknown>).best), newBest: false, overAt: 0 }
    surface.every(FRAME_MS, () => onFrame(surface))
    surface.onKey(e => {
      if (e.ctrl || e.meta) return
      // Not Enter: it also presses a focused Button, which would jump twice.
      if (e.key === ' ' || e.key === 'space' || e.key === 'up' || e.key === 'w') onJump(surface)
    })
    surface.onPointer(e => {
      if (e.type === 'down' && e.button !== 'right') onJump(surface)
    })
    surface.setState(s)
  }
  const state = s

  return (
    <Box flexDirection="column">
      <Text bold>
        {`Score ${String(score(state.run)).padStart(5, '0')}`}
        <Text dimColor>{`   Best ${String(state.best).padStart(5, '0')}`}</Text>
      </Text>
      {toCells(surface, paint(state))}
      <Text>{message(state)}</Text>
      <Box flexDirection="row" gap={1}>
        <Button key="runner-jump" variant="primary" onPress={() => onJump(surface)}>
          {state.run.phase === 'running' ? 'Jump' : state.run.phase === 'over' ? 'Run again' : 'Start'}
        </Button>
      </Box>
      <Text dimColor>Click the field first so it takes your keys.</Text>
    </Box>
  )
}

export default RunnerBoard
