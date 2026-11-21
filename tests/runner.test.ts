import { describe, expect, test } from 'claude-code/testing'

import { FRAMES, halve } from '../hooks/mascot'
import { GROUND, HEIGHT, MASCOT_X, jump, newRun, release, score, step, type Runner } from '../hooks/runner-engine'

/** Plays like a careful person: jumps when the next bug is about to arrive. */
function autoplay(seed: number, frames: number): Runner {
  let r = jump(newRun(seed))
  for (let i = 0; i < frames && r.phase === 'running'; i++) {
    const next = r.obstacles.find(o => o.x + o.w > MASCOT_X + 3)
    const lead = 3 + r.speed * 2
    if (next && r.y === 0 && next.x - (MASCOT_X + 8) < lead) r = jump(r)
    r = step(r)
  }
  return r
}

describe('Mascot Run', () => {
  test('a jump rises, peaks inside the field and lands', async () => {
    let r = jump(newRun(1))
    let peak = 0
    for (let i = 0; i < 30; i++) {
      r = step(r)
      peak = Math.max(peak, r.y)
    }
    expect(peak).toBeGreaterThan(8)
    expect(peak).toBeLessThan(16)
    expect(r.y).toBe(0)
  })

  test('standing still, the first bug ends the run', async () => {
    let r: Runner = { ...newRun(3), phase: 'running' }
    for (let i = 0; i < 400 && r.phase === 'running'; i++) r = step(r)
    expect(r.phase).toBe('over')
  })

  test('every bug can be cleared: a careful player runs for minutes on many seeds', async () => {
    for (const seed of [1, 2, 3, 42, 99, 1234, 777777]) {
      const r = autoplay(seed, 20 * 60 * 3)
      expect([seed, r.phase]).toEqual([seed, 'running'])
      expect(score(r)).toBeGreaterThan(1000)
    }
  })

  test('the game starts, jumps and restarts from the one key', async () => {
    const ready = newRun(5)
    expect(jump(ready).phase).toBe('running')
    const over: Runner = { ...ready, phase: 'over', distance: 400 }
    expect(jump(over)).toMatchObject({ phase: 'running', distance: 0 })
    // In the air a press is held for three frames and fires on landing.
    const airborne: Runner = { ...ready, phase: 'running', y: 5, vy: 1 }
    expect(jump(airborne)).toEqual({ ...airborne, buffer: 3 })
  })

  test('letting go early makes a lower jump that still clears a low bug', async () => {
    const peakOf = (releaseAt: number | null) => {
      let r = jump(newRun(4))
      let peak = 0
      for (let i = 0; i < 30; i++) {
        if (i === releaseAt) r = release(r)
        r = step(r)
        peak = Math.max(peak, r.y)
      }
      return peak
    }
    expect(peakOf(1)).toBeLessThan(peakOf(null))
    expect(peakOf(1)).toBeGreaterThan(4)
  })

  test('a jump pressed just before landing fires on touchdown', async () => {
    let r: Runner = { ...newRun(9), phase: 'running', y: 0.5, vy: -1 }
    r = jump(r)
    r = step(r)
    expect(r.y).toBe(0)
    expect(r.vy).toBeGreaterThan(4)
    expect(r.buffer).toBe(0)
    r = step(r)
    expect(r.y).toBeGreaterThan(4)
  })

  test('at the top of a jump the whole mascot is inside the field', async () => {
    let r = jump(newRun(1))
    let peak = 0
    for (let i = 0; i < 30; i++) {
      r = step(r)
      peak = Math.max(peak, r.y)
    }
    // The mascot is 12 pixels tall at half size and stands on the ground band.
    expect(Math.round(peak) + 12 + GROUND).toBeLessThanOrEqual(HEIGHT)
  })

  test('the half-size mascot keeps its glasses', async () => {
    const small = halve(FRAMES.idle)
    expect(small.length).toBe(12)
    expect(small.every(row => row.length === 10)).toBe(true)
    expect(small.join('')).toContain('G')
  })
})
