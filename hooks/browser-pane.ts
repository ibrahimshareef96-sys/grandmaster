// The Claude desktop app's own browser pane, reached through its `Claude_Browser`
// tools: where the 3D games open so they stay inside Claude, not the system browser.
//
// Why not the games pane itself: no surface's element table has an element that
// hosts a web page (no Html, WebView or frame with scripts). A desktop `Client`
// draws terminal cells only, `Svg` runs no script, and `Shader` plays only behind
// the conversation (`Backdrop`). So three.js cannot run in a pane; it can run here.
import type { EngineInterface, McpToolResult } from 'claude-code'

export const BROWSER_SERVER = 'Claude_Browser'
export const BROWSER_OPEN_TOOL = `mcp__${BROWSER_SERVER}__preview_start`
const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/
/** An error that says the server is not known by this name (not that the page was refused). */
const SERVER_UNKNOWN = /\b(?:no|unknown)\b[^.\n]*\bserver\b|\bserver\b[^.\n]*\bnot (?:found|connected|known)\b/i
const NAMES_MCP = /\b(?:MCP|Claude_Browser)\b/i
const saysServerUnknown = (text: string): boolean => SERVER_UNKNOWN.test(text) && NAMES_MCP.test(text)

export type BrowserOpen = { ok: true; tabId: string | null } | { ok: false; reason: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** True where the session has the desktop app's browser pane (never a terminal, VS Code or the phone app). */
export async function hasBrowserPane($: EngineInterface): Promise<boolean> {
  try {
    return (await $.tool.list()).some(t => t.name === BROWSER_OPEN_TOOL)
  } catch {
    return false
  }
}

function textOf(result: McpToolResult): string {
  return result.content
    .map(block => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
    .trim()
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * The JSON object in a browser tool's text: the whole text, its lines up to the
 * first that closes an object (the tools follow the object with a line of
 * prose), or the part from the first `{` to the last `}`.
 */
export function jsonOfText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const whole = parseObject(trimmed)
  if (whole) return whole
  const lines = trimmed.split('\n')
  for (let i = 1; i <= lines.length; i++) {
    if (!lines[i - 1]?.trimEnd().endsWith('}')) continue
    const found = parseObject(lines.slice(0, i).join('\n'))
    if (found) return found
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  return start >= 0 && end > start ? parseObject(trimmed.slice(start, end + 1)) : null
}

/** The JSON object a browser tool answers: its structured result, else its text's. */
export function jsonOf(result: McpToolResult): Record<string, unknown> | null {
  if (isRecord(result.structuredContent)) return result.structuredContent
  // Block by block first, so prose in a later block cannot spoil the object.
  for (const block of result.content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      const found = jsonOfText(block.text)
      if (found) return found
    }
  }
  return jsonOfText(textOf(result))
}

/** An origin as `URL` spells it, or null: the tool's spelling and ours compare alike. */
function originOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'the browser pane did not answer'
}

/**
 * Closes the tab this mod opened before, so a new game replaces it rather than
 * piling up copies of the page. Only a tab still on the page's own origin is
 * closed: an id the person's own browsing now holds is left alone.
 */
async function closeEarlierTab($: EngineInterface, tabId: string, origin: string): Promise<void> {
  try {
    const context = jsonOf(await $.mcp.call(BROWSER_SERVER, 'tabs_context', {}))
    const tabs = context && Array.isArray(context.tabs) ? context.tabs : []
    const ours = tabs.some(t => isRecord(t) && t.tabId === tabId && originOf(t.origin) === origin)
    if (ours) await $.mcp.call(BROWSER_SERVER, 'tabs_close', { tabId })
  } catch {
    // A tab that cannot be read or closed stays; the new one still opens.
  }
}

/**
 * Opens `url` (an http(s) link, checked by the caller) in the desktop app's
 * browser pane, in place of the tab `earlierTab` names when that is still ours.
 * Resolves the new tab's id, or why it could not open.
 */
export async function openInBrowserPane($: EngineInterface, url: string, earlierTab: string | null): Promise<BrowserOpen> {
  const origin = originOf(url)
  if (origin === null) return { ok: false, reason: 'the page link is not a web address' }
  if (earlierTab !== null) await closeEarlierTab($, earlierTab, origin)
  let result: McpToolResult
  try {
    result = await $.mcp.call(BROWSER_SERVER, 'preview_start', { url })
  } catch (error) {
    // The server answers to another name here: call the tool by the name the
    // session lists it under instead, as the model would.
    return openThroughTool($, url, reasonOf(error))
  }
  if (result.isError) {
    const reason = textOf(result) || 'the browser pane refused the page'
    return saysServerUnknown(reason) ? openThroughTool($, url, reason) : { ok: false, reason }
  }
  return { ok: true, tabId: tabIdOf(jsonOf(result)) }
}

/**
 * The new tab's id, kept so the next open can replace it. Not when the tool says
 * it `reused` a tab: that tab may be one the person opened, never ours to close.
 */
function tabIdOf(answer: Record<string, unknown> | null): string | null {
  const tabId = answer?.tabId
  if (answer?.reused === true) return null
  return typeof tabId === 'string' && TAB_ID.test(tabId) ? tabId : null
}

async function openThroughTool($: EngineInterface, url: string, firstReason: string): Promise<BrowserOpen> {
  try {
    const called = await $.tool.call({ tool: BROWSER_OPEN_TOOL, url })
    if (called.deny !== undefined) return { ok: false, reason: called.deny }
    if (called.isError) return { ok: false, reason: called.text ?? firstReason }
    // `text` is the result as the model reads it: the tool's JSON line when it has one.
    return { ok: true, tabId: tabIdOf(jsonOfText(called.text ?? '')) }
  } catch {
    return { ok: false, reason: firstReason }
  }
}
