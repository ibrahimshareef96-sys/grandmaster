// The runner: the mascot runs, bugs come at him, he jumps them. Pure and
// deterministic: one `step` per frame, randomness from a seed in the state.
// Units are pixels; on a terminal one pixel is half a character cell.

export type Obstacle = { x: number; w: number; h: number }

export type Phase = 'ready' | 'running' | 'over'

export type Runner = {
  phase: Phase
  tick: number
  /** Height of the mascot's feet above the ground. */
  y: number
  vy: number
  speed: number
  distance: number
  obstacles: Obstacle[]
  nextGap: number
  seed: number
  /** Frames left on a jump pressed in the air: it fires on landing, so an early press is not lost. */
  buffer: number
}

export const WIDTH = 64
// Tall enough that the mascot's head stays in the field at the top of a jump.
export const HEIGHT = 30
/** How long after a crash input is ignored, so a jump mashed at the crash does not restart the run unseen. */
export const RESTART_DELAY_MS = 600
const BUFFER_FRAMES = 3
// The climb speed a released jump is cut to: still clears the low bugs.
const RELEASE_SPEED = 2.6
export const GROUND = 2
export const MASCOT_X = 4
// The mascot drawn at half size is 10 by 12 pixels; the hitbox is a little
// smaller so a graze does not end the run.
const HIT = { left: 3, right: 8, top: 11 }
const GRAVITY = 0.9
const JUMP_SPEED = 4.8
// Slower than this and the widest bug cannot be cleared in one jump.
const START_SPEED = 1.6
const MAX_SPEED = 3.2
const ACCEL = 0.0015

const KINDS: readonly Obstacle[] = [
  { x: 0, w: 3, h: 4 },
  { x: 0, w: 2, h: 7 },
  { x: 0, w: 6, h: 4 },
  { x: 0, w: 4, h: 6 },
]

/** One number from the seed: mulberry32, returning the value and the next seed. */
export function nextRandom(seed: number): [number, number] {
  const s = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s]
}

export const newRun = (seed: number): Runner => ({
  phase: 'ready', tick: 0, y: 0, vy: 0, speed: START_SPEED, distance: 0, obstacles: [], nextGap: 40, seed, buffer: 0,
})

export const score = (r: Runner) => Math.floor(r.distance / 4)

/** Starts a run from ready, jumps while running (on landing, if pressed in the air), restarts after a crash. */
export function jump(r: Runner): Runner {
  if (r.phase === 'ready') return { ...r, phase: 'running', vy: JUMP_SPEED }
  if (r.phase === 'over') return { ...newRun(r.seed), phase: 'running' }
  return r.y === 0 ? { ...r, vy: JUMP_SPEED, buffer: 0 } : { ...r, buffer: BUFFER_FRAMES }
}

/** Letting go of jump early cuts the climb short: a tap hops, a hold leaps. */
export function release(r: Runner): Runner {
  return r.phase === 'running' && r.vy > RELEASE_SPEED ? { ...r, vy: RELEASE_SPEED } : r
}

export function hits(r: Runner, o: Obstacle): boolean {
  return MASCOT_X + HIT.left < o.x + o.w && o.x < MASCOT_X + HIT.right && r.y < o.h && o.h > 0 && r.y + HIT.top > 0
}

/** Advances the run one frame. */
export function step(r: Runner): Runner {
  if (r.phase !== 'running') return r
  const vy = r.vy - GRAVITY
  const y = Math.max(0, r.y + r.vy)
  const landed = y === 0
  const speed = Math.min(MAX_SPEED, r.speed + ACCEL)
  let seed = r.seed
  let obstacles = r.obstacles.map(o => ({ ...o, x: o.x - speed })).filter(o => o.x + o.w > 0)
  let nextGap = r.nextGap - speed
  if (nextGap <= 0) {
    const [pick, s1] = nextRandom(seed)
    const [gap, s2] = nextRandom(s1)
    seed = s2
    const kind = KINDS[Math.floor(pick * KINDS.length)] ?? KINDS[0]
    if (kind) obstacles = [...obstacles, { ...kind, x: WIDTH }]
    // Gaps grow with speed so every pair stays clearable in one jump each.
    nextGap = 26 + speed * 8 + gap * 30
  }
  // A jump pressed just before landing fires the moment the feet touch down.
  const buffered = landed && r.buffer > 0
  const next: Runner = {
    ...r, tick: r.tick + 1, y, vy: buffered ? JUMP_SPEED : landed ? 0 : vy, speed,
    distance: r.distance + speed, obstacles, nextGap, seed, buffer: buffered ? 0 : Math.max(0, r.buffer - 1),
  }
  return obstacles.some(o => hits(next, o)) ? { ...next, phase: 'over' } : next
}

/** Reads a stored best score. */
export const readBest = (raw: unknown): number =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0
