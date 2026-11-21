// The chess opponent: negamax with alpha-beta and a capture search, run one
// depth at a time so a caller can spread the thinking over several frames.
import {
  inCheck,
  makeMove,
  pieceAt,
  pseudoMoves,
  sideOf,
  type Move,
  type Position,
} from './chess-engine'

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }
const MATE = 100000

// Piece-square tables from White's side, row 0 = rank 8 (simplified
// evaluation tables, Tomasz Michniewski). Black reads them mirrored.
const PAWN = [
  0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
]
const KNIGHT = [
  -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
]
const BISHOP = [
  -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20,
]
const ROOK = [
  0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0,
]
const KING = [
  -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
]
const TABLE: Record<string, readonly number[]> = {
  p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: BISHOP, k: KING,
}

/** Score from the side to move's point of view, in centipawns. */
export function evaluate(pos: Position): number {
  let score = 0
  for (let sq = 0; sq < 64; sq++) {
    const p = pieceAt(pos.board, sq)
    if (p === '') continue
    const kind = p.toLowerCase()
    const white = sideOf(p) === 'w'
    const mirrored = white ? sq : (7 - Math.floor(sq / 8)) * 8 + (sq % 8)
    const v = valueOf(p) + (TABLE[kind]?.[mirrored] ?? 0)
    score += white ? v : -v
  }
  return pos.turn === 'w' ? score : -score
}

/** A piece's material worth; 0 for an empty square. */
const valueOf = (piece: string) => VALUE[piece.toLowerCase()] ?? 0

const victimValue = (pos: Position, m: Move) =>
  (m.flag === 'ep' ? 100 : valueOf(pieceAt(pos.board, m.to))) + (m.promo ? valueOf(m.promo) : 0)

/** Captures and promotions first, biggest prize for the smallest piece. */
function ordered(pos: Position, moves: Move[], first?: Move): Move[] {
  const score = (m: Move) => {
    if (first && m.from === first.from && m.to === first.to && m.promo === first.promo) return 1e9
    const prize = victimValue(pos, m)
    return prize ? prize * 10 - valueOf(pieceAt(pos.board, m.from)) : 0
  }
  return [...moves].sort((a, b) => score(b) - score(a))
}

class OutOfTime extends Error {}

type Budget = { deadline: number; nodes: number }

function tick(budget: Budget) {
  budget.nodes++
  if ((budget.nodes & 1023) === 0 && Date.now() > budget.deadline) throw new OutOfTime()
}

function quiesce(pos: Position, alpha: number, beta: number, budget: Budget, depth: number): number {
  tick(budget)
  const stand = evaluate(pos)
  if (stand >= beta || depth === 0) return stand
  let best = Math.max(alpha, stand)
  const mover = pos.turn
  const captures = pseudoMoves(pos).filter(m => victimValue(pos, m) > 0)
  for (const m of ordered(pos, captures)) {
    const child = makeMove(pos, m)
    if (inCheck(child, mover)) continue
    const score = -quiesce(child, -beta, -best, budget, depth - 1)
    if (score >= beta) return score
    if (score > best) best = score
  }
  return best
}

function negamax(pos: Position, depth: number, alpha: number, beta: number, ply: number, budget: Budget): number {
  tick(budget)
  if (depth === 0) return quiesce(pos, alpha, beta, budget, 4)
  const mover = pos.turn
  let best = -Infinity
  let legal = 0
  for (const m of ordered(pos, pseudoMoves(pos))) {
    const child = makeMove(pos, m)
    if (inCheck(child, mover)) continue
    legal++
    const score = -negamax(child, depth - 1, -beta, -Math.max(alpha, best), ply + 1, budget)
    if (score > best) best = score
    if (best >= beta) return best
  }
  if (legal === 0) return inCheck(pos) ? -MATE + ply : 0
  if (pos.half >= 100) return 0
  return best
}

export type SearchResult = { move: Move; score: number; depth: number }

/**
 * Searches `pos` to exactly `depth` plies, or returns null when `deadline`
 * (a `Date.now()` value) passes first. `first` is tried first.
 */
export function searchDepth(pos: Position, depth: number, deadline: number, first?: Move): SearchResult | null {
  const budget: Budget = { deadline, nodes: 0 }
  const mover = pos.turn
  let best: SearchResult | null = null
  try {
    for (const m of ordered(pos, pseudoMoves(pos), first)) {
      const child = makeMove(pos, m)
      if (inCheck(child, mover)) continue
      const alpha: number = best ? best.score : -Infinity
      const score: number = -negamax(child, depth - 1, -Infinity, -alpha, 1, budget)
      if (!best || score > best.score) best = { move: m, score, depth }
    }
  } catch (error: unknown) {
    if (error instanceof OutOfTime) return null
    throw error
  }
  return best
}

/** How each level plays: the deepest search it reaches and its blunder chance. */
export const LEVELS = [
  { name: 'Easy', depth: 1, blunder: 0.3, rating: 800 },
  { name: 'Club', depth: 2, blunder: 0.05, rating: 1200 },
  { name: 'Strong', depth: 4, blunder: 0, rating: 1600 },
] as const

/** Picks a move for `level` from a finished search, sometimes a weaker one. */
export function pickMove(pos: Position, result: SearchResult, level: number, random: () => number): Move {
  const chance = LEVELS[level]?.blunder ?? 0
  if (random() >= chance) return result.move
  const mover = pos.turn
  const legal = pseudoMoves(pos).filter(m => !inCheck(makeMove(pos, m), mover))
  return legal[Math.floor(random() * legal.length)] ?? result.move
}
