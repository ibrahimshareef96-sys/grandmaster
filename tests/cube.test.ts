import { describe, expect, test } from 'claude-code/testing'

import { ALGS, BASE_TURNS, STICKERS, apply, isSolved, parseMove, readCube, scramble, solved, turn } from '../hooks/cube-engine'
import { formatMs } from '../hooks/time'

const face = (cube: readonly string[], f: number) => cube.slice(f * 9, f * 9 + 9).join('')
// Face order in the sticker array: U0 R1 F2 D3 L4 B5.

describe("Rubik's Cube", () => {
  test('every turn done four times is the identity, and once is not', async () => {
    for (const base of BASE_TURNS) {
      const once = turn(solved(), base)
      expect([base, isSolved(once) && !'xyz'.includes(base)]).toEqual([base, false])
      expect(apply(solved(), `${base} ${base} ${base} ${base}`)).toEqual(solved())
      expect(apply(solved(), `${base} ${base}'`)).toEqual(solved())
      expect(turn(solved(), `${base}2`)).toEqual(apply(solved(), `${base} ${base}`))
    }
  })

  test('R lifts the front right column onto the top, as a cuber expects', async () => {
    const c = turn(solved(), 'R')
    expect(face(c, 0)).toBe('UUFUUFUUF') // top's right column is now green (front)
    expect(face(c, 2)).toBe('FFDFFDFFD') // front's right column came from the bottom
    expect(face(c, 5)).toBe('UBBUBBUBB') // back's left column (seen from behind) came from the top
    expect(face(c, 1)).toBe('RRRRRRRRR')
  })

  test('U turns the front row to the left face', async () => {
    const c = turn(solved(), 'U')
    expect(face(c, 4).slice(0, 3)).toBe('FFF')
    expect(face(c, 2).slice(0, 3)).toBe('RRR')
  })

  test('the 3D view paints exactly what the rules say: each sticker place matches its face', async () => {
    // Every sticker of face f faces outward along f's normal, on that face's layer.
    const normals: Record<string, readonly number[]> = {
      U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1],
    }
    expect(STICKERS.length).toBe(54)
    STICKERS.forEach((st, i) => {
      const face = solved()[i] as string
      expect(st.n).toEqual(normals[face])
      expect(st.p[0] * st.n[0] + st.p[1] * st.n[1] + st.p[2] * st.n[2]).toBe(1)
    })
  })

  test('whole-cube rotations keep the cube solved', async () => {
    for (const r of ['x', 'y', 'z', "x'", 'y2']) expect(isSolved(turn(solved(), r))).toBe(true)
  })

  test('each listed algorithm returns to solved after its stated order, not before', async () => {
    for (const a of ALGS) {
      let c = solved()
      for (let i = 1; i <= a.order; i++) {
        c = apply(c, a.alg)
        expect([a.name, i, isSolved(c)]).toEqual([a.name, i, i === a.order])
      }
    }
  })

  test('a scramble follows the rules and mixes the cube', async () => {
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const moves = scramble(random)
    expect(moves.length).toBe(20)
    moves.forEach((m, i) => {
      expect(parseMove(m)).not.toBe(null)
      if (i > 0) expect(m[0]).not.toBe(moves[i - 1]?.[0])
    })
    expect(isSolved(apply(solved(), moves.join(' ')))).toBe(false)
  })

  test('a stored cube must hold nine stickers of each colour', async () => {
    expect(readCube(solved())).toEqual(solved())
    expect(readCube([...solved().slice(1), 'U'])).toEqual([...solved().slice(1), 'U'])
    expect(readCube([...solved().slice(0, 53), 'R'])).toBe(null)
    expect(readCube('UUU')).toBe(null)
  })

  test('times read like a cubing clock', async () => {
    expect(formatMs(9420)).toBe('9.42')
    expect(formatMs(65300)).toBe('1:05.30')
  })
})
