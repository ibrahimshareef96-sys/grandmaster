// Chess rules: board, legal moves, game end, SAN. Pure data, no engine calls.
// Squares are 0..63, index = row * 8 + col, row 0 is rank 8, col 0 is file a.

export type Side = 'w' | 'b'

export type Move = {
  from: number
  to: number
  promo?: 'q' | 'r' | 'b' | 'n'
  flag?: 'ep' | 'castle' | 'double'
}

export type Position = {
  board: readonly string[]
  turn: Side
  castling: string
  ep: number
  half: number
  full: number
}

export const START_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const FILES = 'abcdefgh'
type Dir = readonly [number, number]
const KNIGHT: readonly Dir[] = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
const KING: readonly Dir[] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
const ORTHO: readonly Dir[] = [[-1, 0], [1, 0], [0, -1], [0, 1]]
const DIAG: readonly Dir[] = [[-1, -1], [-1, 1], [1, -1], [1, 1]]

export const sideOf = (p: string): Side | null =>
  p === '' ? null : p === p.toUpperCase() ? 'w' : 'b'

const other = (s: Side): Side => (s === 'w' ? 'b' : 'w')
/** The piece on `sq`, '' for an empty square or one off the board. */
export const pieceAt = (board: readonly string[], sq: number): string => board[sq] ?? ''
const onBoard = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8
const at = (r: number, c: number) => r * 8 + c

export const squareName = (sq: number) =>
  `${FILES[sq % 8]}${8 - Math.floor(sq / 8)}`

export function parseFen(fen: string): Position | null {
  const parts = fen.trim().split(/\s+/)
  const [placement = '', turnField = '', castleField = '-', epField = '-', halfField, fullField] = parts
  if (parts.length < 4) return null
  const rows = placement.split('/')
  if (rows.length !== 8) return null
  const board: string[] = []
  for (const row of rows) {
    for (const ch of row) {
      if (/[1-8]/.test(ch)) for (let i = 0; i < Number(ch); i++) board.push('')
      else if (/[prnbqkPRNBQK]/.test(ch)) board.push(ch)
      else return null
    }
    if (board.length % 8 !== 0) return null
  }
  if (board.length !== 64) return null
  const turn = turnField === 'b' ? 'b' : turnField === 'w' ? 'w' : null
  if (!turn) return null
  const castling = castleField === '-' ? '' : castleField.replace(/[^KQkq]/g, '')
  let ep = -1
  if (epField !== '-') {
    const f = FILES.indexOf(epField[0] ?? '')
    const r = Number(epField[1])
    if (f < 0 || !(r >= 1 && r <= 8) || epField.length !== 2) return null
    ep = at(8 - r, f)
  }
  const half = Number(halfField ?? 0)
  const full = Number(fullField ?? 1)

  return {
    board,
    turn,
    castling,
    ep,
    half: Number.isFinite(half) && half >= 0 ? half : 0,
    full: Number.isFinite(full) && full >= 1 ? full : 1,
  }
}

export function toFen(pos: Position): string {
  const rows: string[] = []
  for (let r = 0; r < 8; r++) {
    let row = ''
    let empty = 0
    for (let c = 0; c < 8; c++) {
      const p = pieceAt(pos.board, at(r, c))
      if (p === '') empty++
      else {
        if (empty) row += String(empty)
        empty = 0
        row += p
      }
    }
    if (empty) row += String(empty)
    rows.push(row)
  }
  const ep = pos.ep < 0 ? '-' : squareName(pos.ep)

  return `${rows.join('/')} ${pos.turn} ${pos.castling || '-'} ${ep} ${pos.half} ${pos.full}`
}

/** True when `by` attacks square `sq` on `board`. */
export function isAttacked(board: readonly string[], sq: number, by: Side): boolean {
  const r = Math.floor(sq / 8)
  const c = sq % 8
  const own = (p: string) => sideOf(p) === by
  const pawnRow = by === 'w' ? r + 1 : r - 1
  const pawn = by === 'w' ? 'P' : 'p'
  for (const dc of [-1, 1]) {
    if (onBoard(pawnRow, c + dc) && pieceAt(board, at(pawnRow, c + dc)) === pawn) return true
  }
  for (const [dr, dc] of KNIGHT) {
    const p = onBoard(r + dr, c + dc) ? pieceAt(board, at(r + dr, c + dc)) : ''
    if (own(p) && p.toLowerCase() === 'n') return true
  }
  for (const [dr, dc] of KING) {
    const p = onBoard(r + dr, c + dc) ? pieceAt(board, at(r + dr, c + dc)) : ''
    if (own(p) && p.toLowerCase() === 'k') return true
  }
  const ray = (dirs: readonly Dir[], kinds: string) => {
    for (const [dr, dc] of dirs) {
      let rr = r + dr
      let cc = c + dc
      while (onBoard(rr, cc)) {
        const p = pieceAt(board, at(rr, cc))
        if (p !== '') {
          if (own(p) && kinds.includes(p.toLowerCase())) return true
          break
        }
        rr += dr
        cc += dc
      }
    }
    return false
  }

  return ray(ORTHO, 'rq') || ray(DIAG, 'bq')
}

