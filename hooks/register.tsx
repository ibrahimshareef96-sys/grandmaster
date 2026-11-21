// Grandmaster: a games pane beside the chat. Chess, a Rubik's Cube, Klondike
// solitaire and a mascot runner, each a Client board; finished games feed a
// record kept across sessions.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Stats, Tab } from '../types'
import { formatMs } from './time'
import { EMPTY_STATS, addResult, averageOfFive, readResult, readStats } from './stats'

const PANE = 'grandmaster'
const TITLE = 'Grandmaster'
const STATS_KEY = 'stats'
const SEEN_KEY = 'results.seen'
/**
 * Where "Play the full version" goes (the same games drawn for a browser: a 3D
 * cube, drag and drop). Set by the `webPage` option; anything but an http(s)
 * link falls back to the build steps on GitHub.
 */
const DEFAULT_WEB_PAGE = 'https://github.com/ibrahimshareef96-sys/grandmaster#the-full-version'
export function webPageFrom(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_WEB_PAGE
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : DEFAULT_WEB_PAGE
  } catch {
    return DEFAULT_WEB_PAGE
  }
}
const SEEN_CAP = 200
const SAVE_KEY: Record<Tab, string> = {
  chess: 'save.chess', cube: 'save.cube', solitaire: 'save.solitaire', runner: 'save.runner',
}
const TABS: ReadonlyArray<{ id: Tab; label: string; hotkey: string }> = [
  { id: 'chess', label: 'Chess', hotkey: '1' },
  { id: 'cube', label: "Rubik's Cube", hotkey: '2' },
  { id: 'solitaire', label: 'Solitaire', hotkey: '3' },
  { id: 'runner', label: 'Mascot Run', hotkey: '4' },
]
const COMMANDS: ReadonlyArray<{ name: string; tab: Tab | null; description: string }> = [
  { name: 'games', tab: null, description: 'Open the games pane: chess, Rubik’s Cube, solitaire, Mascot Run' },
  { name: 'chess', tab: 'chess', description: 'Play chess against the engine in the games pane' },
  { name: 'cube', tab: 'cube', description: 'Open the Rubik’s Cube timer and trainer' },
  { name: 'solitaire', tab: 'solitaire', description: 'Play Klondike solitaire in the games pane' },
  { name: 'mascot-run', tab: 'runner', description: 'Play Mascot Run: jump the bugs' },
]

const tab = atom({ plugin: 'grandmaster', key: 'tab' } as const, 'chess' as Tab, { shape: 'tab-1' })
// The tag changed when the runner joined the record: a value of the old shape reads as empty.
const stats = atom({ plugin: 'grandmaster', key: 'stats' } as const, EMPTY_STATS, { shape: 'stats-2' })

const isTab = (v: unknown): v is Tab => v === 'chess' || v === 'cube' || v === 'solitaire' || v === 'runner'

function summary(t: Tab, s: Stats): string {
  if (t === 'chess') {
    const c = s.chess
    return `Rating ${c.rating}  ·  ${c.wins}W ${c.losses}L ${c.draws}D`
  }
  if (t === 'cube') {
    const c = s.cube
    const ao5 = averageOfFive(c.recentMs)
    const best = c.bestMs === null ? 'no solves yet' : `best ${formatMs(c.bestMs)}`
    return `${c.solves} solves  ·  ${best}${ao5 === null ? '' : `  ·  ao5 ${formatMs(ao5)}`}`
  }
  if (t === 'runner') return `${s.runner.runs} runs  ·  best ${s.runner.best}`
  const g = s.solitaire
  const best = g.bestMs === null ? '' : `  ·  fastest ${formatMs(g.bestMs)}`
  return `${g.wins} won of ${g.played} played${best}`
}

