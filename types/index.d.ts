export type Tab = 'chess' | 'cube' | 'solitaire' | 'runner'

export type ChessStats = { wins: number; losses: number; draws: number; rating: number }
export type CubeStats = { solves: number; bestMs: number | null; recentMs: number[] }
export type SolitaireStats = { wins: number; played: number; bestMs: number | null }
export type RunnerStats = { runs: number; best: number }
export type Stats = { chess: ChessStats; cube: CubeStats; solitaire: SolitaireStats; runner: RunnerStats }
/**
 * This session's games at start and the 3D page in the desktop app's browser pane:
 * whether the start still looks for the pane (`pending`) or something opened
 * (`done`), how many looks it took, the run that looks (a reload starts a new
 * one), the page's tab, and whether the browser pane was there at the last look.
 */
export type BrowserState = {
  phase: 'pending' | 'done'
  attempt: number
  runId: string
  tabId: string | null
  hasBrowser: boolean | null
}

declare module 'claude-code' {
  interface PluginState {
    grandmaster: { tab: Shaped<Tab>; stats: Shaped<Stats>; browser: Shaped<BrowserState> }
  }
}
