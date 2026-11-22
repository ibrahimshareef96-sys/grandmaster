import type { McpToolResult, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { BROWSER_OPEN_TOOL, BROWSER_SERVER, jsonOf, jsonOfText } from '../hooks/browser-pane'
import { AUTO_OPEN_RETRY_MS } from '../hooks/open-games'

const PAGE = 'https://ibrahimshareef96-sys.github.io/grandmaster/'
const ORIGIN = 'https://ibrahimshareef96-sys.github.io'
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
const TOTAL_WAIT_MS = AUTO_OPEN_RETRY_MS.reduce((a, b) => a + b, 0)
const PRESENTATION = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

type Tab = { tabId: string; origin: string }
type World = {
  /** Every browser tool call through `$.mcp.call`, in order: the tool and its arguments. */
  calls: Array<{ tool: string; args: Record<string, unknown> }>
  /** Every url the tool was called with through `$.tool.call` (the session's name for it). */
  toolCalls: unknown[]
  /** Every `$.ui.open` of the text-cell pane. */
  paneOpens: number
  /** The browser pane's tabs as `tabs_context` reports them. */
  tabs: Tab[]
  /** Whether `tool.list` names the browser pane's tool now. */
  hasBrowser: boolean
  /** Errors the next `preview_start` calls answer with, one each. */
  refusals: string[]
  /** `preview_start` refuses every page. */
  refuseAlways: boolean
  /** `preview_start` answers a tab id that is no plain id. */
  badTabId: boolean
  /** `preview_start` says it reused a tab (it navigated one already open). */
  reused: boolean
  /** `tabs_context` spells an origin with a trailing slash. */
  slashedOrigins: boolean
  /** How `$.mcp.call` fails for a server it knows by another name: thrown, or an error result. */
  serverUnknown: 'deny' | 'error' | null
}

const text = (t: string): McpToolResult => ({ content: [{ type: 'text', text: t }], isError: false })
const failure = (t: string): McpToolResult => ({ content: [{ type: 'text', text: t }], isError: true })

function engine(on: On, start: Partial<World> & { surfaces?: Array<'terminal' | 'desktop' | 'vscode'> } = {}): World {
  const world: World = {
    calls: [], toolCalls: [], paneOpens: 0, tabs: [], hasBrowser: true, refusals: [], refuseAlways: false,
    badTabId: false, reused: false, slashedOrigins: false, serverUnknown: null, ...start,
  }
  let nextTab = 1
  mock.store(on, {})
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => {
    world.paneOpens += 1
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: start.surfaces ?? [] }))
  on('tool.list', () => ({
    value: world.hasBrowser ? [{ name: BROWSER_OPEN_TOOL, description: 'Open the Browser pane', mcp: true }] : [],
  }))
  on('tool.call', { tool: BROWSER_OPEN_TOOL }, (_, e) => {
    world.toolCalls.push((e as { url?: unknown }).url)
    return { result: 'Browser pane opened.' }
  })
  on('mcp.call', (_, e) => {
    if (world.serverUnknown === 'deny') return { deny: `no MCP server named ${e.server}` }
    if (world.serverUnknown === 'error') return { value: failure(`No MCP server named "${e.server}" is connected.`) }
    if (e.server !== BROWSER_SERVER) return { value: failure('unknown server') }
    world.calls.push({ tool: e.tool, args: e.args })
    if (e.tool === 'tabs_context') {
      const tabs = world.tabs.map(t => ({ ...t, origin: world.slashedOrigins ? `${t.origin}/` : t.origin, isActive: false }))
      return { value: text(`${JSON.stringify({ browserOpen: tabs.length > 0, tabs })}\nThe Browser pane is shown.`) }
    }
    if (e.tool === 'tabs_close') {
      world.tabs = world.tabs.filter(t => t.tabId !== e.args.tabId)
      return { value: text('closed') }
    }
    if (e.tool === 'preview_start') {
      const refusal = world.refuseAlways ? 'blocked by policy' : world.refusals.shift()
      if (refusal !== undefined) return { value: failure(refusal) }
      const tabId = world.badTabId ? '../../x y' : `tab-${nextTab++}`
      world.tabs = [...world.tabs, { tabId, origin: new URL(String(e.args.url)).origin }]
      const answer = { serverId: 'preview-1', tabId, reused: world.reused, type: 'browser', navOk: true }
      return { value: text(`${JSON.stringify(answer)}\nBrowser pane opened. Use serverId "preview-1" with read_page.`) }
    }
    return { value: failure('no such tool') }
  })
  return world
}

