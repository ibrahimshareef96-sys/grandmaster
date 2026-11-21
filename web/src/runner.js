// Mascot Run on the web page: the pane's runner, drawn smooth at screen
// resolution. Hold to leap, tap to hop; the mascot is the original pixel sprite.
function runnerGame(root) {
  const STEP = 50
  let run = RU.newRun(Math.floor(Math.random() * 2 ** 31))
  let prev = run
  let best = Math.max(RU.readBest(store.runner && store.runner.best), record.runner.best)
  let newBest = false
  let acc = 0
  let last = performance.now()
  let frame = 0
  let overAt = 0
  let dirty = true
  let dust = []
  const LAND_MS = 140
  const TUMBLE_MS = 420
  const POSE_MS = 900
  // The pose drawn last frame; each frame eases it toward the pose the run calls for.
  const pose = { at: 0, lift: 0, bob: 0, angle: 0, sy: 1, pivot: 0, phase: 0, air: false, landedAt: -Infinity }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const approach = (v, target, dt, tau) => (tau <= 0 ? target : v + (target - v) * (1 - Math.exp(-dt / tau)))
  // The approved 3D renders, inlined by the build as data URIs.
  const art = {
    idle: Object.assign(new Image(), { src: window.GM_ART?.idle || '' }),
    cheer: Object.assign(new Image(), { src: window.GM_ART?.cheer || '' }),
  }
  art.idle.onload = () => { dirty = true }
  art.cheer.onload = () => { dirty = true }
  const canvas = h('canvas', { class: 'field', role: 'img', 'aria-label': 'Mascot Run. Hold Space or press the field to jump.', style: `aspect-ratio:${RU.WIDTH}/${RU.HEIGHT}`, tabindex: '0' })
  const hud = h('div', { class: 'record' })
  const statusEl = h('div', { class: 'status', 'aria-live': 'polite' })
  // The pointer presses and releases the jump; Enter on the focused button is a
  // keyboard click (detail 0) and jumps once. Space is the page-wide key.
  const btn = h('button', {
    class: 'btn primary',
    onpointerdown: e => { e.preventDefault(); press() },
    onpointerup: () => letGo(),
    onpointercancel: () => letGo(),
    onclick: e => { if (e.detail === 0) { press(); letGo() } },
    onkeydown: e => { if (e.key === ' ') e.preventDefault() },
  }, 'Start')
  root.replaceChildren(h('section', { class: 'panel' },
    h('div', { class: 'rail' }, canvas),
    h('div', { class: 'rail' }, hud, statusEl, h('div', { class: 'controls' }, btn),
      h('p', { class: 'faint' }, 'Hold Space, the up arrow or the field to leap; tap to hop. The bugs speed up the longer you last.'))))
  const ctx = canvas.getContext('2d')
  const lerp = (a, b, t) => a + (b - a) * t

  function press() {
    if (run.phase === 'over') {
      // Keys mashed at the crash must not restart the run before it is seen.
      if (performance.now() - overAt < RU.RESTART_DELAY_MS) return
      newBest = false
      dust = []
    }
    const wasRunning = run.phase === 'running'
    run = RU.jump(run)
    if (!wasRunning) prev = run
    dirty = true
    renderHud()
  }
  function letGo() {
    run = RU.release(run)
  }
  function renderHud() {
    hud.replaceChildren(h('strong', {}, String(RU.score(run)).padStart(5, '0')), h('span', { class: 'muted' }, `best ${String(best).padStart(5, '0')} · ${record.runner.runs} runs`))
    statusEl.textContent = run.phase === 'ready' ? 'Press Space or the field to run.'
      : run.phase === 'over' ? (newBest ? `New best: ${RU.score(run)}.` : `Caught by a bug at ${RU.score(run)}.`)
      : 'Jump the bugs.'
    btn.textContent = run.phase === 'running' ? 'Jump' : run.phase === 'over' ? 'Run again' : 'Start'
  }
  function crash() {
    const points = RU.score(run)
    newBest = points > best
    best = Math.max(best, points)
    overAt = performance.now()
    addResult({ game: 'runner', score: points })
    saveGame('runner', { best })
    dirty = true
    renderHud()
  }

  function drawBug(x, top, o, S, groundY, t) {
    // Legs scuttle with time unless motion is reduced.
    const wiggle = reducedMotion.matches ? 0 : Math.sin(t / 60 + x) * S * 0.25
    ctx.strokeStyle = '#7a222a'
    ctx.lineWidth = Math.max(1, S * 0.3)
    ctx.lineCap = 'round'
    for (let lx = 0.7; lx < o.w; lx += 1.1) {
      ctx.beginPath()
      ctx.moveTo(x + lx * S, groundY - S * 0.8)
      ctx.lineTo(x + lx * S - S * 0.5 + wiggle, groundY)
      ctx.stroke()
    }
    const grad = ctx.createLinearGradient(0, top, 0, groundY)
    grad.addColorStop(0, '#ff6b6f')
    grad.addColorStop(1, '#c2333a')
    ctx.fillStyle = grad
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(x, top + S * 0.4, o.w * S, (o.h - 1) * S, S * 1.4)
    else ctx.rect(x, top + S * 0.4, o.w * S, (o.h - 1) * S)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.fillRect(x + S * 0.6, top + S * 0.9, o.w * S - S * 1.2, S * 0.5)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x + S * 1.1, top + S * 1.9, S * 0.55, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#15151c'
    ctx.beginPath()
    ctx.arc(x + S * 0.95, top + S * 1.95, S * 0.25, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#ff6b6f'
    ctx.beginPath()
    ctx.moveTo(x + S * 0.9, top + S * 0.6)
    ctx.quadraticCurveTo(x - S * 0.2, top - S * 0.6, x - S * 0.5, top - S * 0.2)
    ctx.stroke()
  }

  function draw(t, now) {
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(canvas.clientWidth * dpr)
    const hgt = Math.round(w * RU.HEIGHT / RU.WIDTH)
    if (!w) return
    if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt }
    const S = w / RU.WIDTH
    const groundY = (RU.HEIGHT - RU.GROUND) * S
    const dist = lerp(prev.distance, run.distance, t)
    const still = reducedMotion.matches
    const sky = ctx.createLinearGradient(0, 0, 0, hgt)
    sky.addColorStop(0, '#0d1016')
    sky.addColorStop(1, '#1c2230')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, hgt)
    // Two layers of distant server racks, drifting at different speeds.
    for (const [speed, color, base] of [[0.08, '#191e28', 9], [0.22, '#232a37', 6]]) {
      const drift = still ? 0 : dist * speed
      ctx.fillStyle = color
      for (let i = -1; i < 12; i++) {
        const span = 76
        const bx = ((i * 7.3 - drift) % span + span) % span - 6
        const bh = base + ((i * 37) % 5)
        ctx.fillRect(bx * S, groundY - bh * S, 5.5 * S, bh * S)
        ctx.fillStyle = 'rgba(52,208,127,0.35)'
        if ((i + Math.floor(now / 700)) % 3 === 0 && !still) ctx.fillRect((bx + 1) * S, groundY - (bh - 1.2) * S, S * 0.6, S * 0.4)
        ctx.fillStyle = color
      }
    }
    ctx.fillStyle = '#2b313c'
    ctx.fillRect(0, groundY, w, hgt - groundY)
    ctx.fillStyle = '#434b58'
    ctx.fillRect(0, groundY, w, S * 0.35)
    ctx.fillStyle = '#59606b'
    const shift = still ? 0 : dist
    for (let x = 0; x < RU.WIDTH + 9; x += 9) {
      const sx = ((x - shift) % (RU.WIDTH + 9) + RU.WIDTH + 9) % (RU.WIDTH + 9)
      ctx.fillRect(sx * S, groundY + S * 1.0, S * 1.6, S * 0.3)
    }
    for (const o of run.obstacles) {
      const before = prev.obstacles.find(p => p.w === o.w && p.h === o.h && Math.abs(p.x - o.x) < 6)
      const x = (before ? lerp(before.x, o.x, t) : o.x) * S
      drawBug(x, groundY - o.h * S, o, S, groundY, now)
    }
    dust = dust.filter(d => now - d.born < 400)
    for (const d of dust) {
      const age = (now - d.born) / 400
      ctx.fillStyle = `rgba(166,164,176,${0.5 * (1 - age)})`
      ctx.beginPath()
      ctx.arc((RU.MASCOT_X + 5 + d.vx * age * 6) * S, groundY - age * S * 1.5, S * (0.4 + age * 0.6), 0, Math.PI * 2)
      ctx.fill()
    }
    const y = lerp(prev.y, run.y, t)
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.beginPath()
    ctx.ellipse((RU.MASCOT_X + 5.5) * S, groundY + S * 0.2, S * Math.max(1.5, 3.4 - y * 0.12), S * 0.5, 0, 0, Math.PI * 2)
    ctx.fill()
    drawFigure(S, groundY, y, lerp(prev.vy, run.vy, t), now)
  }

  /**
   * The 3D figure, posed by motion rather than new art (the approved render is
   * never redrawn): a bob and forward lean while running, a stretch on the way
   * up, a squash on landing, a forward trip when caught, a hop on a new best.
   *
   * Each frame works out a target pose, and the drawn pose eases toward it from
   * wherever it is now, so nothing ever jumps between phases: a takeoff leaves
   * the stride smoothly, a mid-air crash settles to the ground, and the next run
   * gets back up from the trip. The height follows the physics exactly.
   */
  function drawFigure(S, groundY, y, vy, now) {
    const dt = pose.at ? Math.min(64, Math.max(0, now - pose.at)) : 0
    pose.at = now
    const img = run.phase === 'over' && newBest ? art.cheer : art.idle
    if (!img.complete || !img.naturalWidth) {
      // The renders load from inside the page; until then, the pixel sprite stands in.
      paintSprite(ctx, MA.FRAMES.idle, RU.MASCOT_X * S, groundY - y * S - 12 * S, S / 2)
      return
    }
    const still = reducedMotion.matches
    // 12.2 units tall: at the top of a full jump (15.3) the cap stays inside the 28-unit sky.
    const height = 12.2 * S
    const width = height * img.naturalWidth / img.naturalHeight
    // In the air as soon as a jump starts (upward speed), not a tick later.
    const air = run.phase === 'running' && (y > 0.01 || vy > 0)
    if (pose.air && !air && run.phase === 'running') {
      // Landing is judged on the drawn height, so the squash meets the ground.
      pose.landedAt = now
      if (!still) dust.push({ born: now, vx: -1 }, { born: now, vx: 1 })
    }
    pose.air = air

    let target = { bob: 0, angle: 0, sy: 1, pivot: 0 }
    if (run.phase === 'running' && !still) {
      if (air) {
        // Up: stretched and leaning back a touch; down: easing forward.
        target = { bob: 0, pivot: 0, sy: clamp(1 + vy * 0.025, 0.94, 1.1), angle: -0.06 + clamp(-vy * 0.02, -0.08, 0.08) }
      } else {
        // About four strides a second, a little quicker as the run speeds up.
        pose.phase += dt * (0.011 + run.speed * 0.0012)
        const since = now - pose.landedAt
        const squash = since < LAND_MS ? 0.14 * (1 - since / LAND_MS) : 0
        target = { bob: Math.abs(Math.sin(pose.phase)) * 0.5, pivot: 0, sy: 1 - 0.03 * Math.cos(pose.phase * 2) - squash, angle: 0.1 }
      }
    } else if (run.phase === 'over' && !still) {
      const fade = Math.max(0, 1 - (now - overAt) / TUMBLE_MS)
      target = newBest
        ? { bob: Math.abs(Math.sin((now - overAt) / 170)) * 1.4 * fade, angle: 0, sy: 1, pivot: 0 }
        // Tripped while running forward: he pitches forward over the front toe.
        : { bob: 0, angle: 1.2, sy: 1, pivot: 0.3 }
    }
    const over = run.phase === 'over'
    pose.bob = approach(pose.bob, target.bob, dt, still ? 0 : 45)
    pose.angle = approach(pose.angle, target.angle, dt, still ? 0 : over ? 110 : 45)
    pose.pivot = approach(pose.pivot, target.pivot, dt, still ? 0 : over ? 110 : 45)
    pose.sy = approach(pose.sy, target.sy, dt, still ? 0 : 25)
    // Running, the height is the physics; once caught, he settles to the ground from where he was.
    pose.lift = over ? approach(pose.lift, 0, dt, still ? 0 : 90) : y

    const pivot = pose.pivot * width
    const footX = (RU.MASCOT_X + 5.5) * S + pivot
    const footY = groundY - (pose.lift + pose.bob) * S
    ctx.save()
    ctx.translate(footX, footY)
    ctx.rotate(pose.angle)
    ctx.scale(1 / Math.sqrt(pose.sy), pose.sy)
    ctx.drawImage(img, -width / 2 - pivot, -height, width, height)
    ctx.restore()
  }

  function loop(now) {
    const dt = Math.min(250, now - last)
    last = now
    if (run.phase === 'running') {
      acc += dt
      while (acc >= STEP && run.phase === 'running') {
        prev = run
        run = RU.step(run)
        acc -= STEP
        if (run.phase === 'over') crash()
        else if (run.tick % 4 === 0) hud.firstChild.textContent = String(RU.score(run)).padStart(5, '0')
      }
    } else acc = 0
    // Idle (ready or over) the field does not change: draw it once, not every frame.
    // After a crash the tumble (or the new-best hop) plays out before the field rests.
    const posing = run.phase === 'over' && now - overAt < POSE_MS
    if (run.phase === 'running' || dirty || dust.length || posing) {
      // A field not laid out yet (width 0) stays marked for drawing.
      dirty = canvas.clientWidth === 0
      draw(run.phase === 'running' ? acc / STEP : 1, now)
    }
    frame = requestAnimationFrame(loop)
  }
  const JUMP_KEYS = [' ', 'ArrowUp', 'w']
  const onKey = e => {
    if (typing(e) || modified(e) || !JUMP_KEYS.includes(e.key)) return
    e.preventDefault()
    if (!e.repeat) press()
  }
  const onKeyUp = e => { if (JUMP_KEYS.includes(e.key)) letGo() }
  // Capture keeps the release with the canvas, so letting go anywhere ends the leap.
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault()
    try { canvas.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    press()
  })
  canvas.addEventListener('pointerup', letGo)
  canvas.addEventListener('pointercancel', letGo)
  document.addEventListener('keydown', onKey)
  document.addEventListener('keyup', onKeyUp)
  // Coming back to the tab resumes from that moment: no burst of missed frames.
  const onVisible = () => {
    if (!document.hidden) {
      last = performance.now()
      acc = 0
      dirty = true
    }
  }
  const onResize = () => { dirty = true }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('resize', onResize)
  renderHud()
  frame = requestAnimationFrame(loop)
  return () => {
    cancelAnimationFrame(frame)
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('keyup', onKeyUp)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('resize', onResize)
  }
}
