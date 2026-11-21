// Progress across sessions: what a finished game adds to the record.
import type { Stats } from '../types'
import { LEVELS } from './chess-ai'

export const EMPTY_STATS: Stats = {
  chess: { wins: 0, losses: 0, draws: 0, rating: 800 },
  cube: { solves: 0, bestMs: null, recentMs: [] },
  solitaire: { wins: 0, played: 0, bestMs: null },
  runner: { runs: 0, best: 0 },
}

const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0)
const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

/** Reads stats from storage, filling anything missing or malformed with a fresh value. */
export function readStats(raw: unknown): Stats {
  const r = obj(raw)
  const chess = obj(r.chess)
  const cube = obj(r.cube)
  const sol = obj(r.solitaire)
  const run = obj(r.runner)
  const rating = typeof chess.rating === 'number' && Number.isFinite(chess.rating) ? chess.rating : 800
  return {
    chess: { wins: count(chess.wins), losses: count(chess.losses), draws: count(chess.draws), rating },
    cube: {
      solves: count(cube.solves),
      bestMs: ms(cube.bestMs),
      recentMs: Array.isArray(cube.recentMs) ? cube.recentMs.map(ms).filter((n): n is number => n !== null).slice(-5) : [],
    },
    solitaire: { wins: count(sol.wins), played: count(sol.played), bestMs: ms(sol.bestMs) },
    runner: { runs: count(run.runs), best: count(run.best) },
  }
}

/** Elo with K = 32 against the level's nominal rating. */
export function nextRating(rating: number, level: number, score: 0 | 0.5 | 1): number {
  const opponent = LEVELS[level]?.rating ?? LEVELS[1].rating
  const expected = 1 / (1 + 10 ** ((opponent - rating) / 400))
  return Math.round(rating + 32 * (score - expected))
}

/** The average of five: the mean of the middle three, as competitions count it. */
export function averageOfFive(times: readonly number[]): number | null {
  if (times.length < 5) return null
  const middle = [...times.slice(-5)].sort((a, b) => a - b).slice(1, 4)
  return middle.reduce((a, b) => a + b, 0) / 3
}

export type GameResult =
  | { game: 'chess'; result: 'win' | 'loss' | 'draw'; level: number }
  | { game: 'cube'; ms: number }
  | { game: 'solitaire'; result: 'win' | 'abandoned'; ms: number }
  | { game: 'runner'; score: number }

/** Checks a result a board posted; null for anything else. */
export function readResult(data: unknown): GameResult | null {
  const d = obj(data)
  if (d.type !== 'result') return null
  if (d.game === 'chess' && (d.result === 'win' || d.result === 'loss' || d.result === 'draw')) {
    const level = Number.isInteger(d.level) && (d.level as number) >= 0 && (d.level as number) < LEVELS.length ? (d.level as number) : 1
    return { game: 'chess', result: d.result, level }
  }
  const time = ms(d.ms)
  if (d.game === 'cube' && time !== null) return { game: 'cube', ms: time }
  if (d.game === 'solitaire' && (d.result === 'win' || d.result === 'abandoned')) {
    return { game: 'solitaire', result: d.result, ms: time ?? 0 }
  }
  // A run's score is distance, so it has a sane ceiling: hours of play at top speed.
  if (d.game === 'runner' && Number.isInteger(d.score) && (d.score as number) >= 0 && (d.score as number) < 10_000_000) {
    return { game: 'runner', score: d.score as number }
  }
  return null
}

export function addResult(stats: Stats, r: GameResult): Stats {
  if (r.game === 'chess') {
    const c = stats.chess
    const score = r.result === 'win' ? 1 : r.result === 'draw' ? 0.5 : 0
    return {
      ...stats,
      chess: {
        wins: c.wins + (r.result === 'win' ? 1 : 0),
        losses: c.losses + (r.result === 'loss' ? 1 : 0),
        draws: c.draws + (r.result === 'draw' ? 1 : 0),
        rating: nextRating(c.rating, r.level, score),
      },
    }
  }
  if (r.game === 'cube') {
    const c = stats.cube
    return {
      ...stats,
      cube: { solves: c.solves + 1, bestMs: c.bestMs === null ? r.ms : Math.min(c.bestMs, r.ms), recentMs: [...c.recentMs, r.ms].slice(-5) },
    }
  }
  if (r.game === 'runner') {
    return { ...stats, runner: { runs: stats.runner.runs + 1, best: Math.max(stats.runner.best, r.score) } }
  }
  const s = stats.solitaire
  const won = r.result === 'win'
  return {
    ...stats,
    solitaire: {
      wins: s.wins + (won ? 1 : 0),
      played: s.played + 1,
      bestMs: won && r.ms > 0 ? (s.bestMs === null ? r.ms : Math.min(s.bestMs, r.ms)) : s.bestMs,
    },
  }
}