const opened = (world: World) => world.calls.filter(c => c.tool === 'preview_start').map(c => c.args.url)
/** A command as the composer runs it. */
const typed = (command: string) => ({ command, args: '', ...PRESENTATION })

test('in the desktop app the session opens the 3D page in the browser pane, not the text pane', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  // No `#`: the page opens on the game it showed last.
  expect(opened(world)).toEqual([PAGE])
  expect(world.paneOpens).toBe(0)
  await clock.advance(TOTAL_WAIT_MS)
  expect(opened(world)).toEqual([PAGE])
})

test('the browser pane joining a moment after the start still gets the 3D page', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { hasBrowser: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(opened(world)).toEqual([])
  world.hasBrowser = true
  await clock.advance(AUTO_OPEN_RETRY_MS[0] ?? 0)
  expect(opened(world)).toEqual([PAGE])
  expect(world.paneOpens).toBe(0)
  await clock.advance(TOTAL_WAIT_MS)
  expect(opened(world)).toEqual([PAGE])
})

test('with no browser pane ever, the text-cell pane opens once the looks run out', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { hasBrowser: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(world.paneOpens).toBe(0)
  await clock.advance(TOTAL_WAIT_MS)
  expect(world.paneOpens).toBe(1)
  expect(world.calls).toEqual([])
  await clock.advance(TOTAL_WAIT_MS)
  expect(world.paneOpens).toBe(1)
})

for (const surface of ['terminal', 'vscode'] as const) {
  test(`a ${surface} session opens the text-cell pane at once`, async ($, on) => {
    const clock = mock.clock(on)
    const world = engine(on, { hasBrowser: false, surfaces: [surface] })
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await clock.settle()
    expect(world.paneOpens).toBe(1)
    expect(world.calls).toEqual([])
  })
}

test('a browser pane that refuses once is asked again; one that always refuses leaves the text-cell pane', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'], refusals: ['still starting'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(opened(world)).toEqual([PAGE])
  await clock.advance(AUTO_OPEN_RETRY_MS[0] ?? 0)
  expect(opened(world)).toEqual([PAGE, PAGE])
  expect(world.tabs.length).toBe(1)
  expect(world.paneOpens).toBe(0)
})

test('a browser pane that always refuses leaves the text-cell pane', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'], refuseAlways: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await clock.advance(TOTAL_WAIT_MS)
  expect(opened(world).length).toBe(AUTO_OPEN_RETRY_MS.length + 1)
  expect(world.paneOpens).toBe(1)
})

test('a reload once the page is open opens nothing more', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await clock.advance(TOTAL_WAIT_MS)
  expect(opened(world)).toEqual([PAGE])
  expect(world.paneOpens).toBe(0)
})

test('a reload while the start still looks picks the look up, and the page opens once', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { hasBrowser: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await clock.advance(AUTO_OPEN_RETRY_MS[0] ?? 0)
  // The reload: the copy before it still has a look waiting.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  world.hasBrowser = true
  await clock.advance(TOTAL_WAIT_MS)
  expect(opened(world)).toEqual([PAGE])
  expect(world.paneOpens).toBe(0)
})

test('a game the person opens is never replaced by a later look of the start', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { hasBrowser: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  world.hasBrowser = true
  await $.command.run(typed('chess'))
  await clock.advance(TOTAL_WAIT_MS)
  expect(opened(world)).toEqual([`${PAGE}#chess`])
  expect(world.tabs).toEqual([{ tabId: 'tab-1', origin: ORIGIN }])
  expect(world.paneOpens).toBe(0)
})

test('the game commands open that game in 3D, replacing the tab they opened before', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(await $.command.run(typed('chess'))).toEqual(expect.objectContaining({ text: expect.stringContaining('3D') }))
  expect(await $.command.run(typed('cube'))).toEqual(expect.objectContaining({ text: expect.stringContaining('3D') }))
  expect(opened(world)).toEqual([PAGE, `${PAGE}#chess`, `${PAGE}#cube`])
  // One tab of the page at a time: each earlier one was closed.
  expect(world.tabs).toEqual([{ tabId: 'tab-3', origin: ORIGIN }])
  expect(world.paneOpens).toBe(0)
})

test('two opens at once still leave one tab of the page', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await Promise.all([$.command.run(typed('chess')), $.command.run(typed('solitaire'))])
  expect(world.tabs.length).toBe(1)
  expect(world.calls.filter(c => c.tool === 'tabs_close').length).toBe(2)
})

