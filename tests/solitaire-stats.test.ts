import { describe, expect, test } from 'claude-code/testing'

import {
  autoPlay,
  canFinish,
  canStack,
  deal,
  draw,
  isWon,
  move,
  readKlondike,
  type Klondike,
} from '../hooks/solitaire-engine'
import { EMPTY_STATS, addResult, averageOfFive, nextRating, readResult, readStats } from '../hooks/stats'

let seed = 42
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const card = (rank: number, suit: number) => suit * 13 + rank - 1
const allCards = (g: Klondike) => [
  ...g.stock, ...g.waste, ...g.foundations.flat(), ...g.tableau.flatMap(c => [...c.down, ...c.up]),
]

describe('Klondike', () => {
  test('a deal lays 28 cards in seven columns and 24 in the stock, each card once', async () => {
    const g = deal(random)
    expect(g.tableau.map(c => c.down.length)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(g.tableau.every(c => c.up.length === 1)).toBe(true)
    expect(g.stock.length).toBe(24)
    expect(new Set(allCards(g)).size).toBe(52)
  })

  test('drawing turns cards to the waste and recycles an empty stock', async () => {
    const g = deal(random, 3)
    const once = draw(g)
    expect(once.waste.length).toBe(3)
    let all = g
    for (let i = 0; i < 8; i++) all = draw(all)
    expect(all.stock.length).toBe(0)
    expect(draw(all).stock.length).toBe(24)
    expect(draw(all).stock).toEqual(g.stock)
  })

  test('stacking needs alternating colours one rank down; an empty column takes a king', async () => {
    expect(canStack(card(6, 1), card(7, 0))).toBe(true) // red 6 on black 7
    expect(canStack(card(6, 0), card(7, 3))).toBe(false) // black on black
    expect(canStack(card(5, 1), card(7, 0))).toBe(false)
    expect(canStack(card(13, 2), undefined)).toBe(true)
    expect(canStack(card(12, 2), undefined)).toBe(false)
  })

  test('moving a run flips the card it uncovers, and bad moves are refused', async () => {
    const g: Klondike = {
      stock: [], waste: [], foundations: [[], [], [], []], drawCount: 1, moves: 0,
      tableau: [
        { down: [card(2, 0)], up: [card(7, 1), card(6, 0)] },
        { down: [], up: [card(8, 3)] },
        { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] },
      ],
    }
    const moved = move(g, { kind: 'tableau', col: 0, index: 0 }, { kind: 'tableau', col: 1 })
    expect(moved?.tableau[1]?.up).toEqual([card(8, 3), card(7, 1), card(6, 0)])
    expect(moved?.tableau[0]).toEqual({ down: [], up: [card(2, 0)] })
    expect(move(g, { kind: 'tableau', col: 1, index: 0 }, { kind: 'tableau', col: 0 })).toBe(null)
    expect(move(g, { kind: 'tableau', col: 0, index: 1 }, { kind: 'foundation', pile: 0 })).toBe(null)
  })

  test('a spent stock with every card face up plays itself out to a win', async () => {
    const piles = [0, 1, 2, 3].map(s => Array.from({ length: 13 }, (_, r) => card(13 - r, s)))
    const g: Klondike = {
      stock: [], waste: [], foundations: [[], [], [], []], drawCount: 1, moves: 0,
      tableau: [...piles.map(up => ({ down: [], up })), { down: [], up: [] }, { down: [], up: [] }, { down: [], up: [] }],
    }
    expect(canFinish(g)).toBe(true)
    expect(isWon(autoPlay(g))).toBe(true)
  })

  test('a stored game must hold all 52 cards exactly once', async () => {
    const g = deal(random)
    expect(readKlondike(JSON.parse(JSON.stringify(g)))).toEqual(g)
    expect(readKlondike({ ...g, stock: [...g.stock.slice(1), g.stock[2]] })).toBe(null)
    expect(readKlondike({ ...g, tableau: g.tableau.slice(1) })).toBe(null)
    expect(readKlondike(null)).toBe(null)
  })
})

describe('progress record', () => {
  test('a win against a stronger level gains more than one against a weaker', async () => {
    expect(nextRating(800, 2, 1) - 800).toBeGreaterThan(nextRating(800, 0, 1) - 800)
    expect(nextRating(800, 0, 0.5)).toBe(800)
  })

  test('the average of five drops the best and worst', async () => {
    expect(averageOfFive([10, 20, 30, 40, 1000])).toBe(30)
    expect(averageOfFive([10, 20])).toBe(null)
  })

  test('results add to the record; junk is ignored', async () => {
    let s = EMPTY_STATS
    const posts = [
      { type: 'result', game: 'chess', result: 'win', level: 1 },
      { type: 'result', game: 'cube', ms: 42000 },
      { type: 'result', game: 'cube', ms: 30000 },
      { type: 'result', game: 'solitaire', result: 'win', ms: 120000 },
      { type: 'result', game: 'solitaire', result: 'abandoned', ms: 5000 },
      { type: 'result', game: 'chess', result: 'mate' },
      { type: 'save', game: 'chess' },
      'nonsense',
    ]
    for (const p of posts) {
      const r = readResult(p)
      if (r) s = addResult(s, r)
    }
    expect(s.chess.wins).toBe(1)
    expect(s.chess.rating).toBeGreaterThan(800)
    expect(s.cube).toEqual({ solves: 2, bestMs: 30000, recentMs: [42000, 30000] })
    expect(s.solitaire).toEqual({ wins: 1, played: 2, bestMs: 120000 })
  })

  test('a damaged stored record reads back as a usable one', async () => {
    expect(readStats('garbage')).toEqual(EMPTY_STATS)
    expect(readStats({ chess: { wins: -3, rating: 'x' }, cube: { recentMs: [1, 'a', 2] } }).cube.recentMs).toEqual([1, 2])
  })
})
