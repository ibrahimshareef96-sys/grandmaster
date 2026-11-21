// Klondike solitaire rules. Cards are 0..51: suit = floor(card / 13)
// (spades, hearts, diamonds, clubs), rank = card % 13 + 1 (ace 1 .. king 13).

export type Column = { down: number[]; up: number[] }

export type Klondike = {
  stock: number[]
  waste: number[]
  foundations: number[][]
  tableau: Column[]
  drawCount: 1 | 3
  moves: number
}

export type Source =
  | { kind: 'waste' }
  | { kind: 'tableau'; col: number; index: number }
  | { kind: 'foundation'; pile: number }

export type Target = { kind: 'tableau'; col: number } | { kind: 'foundation'; pile: number }

export const SUITS = ['♠', '♥', '♦', '♣']
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export const suitOf = (card: number) => Math.floor(card / 13)
export const rankOf = (card: number) => (card % 13) + 1
export const isRed = (card: number) => suitOf(card) === 1 || suitOf(card) === 2
export const cardLabel = (card: number) => `${RANKS[card % 13]}${SUITS[suitOf(card)]}`

const top = <T>(list: readonly T[]): T | undefined => list[list.length - 1]

export function deal(random: () => number, drawCount: 1 | 3 = 1): Klondike {
  // Fisher-Yates, building a new array rather than swapping in place.
  let deck = Array.from({ length: 52 }, (_, i) => i)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = deck[i] as number
    const b = deck[j] as number
    deck = deck.map((card, n) => (n === i ? b : n === j ? a : card))
  }
  const tableau: Column[] = []
  let k = 0
  for (let col = 0; col < 7; col++) {
    tableau.push({ down: deck.slice(k, k + col), up: deck.slice(k + col, k + col + 1) })
    k += col + 1
  }
  return { stock: deck.slice(k), waste: [], foundations: [[], [], [], []], tableau, drawCount, moves: 0 }
}

/** Turns cards from the stock to the waste, or turns the waste back over when the stock is empty. */
export function draw(g: Klondike): Klondike {
  if (g.stock.length === 0) {
    if (g.waste.length === 0) return g
    return { ...g, stock: [...g.waste].reverse(), waste: [], moves: g.moves + 1 }
  }
  const n = Math.min(g.drawCount, g.stock.length)
  const taken = g.stock.slice(g.stock.length - n).reverse()
  return { ...g, stock: g.stock.slice(0, g.stock.length - n), waste: [...g.waste, ...taken], moves: g.moves + 1 }
}

/** The cards a source would lift, bottom card first; empty when it lifts nothing legal. */
export function lifted(g: Klondike, src: Source): number[] {
  if (src.kind === 'waste') return g.waste.length ? [top(g.waste) as number] : []
  if (src.kind === 'foundation') {
    const pile = g.foundations[src.pile]
    return pile && pile.length ? [top(pile) as number] : []
  }
  const col = g.tableau[src.col]
  if (!col || src.index < 0 || src.index >= col.up.length) return []
  return col.up.slice(src.index)
}

export function canStack(card: number, onto: number | undefined): boolean {
  if (onto === undefined) return rankOf(card) === 13
  return isRed(card) !== isRed(onto) && rankOf(card) === rankOf(onto) - 1
}

export function canFound(card: number, pile: readonly number[]): boolean {
  const t = top(pile)
  if (t === undefined) return rankOf(card) === 1
  return suitOf(card) === suitOf(t) && rankOf(card) === rankOf(t) + 1
}

function withoutSource(g: Klondike, src: Source): Klondike {
  if (src.kind === 'waste') return { ...g, waste: g.waste.slice(0, -1) }
  if (src.kind === 'foundation') {
    return { ...g, foundations: g.foundations.map((p, i) => (i === src.pile ? p.slice(0, -1) : p)) }
  }
  return {
    ...g,
    tableau: g.tableau.map((c, i) => {
      if (i !== src.col) return c
      const up = c.up.slice(0, src.index)
      // A column left with no face-up card turns its next card over.
      return up.length === 0 && c.down.length > 0
        ? { down: c.down.slice(0, -1), up: [top(c.down) as number] }
        : { down: c.down, up }
    }),
  }
}

