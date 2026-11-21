// The Shareefico mascot, the "mini-ibrahim" pixel sprite, copied unchanged from
// the author's video sprite.
// 20x24 pixels per frame; '.' is transparent. Never redraw it: the video sprite stays as it is.

export const PALETTE: Readonly<Record<string, string>> = {
  C: '#2f5a3b', c: '#3d7049', D: '#1d3a26', H: '#4a3528', S: '#f1b77c', s: '#dd9c62',
  G: '#1c1a19', E: '#2b1d15', B: '#3d2b21', T: '#babbb3', P: '#353333', p: '#232222',
}

const HEAD = [
  '........CCCCCC......',
  '.......CcCCCCCC.....',
  '......CcCCCCCCCC....',
  '.....CCCCCCCCCCC....',
  '..DDDCCCCCCCCCCC....',
  '.....HSSSSSSSSSH....',
  '.....HSSSSSSSSSH....',
  '....sGGGGGSGGGGGs...',
]
const BODY = [
  '.....GGGGGSGGGGG....',
  '.....BSSSSSSSSSB....',
  '.....BBSSBBBSSBB....',
  '.....BBBBBBBBBBB....',
]
const TORSO = [
  '......BBBBBBBBB.....',
  '....TTTBBBBBBBTTT...',
  '...TTTTTTBBBTTTTTT..',
  '...SSTTTTTTTTTTTSS..',
  '...SSTTTTTTTTTTTSS..',
  '......PPPPPPPPP.....',
]

export type Frame = readonly string[]

export const FRAMES: Readonly<Record<'idle' | 'walk_a' | 'walk_b' | 'think' | 'cheer', Frame>> = {
  idle: [
    ...HEAD, '....sGSESGGGSESGs...', '....sGSESGSGSESGs...', ...BODY,
    '.....BBBBSSSBBBB....', '.....BBBBBBBBBBB....', ...TORSO,
    '......PPP...PPP.....', '......ppp...ppp.....',
  ],
  walk_a: [
    ...HEAD, '....sGSESGGGSESGs...', '....sGSESGSGSESGs...', ...BODY,
    '.....BBBBSSSBBBB....', '.....BBBBBBBBBBB....', ...TORSO,
    '.....PPP.....PPP....', '.....ppp.....ppp....',
  ],
  walk_b: [
    ...HEAD, '....sGSESGGGSESGs...', '....sGSESGSGSESGs...', ...BODY,
    '.....BBBBSSSBBBB....', '.....BBBBBBBBBBB....', ...TORSO,
    '.......PPP.PPP......', '.......ppp.ppp......',
  ],
  think: [
    ...HEAD, '....sGSEGGGGSEGGs...', '....sGSSSGSGSSSGs...', ...BODY,
    '.....BBBBSSSBBBB....', '.....BBBBBBBBSSB....',
    '......BBBBBBBSS.....', '....TTTBBBBBBTTTT...', '...TTTTTTBBBTTTTTT..',
    '...SSTTTTTTTTTTT....', '...SSTTTTTTTTTTT....', '......PPPPPPPPP.....',
    '......PPP...PPP.....', '......ppp...ppp.....',
  ],
  cheer: [
    ...HEAD, '....sGSESGGGSESGs...', '....sGESEGSGESEGs...', ...BODY,
    '.....BBBSSSSSBBB....', '..SS.BBBBSSSBBBB.SS.',
    '..SS..BBBBBBBBB..SS.', '...TTTTBBBBBBBTTTT..', '...TTTTTTBBBTTTTTT..',
    '.....TTTTTTTTTTT....', '.....TTTTTTTTTTT....', '......PPPPPPPPP.....',
    '......PPP...PPP.....', '......ppp...ppp.....',
  ],
}

/** Halves a frame: each 2x2 block takes its most common colour, or stays
 *  transparent when fewer than two of its four pixels are filled. */
export function halve(frame: Frame): string[] {
  const out: string[] = []
  for (let y = 0; y + 1 < frame.length; y += 2) {
    let row = ''
    for (let x = 0; x + 1 < (frame[0]?.length ?? 0); x += 2) {
      const px = [frame[y]?.[x], frame[y]?.[x + 1], frame[y + 1]?.[x], frame[y + 1]?.[x + 1]]
        .filter((p): p is string => p !== undefined && p !== '.')
      if (px.length < 2) {
        row += '.'
        continue
      }
      const counts = new Map<string, number>()
      for (const p of px) counts.set(p, (counts.get(p) ?? 0) + 1)
      // Glasses and eyes win ties, so the face keeps its look at half size.
      const rank = (p: string) => (counts.get(p) ?? 0) * 10 + ('GE'.includes(p) ? 1 : 0)
      row += [...counts.keys()].sort((a, b) => rank(b) - rank(a))[0] ?? '.'
    }
    out.push(row)
  }
  return out
}
