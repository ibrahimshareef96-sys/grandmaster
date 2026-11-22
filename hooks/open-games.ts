// Where the games open. In the Claude desktop app: the 3D page, in the app's own
// browser pane, at every session start and on every game command. Where there
// is no browser pane (a terminal, VS Code, the phone app) or it refuses the
// page: the pane of text-cell boards.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { BrowserState } from '../types'
import { hasBrowserPane, openInBrowserPane } from './browser-pane'
import type { BrowserOpen } from './browser-pane'

export const PANE = 'grandmaster'
export const TITLE = 'Grandmaster'
/**
 * Waits before each later look for the browser pane at session start: the
 * desktop app attaches, and its tools join the session, a moment after it starts.
 */
export const AUTO_OPEN_RETRY_MS: readonly number[] = [1500, 4000, 8000]

/** The browser state before anything looked; `register.tsx` keeps an atom of the same key and shape. */
export const FRESH_BROWSER: BrowserState = { phase: 'pending', attempt: 0, runId: '', tabId: null, hasBrowser: null }
// The session's: it outlives a reload of the mod, so a reload picks the start
// up where it was, never opens the page twice, and remembers the page's tab.
const browser = atom({ plugin: 'grandmaster', key: 'browser' } as const, FRESH_BROWSER, { shape: 'browser-2' })

// One open at a time: each reads the tab the last one left before closing it.
// A module variable: a reload starts a fresh queue, which only loses the wait.
let queue: Promise<unknown> = Promise.resolve()
// What this copy of the module did, seen at once by every hook running now: a
// write to the session's state may not reach a hook already under way. The
// state carries the same across a reload, when these start over as unknown.
let ownTab: string | null | undefined
let ownDone = false
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

function newRunId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/** A session drawn only where no browser pane can be: a terminal, VS Code, the phone app. */
async function noDesktop($: EngineInterface): Promise<boolean> {
  try {
    const surfaces = await $.session.surfaces()
    return surfaces.length > 0 && !surfaces.includes('desktop')
  } catch {
    return false
  }
}

/** Looks for the browser pane now and keeps the answer for drawing, which never looks itself. */
export async function lookForBrowserPane($: EngineInterface): Promise<boolean> {
  const found = await hasBrowserPane($)
  if ((await read($, browser)).hasBrowser !== found) await update($, browser, s => ({ ...s, hasBrowser: found }))
  return found
}

/** The text-cell pane; resolves whether a surface shows it now. */
export async function openTextPane($: EngineInterface, focus: boolean): Promise<boolean> {
  try {
    const { isPlaced } = await $.ui.open({ id: PANE, title: TITLE, ...(focus ? { focus: true as const } : {}) })
    return isPlaced
  } catch {
    return false
  }
}

async function openNow($: EngineInterface, url: string): Promise<BrowserOpen> {
  const tabId = ownTab !== undefined ? ownTab : (await read($, browser)).tabId
  const opened = await openInBrowserPane($, url, tabId)
  if (opened.ok) {
    ownTab = opened.tabId
    await update($, browser, s => ({ ...s, tabId: opened.tabId }))
  }
  return opened
}

/** The start's look is over: something opened, or the person opened a game first. */
async function isDone($: EngineInterface, runId: string | null): Promise<boolean> {
  if (ownDone) return true
  const s = await read($, browser)
  return s.phase === 'done' || (runId !== null && s.runId !== runId)
}

async function markDone($: EngineInterface): Promise<void> {
  ownDone = true
  await update($, browser, s => ({ ...s, phase: 'done' as const }))
}

/**
 * The 3D page at `url` in the browser pane, in place of the tab this session
 * opened before. The person asked for it (a command, the pane's button), so the
 * session start stops looking: its later look would replace the game they chose.
 */
export async function open3dForPerson($: EngineInterface, url: string): Promise<BrowserOpen> {
  await markDone($)
  return oneAtATime(() => openNow($, url))
}

/** The text-cell pane the person asked for: the start's look stops, so no page opens beside it. */
export async function openTextForPerson($: EngineInterface): Promise<boolean> {
  await markDone($)
  return openTextPane($, true)
}

/**
 * Starts (or, after a reload part way, resumes) the look for the browser pane
 * at session start. Done once a page or pane has opened, or the person opened
 * one first; a reload after that opens nothing.
 */
export async function startAutoOpen($: EngineInterface, url: string): Promise<void> {
  if (await isDone($, null)) return
  // A new run: a look the copy before a reload still had waiting finds it stale and stops.
  const runId = newRunId()
  const { attempt } = await read($, browser)
  await update($, browser, s => ({ ...s, runId }))
  void autoOpenStep($, url, runId, attempt).catch(() => undefined)
}

/** Ends the run's look; false when it had already ended (another run, or the person). */
async function finish($: EngineInterface, runId: string): Promise<boolean> {
  if (await isDone($, runId)) return false
  await markDone($)
  return true
}

/**
 * One look: the 3D page when the browser pane is in the session; another look
 * later while looks remain and the session may yet be the desktop app's; the
 * text-cell pane once none remain. `url` is the page with no `#`, so it opens on
 * the game it showed last.
 */
async function autoOpenStep($: EngineInterface, url: string, runId: string, attempt: number): Promise<void> {
  if (await isDone($, runId)) return
  const found = await lookForBrowserPane($)
  let reason: 'none' | 'refused' = 'none'
  if (found) {
    // Checked again inside the queue: a command may have opened the page meanwhile.
    const opened = await oneAtATime(async () => ((await isDone($, runId)) ? null : openNow($, url)))
    if (opened === null) return
    if (opened.ok) {
      await finish($, runId)
      return
    }
    reason = 'refused'
  }
  const wait = AUTO_OPEN_RETRY_MS[attempt]
  if (wait === undefined || (reason === 'none' && (await noDesktop($)))) {
    if (await finish($, runId)) await openTextPane($, false)
    return
  }
  // Kept in the state too, so a reload resumes the count rather than starting it over.
  await update($, browser, s => ({ ...s, attempt: attempt + 1 }))
  $.clock.after(wait, () => {
    void autoOpenStep($, url, runId, attempt + 1).catch(() => undefined)
  })
}
