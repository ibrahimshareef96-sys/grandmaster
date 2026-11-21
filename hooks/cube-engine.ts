// A 3x3 Rubik's Cube as 54 stickers. Every turn is derived by rotating each
// sticker's position and normal in 3D, so no permutation table is hand-typed.

export type Face = 'U' | 'R' | 'F' | 'D' | 'L' | 'B'
export const FACES: readonly Face[] = ['U', 'R', 'F', 'D', 'L', 'B']

/** Stickers in face order U R F D L B, each face's 9 read row by row as seen from outside. */
export type Cube = readonly Face[]

export type Vec = readonly [number, number, number]

// x right, y up, z towards the viewer (front). For each face: its normal and
// where row r, column c (0..2) of its 3x3 sits.
const FRAMES: Record<Face, { n: Vec; pos: (r: number, c: number) => Vec }> = {
  U: { n: [0, 1, 0], pos: (r, c) => [c - 1, 1, r - 1] },
  R: { n: [1, 0, 0], pos: (r, c) => [1, 1 - r, 1 - c] },
  F: { n: [0, 0, 1], pos: (r, c) => [c - 1, 1 - r, 1] },
  D: { n: [0, -1, 0], pos: (r, c) => [c - 1, -1, 1 - r] },
  L: { n: [-1, 0, 0], pos: (r, c) => [-1, 1 - r, c - 1] },
  B: { n: [0, 0, -1], pos: (r, c) => [1 - c, 1 - r, -1] },
}

export type Sticker = { p: Vec; n: Vec }

/** Where sticker i sits: its cubie's position and the way it faces. A 3D view
 *  paints sticker i from `cube[i]` at this place. */
export const STICKERS: readonly Sticker[] = FACES.flatMap(f =>
  Array.from({ length: 9 }, (_, i) => ({ p: FRAMES[f].pos(Math.floor(i / 3), i % 3), n: FRAMES[f].n })),
)

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
/** Quarter turn clockwise as seen looking at the axis tip: -90 degrees about `axis`. */
const quarter = (v: Vec, axis: Vec): Vec => {
  const c = cross(axis, v)
  const d = dot(axis, v)
  return [-c[0] + axis[0] * d, -c[1] + axis[1] * d, -c[2] + axis[2] * d]
}
const same = (a: Vec, b: Vec) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
const indexOf = (s: Sticker) => STICKERS.findIndex(t => same(t.p, s.p) && same(t.n, s.n))

// Each base turn: the axis it turns about (clockwise looking from that side)
// and which layers along that axis move.
/** Each base turn: a quarter turn of -90 degrees about `axis` of the stickers
 *  whose position along `axis` is in `layers`. A 3D view animates exactly this. */
export const TURNS: Readonly<Record<string, { axis: Vec; layers: readonly number[] }>> = {
  U: { axis: [0, 1, 0], layers: [1] },
  D: { axis: [0, -1, 0], layers: [1] },
  R: { axis: [1, 0, 0], layers: [1] },
  L: { axis: [-1, 0, 0], layers: [1] },
  F: { axis: [0, 0, 1], layers: [1] },
  B: { axis: [0, 0, -1], layers: [1] },
  M: { axis: [-1, 0, 0], layers: [0] }, // as L
  E: { axis: [0, -1, 0], layers: [0] }, // as D
  S: { axis: [0, 0, 1], layers: [0] }, // as F
  x: { axis: [1, 0, 0], layers: [-1, 0, 1] }, // as R, whole cube
  y: { axis: [0, 1, 0], layers: [-1, 0, 1] }, // as U
  z: { axis: [0, 0, 1], layers: [-1, 0, 1] }, // as F
}