export function kingSquare(board: readonly string[], side: Side): number {
  return board.indexOf(side === 'w' ? 'K' : 'k')
}

export function inCheck(pos: Position, side: Side = pos.turn): boolean {
  const k = kingSquare(pos.board, side)

  return k >= 0 && isAttacked(pos.board, k, other(side))
}

function pawnMoves(pos: Position, sq: number, out: Move[]) {
  const white = pos.turn === 'w'
  const r = Math.floor(sq / 8)
  const c = sq % 8
  const dir = white ? -1 : 1
  const lastRow = white ? 0 : 7
  const push = (to: number, flag?: Move['flag']) => {
    if (Math.floor(to / 8) === lastRow) {
      for (const promo of ['q', 'r', 'b', 'n'] as const) out.push({ from: sq, to, promo })
    } else out.push(flag ? { from: sq, to, flag } : { from: sq, to })
  }
  if (onBoard(r + dir, c) && pieceAt(pos.board, at(r + dir, c)) === '') {
    push(at(r + dir, c))
    const startRow = white ? 6 : 1
    if (r === startRow && pieceAt(pos.board, at(r + 2 * dir, c)) === '') {
      push(at(r + 2 * dir, c), 'double')
    }
  }
  for (const dc of [-1, 1]) {
    if (!onBoard(r + dir, c + dc)) continue
    const to = at(r + dir, c + dc)
    const target = pieceAt(pos.board, to)
    if (target !== '' && sideOf(target) !== pos.turn) push(to)
    else if (to === pos.ep) push(to, 'ep')
  }
}

function stepMoves(pos: Position, sq: number, dirs: readonly Dir[], slide: boolean, out: Move[]) {
  const r = Math.floor(sq / 8)
  const c = sq % 8
  for (const [dr, dc] of dirs) {
    let rr = r + dr
    let cc = c + dc
    while (onBoard(rr, cc)) {
      const target = pieceAt(pos.board, at(rr, cc))
      if (target === '') out.push({ from: sq, to: at(rr, cc) })
      else {
        if (sideOf(target) !== pos.turn) out.push({ from: sq, to: at(rr, cc) })
        break
      }
      if (!slide) break
      rr += dr
      cc += dc
    }
  }
}

function castleMoves(pos: Position, out: Move[]) {
  const white = pos.turn === 'w'
  const e = white ? 60 : 4
  const king = white ? 'K' : 'k'
  const rook = white ? 'R' : 'r'
  const enemy = other(pos.turn)
  if (pieceAt(pos.board, e) !== king || isAttacked(pos.board, e, enemy)) return
  const safeEmpty = (squares: number[], attackFree: number[]) =>
    squares.every(s => pieceAt(pos.board, s) === '') &&
    attackFree.every(s => !isAttacked(pos.board, s, enemy))
  if (pos.castling.includes(white ? 'K' : 'k') && pieceAt(pos.board, e + 3) === rook &&
      safeEmpty([e + 1, e + 2], [e + 1, e + 2])) {
    out.push({ from: e, to: e + 2, flag: 'castle' })
  }
  if (pos.castling.includes(white ? 'Q' : 'q') && pieceAt(pos.board, e - 4) === rook &&
      safeEmpty([e - 1, e - 2, e - 3], [e - 1, e - 2])) {
    out.push({ from: e, to: e - 2, flag: 'castle' })
  }
}

/** Moves that follow the piece rules, before the own-king-in-check filter. */
export function pseudoMoves(pos: Position): Move[] {
  const out: Move[] = []
  for (let sq = 0; sq < 64; sq++) {
    const p = pieceAt(pos.board, sq)
    if (sideOf(p) !== pos.turn) continue
    switch (p.toLowerCase()) {
      case 'p': pawnMoves(pos, sq, out); break
      case 'n': stepMoves(pos, sq, KNIGHT, false, out); break
      case 'b': stepMoves(pos, sq, DIAG, true, out); break
      case 'r': stepMoves(pos, sq, ORTHO, true, out); break
      case 'q': stepMoves(pos, sq, [...ORTHO, ...DIAG], true, out); break
      case 'k': stepMoves(pos, sq, KING, false, out); castleMoves(pos, out); break
    }
  }
  return out
}

const ROOK_HOMES: Record<number, string> = { 63: 'K', 56: 'Q', 7: 'k', 0: 'q' }

