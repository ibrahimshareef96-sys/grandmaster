import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { solved, turn } from '../hooks/cube-engine'

const PANE = {
  plugin: 'grandmaster',
  component: 'Pane',
  requestId: 'grandmaster',
  props: {
    title: 'Grandmaster',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

function engine(on: On, entries: Record<string, unknown> = {}) {
  mock.store(on, entries)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

test('the pane shows the three games and switches between them', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'tab-chess' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Rating 800/ }))?.text).toContain('0W 0L 0D')
    await ui.press({ key: 'tab-cube' })
    expect(await ui.find({ type: 'Text', text: /no solves yet/ })).toBeDefined()
    await ui.press({ key: 'tab-solitaire' })
    expect(await ui.find({ type: 'Text', text: /won of 0 played/ })).toBeDefined()
    await ui.press({ key: 'tab-chess' })
    await ui.unmount()
  }
})

test('a chess move by click is answered by the engine and saved', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ columns: 60, rows: 40, in: 'chess' })
  // Big squares are 6 wide and 3 tall after a 2-column rank label: e2 is row 6, col 4.
  const click = (col: number, row: number) => ui.pointer({ type: 'down', x: 2 + col * 6 + 2, y: row * 3 + 1, button: 'left', in: 'chess' })
  await click(4, 6)
  await click(4, 4)
  expect(await ui.find({ type: 'Text', text: /1\. e4/, in: 'chess' })).toBeDefined()
  for (let i = 0; i < 40 && !(await ui.find({ type: 'Text', text: /Your move/, in: 'chess' })); i++) await ui.advance(50)
  expect(await ui.find({ type: 'Text', text: /Your move/, in: 'chess' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /1\. e4 \S+/, in: 'chess' }))?.text).toMatch(/^1\. e4 \S+/)
  await ui.unmount()
  // The game was saved: a fresh board picks it up where it was left.
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await again.find({ type: 'Text', text: /1\. e4/, in: 'chess' }))?.text).toMatch(/^1\. e4 \S+/)
  await again.unmount()
})

test('finishing a cube solve on the board puts the time in the record', async ($, on) => {
  // A timed solve one turn from done: the cube after R, started five seconds ago.
  engine(on, {
    'save.cube': {
      cube: turn(solved(), 'R'), scrambledWith: ['R'], moves: 0, history: [], startedAt: Date.now() - 5000,
    },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-cube' })
  expect(await ui.find({ type: 'Text', text: /Solve resumed/, in: 'cube' })).toBeDefined()
  await ui.press({ key: "cube-turn-R'" })
  expect(await ui.find({ type: 'Text', text: /^Solved in 5\.\d\d with 1 turns\./, in: 'cube' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /solves/ }))?.text).toMatch(/^1 solves {2}· {2}best 5\.\d\d$/)
  await ui.unmount()
  // The record outlives the session: a new one reads it back from the store.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await again.find({ type: 'Text', text: /solves/ }))?.text).toContain('1 solves')
  await again.unmount()
})

test('a result re-sent with later saves is counted once', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-cube' })
  const solve = { ms: 30000, moves: 60, id: 'solve-1' }
  for (let i = 0; i < 3; i++) await ui.post({ type: 'save', game: 'cube', data: {}, result: solve }, { in: 'cube' })
  expect((await ui.find({ type: 'Text', text: /solves/ }))?.text).toMatch(/^1 solves/)
  await ui.post({ type: 'save', game: 'cube', data: {}, result: { ...solve, id: 'solve-2' } }, { in: 'cube' })
  expect((await ui.find({ type: 'Text', text: /solves/ }))?.text).toMatch(/^2 solves/)
  await ui.unmount()
})

test('winning solitaire on the board counts once in the record', async ($, on) => {
  // Every card home but the king of spades, which sits on the waste.
  const home = [0, 1, 2, 3].map(s => Array.from({ length: s === 0 ? 12 : 13 }, (_, r) => s * 13 + r))
  const empty = Array.from({ length: 7 }, () => ({ down: [], up: [] }))
  engine(on, {
    'save.solitaire': {
      game: { stock: [], waste: [12], foundations: home, tableau: empty, drawCount: 1, moves: 90 },
      startedAt: Date.now() - 60000, finishedMs: null,
    },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-solitaire' })
  // The waste is the second card slot on the top row; clicking it twice sends it home.
  await ui.pointer({ type: 'down', x: 6, y: 0, button: 'left', in: 'solitaire' })
  await ui.pointer({ type: 'down', x: 6, y: 0, button: 'left', in: 'solitaire' })
  expect(await ui.find({ type: 'Text', text: /You won\./, in: 'solitaire' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /won of/ }))?.text).toMatch(/^1 won of 1 played {2}· {2}fastest 1:00\.\d\d$/)
  // A finished deal takes no more moves, so it cannot be counted again.
  await ui.pointer({ type: 'down', x: 6, y: 0, button: 'left', in: 'solitaire' })
  expect((await ui.find({ type: 'Text', text: /won of/ }))?.text).toMatch(/^1 won of 1 played/)
  await ui.unmount()
})

test('starting over mid-game asks first, then counts as a resignation', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ columns: 60, rows: 40, in: 'chess' })
  const click = (col: number, row: number) => ui.pointer({ type: 'down', x: 2 + col * 6 + 2, y: row * 3 + 1, button: 'left', in: 'chess' })
  await click(4, 6)
  await click(4, 4)
  for (let i = 0; i < 40 && !(await ui.find({ type: 'Text', text: /Your move/, in: 'chess' })); i++) await ui.advance(50)
  await ui.press({ key: 'chess-new' })
  expect(await ui.find({ type: 'Text', text: /Press again to resign/, in: 'chess' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Rating/ }))?.text).toMatch(/0W 0L 0D$/)
  await ui.press({ key: 'chess-new' })
  expect(await ui.find({ type: 'Text', text: /Resigned/, in: 'chess' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Rating/ }))?.text).toMatch(/0W 1L 0D$/)
  await ui.unmount()
})

