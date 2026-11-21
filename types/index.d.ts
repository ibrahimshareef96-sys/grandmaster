export type Tab = 'chess' | 'cube' | 'solitaire' | 'runner'

export type ChessStats = { wins: number; losses: number; draws: number; rating: number }
export type CubeStats = { solves: number; bestMs: number | null; recentMs: number[] }
export type SolitaireStats = { wins: number; played: number; bestMs: number | null }
export type RunnerStats = { runs: number; best: number }
export type Stats = { chess: ChessStats; cube: CubeStats; solitaire: SolitaireStats; runner: RunnerStats }

declare module 'claude-code' {
  interface PluginState {
    grandmaster: { tab: Shaped<Tab>; stats: Shaped<Stats> }
  }
}