/** For each base turn, `perm[i]` is where sticker i goes after one quarter turn. */
const PERMS: Record<string, readonly number[]> = Object.fromEntries(
  Object.entries(TURNS).map(([name, { axis, layers }]) => [
    name,
    STICKERS.map((s, i) => {
      if (!layers.includes(dot(s.p, axis))) return i
      const to = indexOf({ p: quarter(s.p, axis), n: quarter(s.n, axis) })
      if (to < 0) throw new Error(`cube: turn ${name} lost sticker ${i}`)
      return to
    }),
  ]),
)

export const BASE_TURNS = Object.keys(TURNS)

/** Well-known algorithms; each returns the cube to where it started when repeated `order` times. */
export const ALGS: ReadonlyArray<{ name: string; alg: string; order: number }> = [
  { name: 'Sexy move', alg: "R U R' U'", order: 6 },
  { name: 'Sledgehammer', alg: "R' F R F'", order: 6 },
  { name: 'Edge flip (OLL)', alg: "F R U R' U' F'", order: 6 },
  { name: 'Sune (OLL)', alg: "R U R' U R U2 R'", order: 6 },
  { name: 'Anti-Sune (OLL)', alg: "R U2 R' U' R U' R'", order: 6 },
  { name: 'Ua perm (PLL)', alg: "R U' R U R U R U' R' U' R2", order: 3 },
  { name: 'T perm (PLL)', alg: "R U R' U' R' F R2 U' R' U' R U R' F'", order: 2 },
]

export const solved = (): Cube => FACES.flatMap(f => Array<Face>(9).fill(f))

/** A move in standard notation: a base turn, then nothing, `'` or `2`. */
export function parseMove(move: string): { base: string; times: number } | null {
  const m = /^([UDRLFBMESxyz])(['2]?)$/.exec(move.trim())
  const base = m?.[1]
  if (!m || !base) return null
  return { base, times: m[2] === "'" ? 3 : m[2] === '2' ? 2 : 1 }
}

export function turn(cube: Cube, move: string): Cube {
  const parsed = parseMove(move)
  if (!parsed) return cube
  const perm = PERMS[parsed.base]
  if (!perm) return cube
  let out = cube
  for (let t = 0; t < parsed.times; t++) {
    const prev = out
    const next = [...prev]
    perm.forEach((to, from) => {
      next[to] = prev[from] as Face
    })
    out = next
  }
  return out
}

/** Applies a space-separated algorithm such as `R U R' U'`. Unknown tokens are skipped. */
export const apply = (cube: Cube, alg: string): Cube =>
  alg.split(/\s+/).filter(Boolean).reduce(turn, cube)

/** Solved means every face shows one colour (any orientation of the whole cube). */
export const isSolved = (cube: Cube): boolean =>
  FACES.every((_, f) => cube.slice(f * 9, f * 9 + 9).every(s => s === cube[f * 9 + 4]))

/** A random-move scramble of `length` face turns, no face turned twice in a row
 *  and no three turns in a row on one axis. */
export function scramble(random: () => number, length = 20): string[] {
  const faces = ['U', 'D', 'R', 'L', 'F', 'B']
  const axis = (f: string) => 'UDRLFB'.indexOf(f) >> 1
  const out: string[] = []
  while (out.length < length) {
    const f = faces[Math.floor(random() * 6)] ?? 'U'
    const prev = out[out.length - 1]?.[0]
    const prev2 = out[out.length - 2]?.[0]
    if (f === prev) continue
    if (prev && prev2 && axis(f) === axis(prev) && axis(prev) === axis(prev2)) continue
    out.push(f + (['', "'", '2'][Math.floor(random() * 3)] ?? ''))
  }
  return out
}

/** Reads a cube handed in from storage; null when it is not 54 known stickers
 *  with nine of each colour. */
export function readCube(raw: unknown): Cube | null {
  if (!Array.isArray(raw) || raw.length !== 54) return null
  if (!raw.every(s => typeof s === 'string' && (FACES as readonly string[]).includes(s))) return null
  const counts = FACES.map(f => raw.filter(s => s === f).length)
  return counts.every(n => n === 9) ? (raw as Face[]) : null
}