test('a chess game already counted is not counted again after an undo', async ($, on) => {
  // Black to move can mate with Qh4# (fool's mate); the player is Black.
  engine(on, {
    'save.chess': {
      history: [
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        'rnbqkbnr/pppppppp/8/8/8/5P2/PPPPP1PP/RNBQKBNR b KQkq - 0 1',
        'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2',
        'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2',
      ],
      sans: ['f3', 'e5', 'g4'], moves: [[53, 45], [12, 28], [54, 38]], side: 'b', level: 1,
      reported: false, ratedLevel: 1,
    },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ columns: 60, rows: 40, in: 'chess' })
  // Seen from Black the board is turned round: d8 is row 7, col 4; h4 is row 3, col 0.
  const click = (col: number, row: number) => ui.pointer({ type: 'down', x: 2 + col * 6 + 2, y: row * 3 + 1, button: 'left', in: 'chess' })
  await click(4, 7)
  await click(0, 3)
  expect(await ui.find({ type: 'Text', text: /Checkmate\. You win\./, in: 'chess' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Rating/ }))?.text).toMatch(/1W 0L 0D$/)
  await ui.press({ key: 'chess-undo' })
  await click(4, 7)
  await click(0, 3)
  expect(await ui.find({ type: 'Text', text: /Already counted once/, in: 'chess' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Rating/ }))?.text).toMatch(/1W 0L 0D$/)
  await ui.unmount()
})

test('cube buttons and keys turn the cube; a scramble arms the clock', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-cube' })
  await ui.press({ key: 'cube-turn-R' })
  await ui.key({ key: 'u', in: 'cube' })
  expect(await ui.find({ type: 'Text', text: /2 turns/, in: 'cube' })).toBeDefined()
  await ui.press({ key: 'cube-scramble' })
  expect(await ui.find({ type: 'Text', text: /starts on first turn/, in: 'cube' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Scramble: /, in: 'cube' })).toBeDefined()
  await ui.unmount()
})

test('solitaire: the stock draws, and a new deal resets the table', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-solitaire' })
  await ui.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: 'solitaire' })
  expect(await ui.find({ type: 'Text', text: /1 moves/, in: 'solitaire' })).toBeDefined()
  await ui.press({ key: 'sol-draw' })
  expect(await ui.find({ type: 'Text', text: /New deal, draw 3/, in: 'solitaire' })).toBeDefined()
  await ui.unmount()
})

test('Mascot Run: the mascot runs, a bug ends the run, the record counts it', async ($, on) => {
  engine(on, { 'save.runner': { best: 7 } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-runner' })
  expect(await ui.find({ type: 'Text', text: /Best 00007/, in: 'runner' })).toBeDefined()
  await ui.key({ key: ' ', in: 'runner' })
  // Never jumping again, the first bug catches him within a few seconds.
  for (let i = 0; i < 200 && !(await ui.find({ type: 'Text', text: /Space to run again/, in: 'runner' })); i++) {
    await ui.advance(50)
  }
  expect(await ui.find({ type: 'Text', text: /Space to run again/, in: 'runner' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /runs/ }))?.text).toMatch(/^1 runs/)
  await ui.unmount()
})

test('a saved game and record come back next session; damaged saves start fresh', async ($, on) => {
  engine(on, {
    stats: { chess: { wins: 3, losses: 1, draws: 0, rating: 1010 } },
    'save.solitaire': { game: 'broken' },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Rating 1010/ }))?.text).toContain('3W 1L 0D')
  await ui.press({ key: 'tab-solitaire' })
  expect(await ui.find({ type: 'Text', text: /Fresh deal/, in: 'solitaire' })).toBeDefined()
  await ui.unmount()
})

test('surfaces without boards still show the record', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /desktop app or a terminal/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the commands open the pane on the right game', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran = await $.command.run({
    command: 'cube', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 },
  })
  expect(ran).toMatchObject({ text: 'Grandmaster pane opened.' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /no solves yet/ })).toBeDefined()
  await ui.unmount()
})