test('a tab id that now holds another site is never closed', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  // The person closed our tab and the id came back on a page of their own.
  world.tabs = [{ tabId: 'tab-1', origin: 'http://localhost:3000' }]
  await $.command.run(typed('solitaire'))
  expect(world.calls.some(c => c.tool === 'tabs_close')).toBe(false)
  expect(world.tabs.map(t => t.origin)).toEqual(['http://localhost:3000', ORIGIN])
})

test('an origin the tool spells with a slash is still ours', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'], slashedOrigins: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await $.command.run(typed('cube'))
  expect(world.tabs).toEqual([{ tabId: 'tab-2', origin: ORIGIN }])
})

test('a tab the tool says it reused is never kept, so never closed', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'], reused: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await $.command.run(typed('chess'))
  expect(world.calls.some(c => c.tool === 'tabs_context' || c.tool === 'tabs_close')).toBe(false)
})

test('a tab id that is not a plain id is not kept', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'], badTabId: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await $.command.run(typed('chess'))
  expect(world.calls.some(c => c.tool === 'tabs_close' || c.tool === 'tabs_context')).toBe(false)
})

test('a refused command falls back to the text-cell pane and says why', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  world.refusals = ['not allowed']
  expect(await $.command.run(typed('games'))).toEqual(expect.objectContaining({ text: expect.stringContaining('not allowed') }))
  expect(world.paneOpens).toBe(1)
})

test('/games-text opens the text-cell pane even where the browser pane exists', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(await $.command.run(typed('games-text'))).toEqual(expect.objectContaining({ text: 'Grandmaster pane opened.' }))
  expect(world.paneOpens).toBe(1)
})

test('/games-text while the start still looks: no 3D page opens beside it later', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { hasBrowser: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  await $.command.run(typed('games-text'))
  world.hasBrowser = true
  await clock.advance(TOTAL_WAIT_MS)
  expect(opened(world)).toEqual([])
  expect(world.paneOpens).toBe(1)
})

test('a refusal that is not about the server is not tried again under another name', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'], refusals: ['no server running at that URL'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  expect(world.toolCalls).toEqual([])
})

test('a press that finds the browser pane gone looks again and draws the link', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  world.hasBrowser = false
  world.refusals = ['the browser pane is off']
  await ui.press({ key: 'play-3d' })
  expect(await ui.find({ type: 'Button', key: 'play-3d' })).toBeUndefined()
  expect(await ui.find({ type: 'Link' })).toBeDefined()
  await ui.unmount()
})

for (const serverUnknown of ['deny', 'error'] as const) {
  test(`where the server answers to another name (${serverUnknown}), the session's tool opens the page`, async ($, on) => {
    const clock = mock.clock(on)
    const world = engine(on, { surfaces: ['desktop'], serverUnknown })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await clock.settle()
    expect(world.toolCalls).toEqual([PAGE])
    expect(world.paneOpens).toBe(0)
  })
}

test('in the desktop pane the 3D button opens the shown game in the browser pane', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { surfaces: ['desktop'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  await ui.press({ key: 'tab-runner' })
  await ui.press({ key: 'play-3d' })
  expect(opened(world).at(-1)).toBe(`${PAGE}#runner`)
  await ui.unmount()
  // The terminal has no browser pane of its own: it keeps the link.
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Link' }))?.props?.href).toBe(`${PAGE}#runner`)
  expect(await term.find({ type: 'Button', key: 'play-3d' })).toBeUndefined()
  await term.unmount()
})

test('browser answers are read as JSON with prose after it; anything else is nothing', () => {
  expect(jsonOf(text('{"tabId":"tab-2","navOk":true}\nBrowser pane opened.'))).toEqual({ tabId: 'tab-2', navOk: true })
  expect(jsonOf(text('{"tabId":"tab-2"}\nUse {serverId} with read_page.'))).toEqual({ tabId: 'tab-2' })
  expect(jsonOf({ content: [], isError: false, structuredContent: { tabId: 'seed' } })).toEqual({ tabId: 'seed' })
  expect(jsonOf({ content: [{ type: 'text', text: '{"a":1}' }, { type: 'text', text: 'see {x}' }], isError: false })).toEqual({ a: 1 })
  for (const bad of ['', 'no json here', '{broken', '[1,2]', '"x"', '} {']) expect(jsonOf(text(bad))).toBeNull()
  expect(jsonOfText('  {"tabId":"seed"}  ')).toEqual({ tabId: 'seed' })
})
