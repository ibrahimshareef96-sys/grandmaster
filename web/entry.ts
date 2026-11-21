// The web page's game logic: the same rule engines the pane uses, bundled
// into one global so the page plays exactly what the mod plays.
import * as chess from '../hooks/chess-engine'
import * as ai from '../hooks/chess-ai'
import * as cube from '../hooks/cube-engine'
import * as solitaire from '../hooks/solitaire-engine'
import * as runner from '../hooks/runner-engine'
import * as mascot from '../hooks/mascot'
import * as stats from '../hooks/stats'
import { formatMs } from '../hooks/time'

;(globalThis as Record<string, unknown>).GM = { chess, ai, cube, solitaire, runner, mascot, stats, formatMs }