/** Moves the cards at `src` onto `dst`, or returns null when the rules forbid it. */
export function move(g: Klondike, src: Source, dst: Target): Klondike | null {
  const cards = lifted(g, src)
  const first = cards[0]
  if (first === undefined) return null
  if (dst.kind === 'foundation') {
    const pile = g.foundations[dst.pile]
    if (!pile || cards.length !== 1 || !canFound(first, pile)) return null
    if (src.kind === 'foundation' && src.pile === dst.pile) return null
    const g2 = withoutSource(g, src)
    return { ...g2, moves: g.moves + 1, foundations: g2.foundations.map((p, i) => (i === dst.pile ? [...p, first] : p)) }
  }
  const col = g.tableau[dst.col]
  if (!col) return null
  if (src.kind === 'tableau' && src.col === dst.col) return null
  // A column holding only face-down cards takes nothing (it cannot occur: the
  // top card is always turned over), and an empty one takes a king.
  if (col.up.length === 0 && col.down.length > 0) return null
  if (!canStack(first, top(col.up))) return null
  const g2 = withoutSource(g, src)
  return {
    ...g2,
    moves: g.moves + 1,
    tableau: g2.tableau.map((c, i) => (i === dst.col ? { down: c.down, up: [...c.up, ...cards] } : c)),
  }
}

/** Sends the card at `src` to whichever foundation takes it. */
export function toFoundation(g: Klondike, src: Source): Klondike | null {
  for (let pile = 0; pile < 4; pile++) {
    const next = move(g, src, { kind: 'foundation', pile })
    if (next) return next
  }
  return null
}

/** Plays every card that can go up to a foundation, repeatedly, until none can. */
export function autoPlay(g: Klondike): Klondike {
  let cur = g
  for (let guard = 0; guard < 52; guard++) {
    let next: Klondike | null = toFoundation(cur, { kind: 'waste' })
    for (let col = 0; col < 7 && !next; col++) {
      const up = cur.tableau[col]?.up ?? []
      if (up.length) next = toFoundation(cur, { kind: 'tableau', col, index: up.length - 1 })
    }
    if (!next) return cur
    cur = next
  }
  return cur
}

export const isWon = (g: Klondike) => g.foundations.every(p => p.length === 13)

/** Every card is face up and the stock is spent: the rest plays itself. */
export const canFinish = (g: Klondike) =>
  g.stock.length === 0 && g.waste.length === 0 && g.tableau.every(c => c.down.length === 0)

/** Reads a game handed in from storage; null unless it holds each of the 52 cards exactly once. */
export function readKlondike(raw: unknown): Klondike | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Record<string, unknown>
  const cards = (v: unknown): v is number[] => Array.isArray(v) && v.every(n => Number.isInteger(n) && n >= 0 && n < 52)
  if (!cards(g.stock) || !cards(g.waste)) return null
  if (!Array.isArray(g.foundations) || g.foundations.length !== 4 || !g.foundations.every(cards)) return null
  if (!Array.isArray(g.tableau) || g.tableau.length !== 7) return null
  const tableau: Column[] = []
  for (const c of g.tableau as unknown[]) {
    if (!c || typeof c !== 'object') return null
    const col = c as Record<string, unknown>
    if (!cards(col.down) || !cards(col.up)) return null
    tableau.push({ down: col.down, up: col.up })
  }
  const all = [...g.stock, ...g.waste, ...(g.foundations as number[][]).flat(), ...tableau.flatMap(c => [...c.down, ...c.up])]
  if (all.length !== 52 || new Set(all).size !== 52) return null
  const moves = Number.isInteger(g.moves) && (g.moves as number) >= 0 ? (g.moves as number) : 0
  return {
    stock: g.stock, waste: g.waste, foundations: g.foundations as number[][], tableau,
    drawCount: g.drawCount === 3 ? 3 : 1, moves,
  }
}
