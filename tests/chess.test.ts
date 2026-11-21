import { describe, expect, test } from 'claude-code/testing'

import {
  START_FEN,
  legalMoves,
  makeMove,
  outcome,
  parseFen,
  toFen,
  toSan,
  type Move,
  type Position,
} from '../hooks/chess-engine'
import { searchDepth } from '../hooks/chess-ai'

const pos = (fen: string): Position => {
  const p = parseFen(fen)
  if (!p) throw new Error(`bad fen ${fen}`)
  return p
}

function perft(p: Position, depth: number): number {
  if (depth === 0) return 1
  return legalMoves(p).reduce((n, m) => n + perft(makeMove(p, m), depth - 1), 0)
}

const sq = (name: string) => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0] ?? '')
const find = (p: Position, from: string, to: string): Move => {
  const m = legalMoves(p).find(x => x.from === sq(from) && x.to === sq(to))
  if (!m) throw new Error(`no move ${from}${to}`)
  return m
}

describe('chess rules', () => {
  // Published perft counts: any slip in castling, en passant, pins or
  // promotion changes these numbers.
  test('perft from the start', async () => {
    const start = pos(START_FEN)
    expect(perft(start, 1)).toBe(20)
    expect(perft(start, 2)).toBe(400)
    expect(perft(start, 3)).toBe(8902)
  })

  test('perft on Kiwipete (castling, en passant, promotions)', async () => {
    const kiwi = pos('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')
    expect(perft(kiwi, 1)).toBe(48)
    expect(perft(kiwi, 2)).toBe(2039)
  })

  test('perft on position 3 (en passant pins)', async () => {
    const p3 = pos('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1')
    expect(perft(p3, 1)).toBe(14)
    expect(perft(p3, 2)).toBe(191)
    expect(perft(p3, 3)).toBe(2812)
  })

  test('perft on position 4 (promotions under check)', async () => {
    const p4 = pos('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1')
    expect(perft(p4, 1)).toBe(6)
    expect(perft(p4, 2)).toBe(264)
  })

  test("fool's mate ends the game with Qh4#", async () => {
    let p = pos(START_FEN)
    for (const [a, b] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4']] as const) p = makeMove(p, find(p, a, b))
    const mate = find(p, 'd8', 'h4')
    expect(toSan(p, mate)).toBe('Qh4#')
    expect(outcome(makeMove(p, mate))).toEqual({ kind: 'checkmate', winner: 'b' })
  })

  test('stalemate, insufficient material and the fifty-move rule are draws', async () => {
    expect(outcome(pos('k7/8/1Q6/8/8/8/8/7K b - - 0 1'))).toEqual({ kind: 'draw', reason: 'stalemate' })
    expect(outcome(pos('k7/8/8/8/8/8/8/6NK w - - 0 1'))).toEqual({ kind: 'draw', reason: 'insufficient material' })
    expect(outcome(pos('k7/8/8/8/8/8/8/5RRK w - - 100 80'))).toEqual({ kind: 'draw', reason: 'fifty-move rule' })
  })

  test('castling and en passant read as SAN and round-trip through FEN', async () => {
    const castle = pos('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
    expect(toSan(castle, find(castle, 'e1', 'g1'))).toBe('O-O')
    expect(toSan(castle, find(castle, 'e1', 'c1'))).toBe('O-O-O')
    const after = makeMove(castle, find(castle, 'e1', 'g1'))
    expect(toFen(after)).toBe('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1')
    const ep = pos('k7/8/8/3pP3/8/8/8/K7 w - d6 0 1')
    expect(toSan(ep, find(ep, 'e5', 'd6'))).toBe('exd6')
  })

  test('SAN names the file when two knights can reach a square', async () => {
    const p = pos('k7/8/8/8/8/8/8/1N3N1K w - - 0 1')
    expect(toSan(p, find(p, 'b1', 'd2'))).toBe('Nbd2')
  })

  test('a malformed FEN is refused', async () => {
    expect(parseFen('not a fen')).toBe(null)
    expect(parseFen('8/8/8 w - - 0 1')).toBe(null)
    expect(parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1')).toBe(null)
  })
})

describe('chess engine', () => {
  test('finds a mate in one', async () => {
    const p = pos('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1')
    const found = searchDepth(p, 2, Date.now() + 5000)
    expect(found?.move.from).toBe(sq('a1'))
    expect(found?.move.to).toBe(sq('a8'))
  })

  test('takes a hanging queen', async () => {
    const p = pos('k7/8/8/3q4/4P3/8/8/K7 w - - 0 1')
    const found = searchDepth(p, 1, Date.now() + 5000)
    expect(found?.move.to).toBe(sq('d5'))
  })

  test('gives up cleanly when out of time', async () => {
    expect(searchDepth(pos(START_FEN), 6, Date.now() - 1)).toBe(null)
  })
})