export const register: Register = (on, options) => {
  const webPage = webPageFrom(options.webPage)
  on('session.start', async ($, e, next) => {
    for (const c of COMMANDS) await $.command.register({ name: c.name, description: c.description })
    const stored = readStats(await $.store.get(STATS_KEY))
    await update($, stats, () => stored)
    // Open beside the chat at every start (and every reload), so the games are
    // there while Claude works. Not awaited: a session never waits on the pane.
    void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    return next(e)
  })

  for (const c of COMMANDS) {
    on('command.run', { command: c.name }, async $ => {
      if (c.tab) await update($, tab, () => c.tab as Tab)
      const { isPlaced } = await $.ui.open({ id: PANE, title: TITLE, focus: true })
      return { text: isPlaced ? `${TITLE} pane opened.` : `${TITLE} is ready; this surface cannot show the pane.` }
    })
  }

  // A board sends one message per action, `{ type: 'save', game, data, result? }`:
  // a board may post once a frame and a later post replaces an earlier one,
  // so a game's last save and its result travel together.
  on('ui.message', async ($, e, next) => {
    const data = e.data as Record<string, unknown> | null
    if (!data || typeof data !== 'object' || data.type !== 'save' || !isTab(data.game)) return next(e)
    if (data.data && typeof data.data === 'object') await $.store.set(SAVE_KEY[data.game], data.data)
    const result = data.result && typeof data.result === 'object'
      ? readResult({ ...(data.result as Record<string, unknown>), type: 'result', game: data.game })
      : null
    if (result) {
      // Boards re-send their last result with each save; count each id once.
      const raw = (data.result as Record<string, unknown>).id
      const id = typeof raw === 'string' && raw.length > 0 && raw.length <= 64 ? raw : null
      const seenRaw = await $.store.get(SEEN_KEY)
      const seen = Array.isArray(seenRaw) ? seenRaw.filter((x): x is string => typeof x === 'string') : []
      if (id !== null && seen.includes(id)) return {}
      // The store holds the record; read it here, not from the session's copy,
      // which is empty when the mod was turned on after the session started.
      const after = addResult(readStats(await $.store.get(STATS_KEY)), result)
      await $.store.set(STATS_KEY, after)
      if (id !== null) await $.store.set(SEEN_KEY, [...seen, id].slice(-SEEN_CAP))
      await update($, stats, () => after)
    }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, tab)
    // Reading the session copy subscribes this drawing to new results; the
    // store is what it shows, so a record from before this load is never lost.
    await read($, stats)
    const record = readStats(await $.store.get(STATS_KEY))
    // A game never saved is `null`, not `undefined`: a Client's props are JSON.
    const saved = (await $.store.get(SAVE_KEY[current])) ?? null
    const tabs = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {TABS.map(t => (
          <Button
            key={`tab-${t.id}`}
            hotkey={t.hotkey}
            variant={t.id === current ? 'primary' : 'secondary'}
            onPress={() => update($, tab, () => t.id)}
          >
            {t.label}
          </Button>
        ))}
      </Box>
    )
    const { Link } = $.ui.resolve(e)
    const header = (
      <Box flexDirection="column">
        {tabs}
        <Text dimColor>{summary(current, record)}</Text>
        <Link href={webPage} label="Play the full version: 3D cube, drag and drop" />
      </Box>
    )

    if (e.surface === 'terminal' || e.surface === 'desktop') {
      const { Client } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          {current === 'chess' && <Client key="chess" module="./chess-client.tsx" props={{ saved }} width="100%" />}
          {current === 'cube' && <Client key="cube" module="./cube-client.tsx" props={{ saved }} width="100%" />}
          {current === 'solitaire' && <Client key="solitaire" module="./solitaire-client.tsx" props={{ saved }} width="100%" />}
          {current === 'runner' && <Client key="runner" module="./runner-client.tsx" props={{ saved }} width="100%" />}
        </Box>
      )
    }
    return (
      <Box flexDirection="column" gap={1}>
        {header}
        <Text>The boards play in the Claude desktop app or a terminal. Your record shows here.</Text>
      </Box>
    )
  })
}
