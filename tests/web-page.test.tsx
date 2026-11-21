import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { webPageFor, webPageFrom } from '../hooks/register'

const DEFAULT = 'https://ibrahimshareef96-sys.github.io/grandmaster/'
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

function engine(on: On) {
  mock.store(on, {})
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

test('the full-version link takes only http(s) links and falls back otherwise', () => {
  expect(webPageFrom('https://example.com/games')).toBe('https://example.com/games')
  expect(webPageFrom('  http://localhost:3000/  ')).toBe('http://localhost:3000/')
  expect(webPageFrom('HTTPS://EXAMPLE.COM')).toBe('https://example.com/')
  const bad = ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x', 'data:text/html,hi', '//example.com',
    'https://', 'example.com', 'not a url', '', '   ', 42, undefined, null]
  for (const value of bad) expect(webPageFrom(value)).toBe(DEFAULT)
})

test('with no option set, the link is the manifest default', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // No `options` here, so the kit fills in plugin.json's default: it must match the code's fallback.
  expect((await ui.find({ type: 'Link' }))?.props?.href).toBe(`${webPageFrom(undefined)}#chess`)
  await ui.unmount()
})

test('the 3D link opens the game the pane shows', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Link' }))?.props?.href).toBe(`${DEFAULT}#chess`)
  await ui.press({ key: 'tab-cube' })
  expect((await ui.find({ type: 'Link' }))?.props?.href).toBe(`${DEFAULT}#cube`)
  await ui.unmount()
})

test('a link that names its own # is kept as it is', () => {
  expect(webPageFor('https://example.com/a#runner', 'chess')).toBe('https://example.com/a#runner')
  expect(webPageFor('https://example.com/a', 'solitaire')).toBe('https://example.com/a#solitaire')
})

test('the pane links to the page the webPage option names', { options: { webPage: 'https://example.com/mine' } }, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Link' }))?.props?.href).toBe('https://example.com/mine#chess')
  await ui.unmount()
})
