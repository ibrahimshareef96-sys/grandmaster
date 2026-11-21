/** A duration as a speedcubing clock shows it: `9.42`, `1:05.30`. */
export function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 10))
  const cs = total % 100
  const sec = Math.floor(total / 100) % 60
  const min = Math.floor(total / 6000)
  return `${min > 0 ? `${min}:${String(sec).padStart(2, '0')}` : sec}.${String(cs).padStart(2, '0')}`
}