export function makeMove(pos: Position, m: Move): Position {
  const board = [...pos.board]
  const piece = pieceAt(board, m.from)
  const white = sideOf(piece) === 'w'
  const captured = pieceAt(board, m.to)
  board[m.to] = m.promo ? (white ? m.promo.toUpperCase() : m.promo) : piece
  board[m.from] = ''
  if (m.flag === 'ep') board[m.to + (white ? 8 : -8)] = ''
  if (m.flag === 'castle') {
    const [rf, rt] = m.to > m.from ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1]
    board[rt] = pieceAt(board, rf)
    board[rf] = ''
  }
  let castling = pos.castling
  if (piece === 'K') castling = castling.replace(/[KQ]/g, '')
  if (piece === 'k') castling = castling.replace(/[kq]/g, '')
  for (const sq of [m.from, m.to]) {
    const right = ROOK_HOMES[sq]
    if (right) castling = castling.replace(right, '')
  }
  const isPawn = piece.toLowerCase() === 'p'

  return {
    board,
    turn: other(pos.turn),
    castling,
    ep: m.flag === 'double' ? (m.from + m.to) / 2 : -1,
    half: isPawn || captured !== '' || m.flag === 'ep' ? 0 : pos.half + 1,
    full: pos.turn === 'b' ? pos.full + 1 : pos.full,
  }
}

export function legalMoves(pos: Position): Move[] {
  return pseudoMoves(pos).filter(m => !inCheck(makeMove(pos, m), pos.turn))
}

export const sameMove = (a: Move, b: Move) =>
  a.from === b.from && a.to === b.to && (a.promo ?? '') === (b.promo ?? '')

/** Whether the side to move has a legal en passant capture. */
function epMatters(pos: Position): boolean {
  if (pos.ep < 0) return false
  return legalMoves(pos).some(m => m.flag === 'ep')
}

/** The repetition key: what FIDE counts as the same position. The en passant
 *  square counts only when a capture there is possible. */
export const positionKey = (pos: Position) =>
  `${pos.board.map(p => p || '.').join('')} ${pos.turn} ${pos.castling} ${epMatters(pos) ? pos.ep : -1}`

function insufficient(board: readonly string[]): boolean {
  const pieces = board.filter(p => p !== '' && p.toLowerCase() !== 'k')
  if (pieces.length === 0) return true
  if (pieces.length === 1) return /[nbNB]/.test(pieces[0] ?? '')
  if (pieces.every(p => p.toLowerCase() === 'b')) {
    // Bishops all on one colour of square cannot mate.
    const colours = new Set<number>()
    board.forEach((p, sq) => {
      if (p.toLowerCase() === 'b') colours.add((Math.floor(sq / 8) + (sq % 8)) % 2)
    })
    return colours.size === 1
  }
  return false
}

export type Outcome =
  | { kind: 'playing' }
  | { kind: 'checkmate'; winner: Side }
  | { kind: 'draw'; reason: 'stalemate' | 'fifty-move rule' | 'repetition' | 'insufficient material' }

export function outcome(pos: Position, history: readonly string[] = []): Outcome {
  if (legalMoves(pos).length === 0) {
    return inCheck(pos) ? { kind: 'checkmate', winner: other(pos.turn) } : { kind: 'draw', reason: 'stalemate' }
  }
  if (pos.half >= 100) return { kind: 'draw', reason: 'fifty-move rule' }
  if (insufficient(pos.board)) return { kind: 'draw', reason: 'insufficient material' }
  const key = positionKey(pos)
  if (history.filter(k => k === key).length >= 3) return { kind: 'draw', reason: 'repetition' }
  return { kind: 'playing' }
}

/** Standard algebraic notation for a legal move `m` in `pos`. */
export function toSan(pos: Position, m: Move): string {
  const piece = pieceAt(pos.board, m.from)
  const kind = piece.toUpperCase()
  let san: string
  if (m.flag === 'castle') san = m.to > m.from ? 'O-O' : 'O-O-O'
  else {
    const capture = pieceAt(pos.board, m.to) !== '' || m.flag === 'ep'
    const dest = squareName(m.to)
    if (kind === 'P') {
      san = `${capture ? `${FILES[m.from % 8]}x` : ''}${dest}${m.promo ? `=${m.promo.toUpperCase()}` : ''}`
    } else {
      const rivals = legalMoves(pos).filter(o =>
        o.to === m.to && o.from !== m.from && pieceAt(pos.board, o.from) === piece)
      let dis = ''
      if (rivals.length > 0) {
        const sameFile = rivals.some(o => o.from % 8 === m.from % 8)
        const sameRank = rivals.some(o => Math.floor(o.from / 8) === Math.floor(m.from / 8))
        const name = squareName(m.from)
        dis = !sameFile ? name.slice(0, 1) : !sameRank ? name.slice(1) : name
      }
      san = `${kind}${dis}${capture ? 'x' : ''}${dest}`
    }
  }
  const after = makeMove(pos, m)
  if (inCheck(after)) san += legalMoves(after).length === 0 ? '#' : '+'
  return san
}
