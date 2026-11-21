// The Rubik's Cube in 3D: drag the background to spin it (it keeps the speed
// you throw it with), drag across a face to turn that layer, or use the
// buttons and keys. The rules engine holds the truth; after each animated turn
// the stickers are repainted from it, so the picture can never drift.
const STICKER = { U: '#f4f1ea', R: '#d62828', F: '#1f9d55', D: '#ffd23f', L: '#ff7a1a', B: '#2563eb' }
const TURN_SET = ['U', "U'", 'D', "D'", 'R', "R'", 'L', "L'", 'F', "F'", 'B', "B'", 'M', "M'", 'x', 'y', 'z']
const FACE_TURNS = ['U', 'D', 'R', 'L', 'F', 'B', 'M', 'E', 'S']
const NET = [[0, 3, 0], [4, 0, 3], [2, 3, 3], [1, 6, 3], [5, 9, 3], [3, 3, 6]] // [face, col, row] for the flat fallback
const MAX_QUEUE = 60

function readCubeSave(saved) {
  // Every stored token must be a real move: a bad one would stop the animation loop.
  const moves = v => Array.isArray(v) && v.every(x => typeof x === 'string' && CU.parseMove(x) !== null)
  const cube = CU.readCube(saved && saved.cube)
  if (!cube || !moves(saved.scrambledWith) || !moves(saved.history)) {
    return { cube: CU.solved(), scrambledWith: [], moves: 0, history: [], startedAt: null }
  }
  const startedAt = typeof saved.startedAt === 'number' && saved.startedAt <= Date.now() && saved.scrambledWith.length ? saved.startedAt : null
  return {
    cube, scrambledWith: saved.scrambledWith, moves: Number.isInteger(saved.moves) && saved.moves >= 0 ? saved.moves : 0,
    history: saved.history.slice(-500), startedAt,
  }
}

/** The move that rotates layer `k` (position along unit axis `a`) by +90 (sign 1) or -90 (sign -1) degrees about `a`. */
function moveFor(a, k, sign) {
  for (const base of FACE_TURNS) {
    const t = CU.TURNS[base]
    const s = t.axis[0] * a[0] + t.axis[1] * a[1] + t.axis[2] * a[2]
    if (s === 0 || s * t.layers[0] !== k) continue
    // A turn is -90 degrees about its own axis, which is s times `a`.
    return sign === -s ? base : `${base}'`
  }
  return null
}

function cube3d(stage, onTurn) {
  const THREE = window.THREE
  if (!THREE) throw new Error('three.js did not load')
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  stage.append(renderer.domElement)
  renderer.domElement.className = 'cube-canvas'
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  camera.position.set(0, 0, 11)
  scene.add(new THREE.AmbientLight(0xffffff, 0.75))
  const key = new THREE.DirectionalLight(0xffffff, 0.6)
  key.position.set(4, 6, 8)
  scene.add(key)
  const spin = new THREE.Group()
  spin.quaternion.setFromEuler(new THREE.Euler(0.5, -0.62, 0))
  scene.add(spin)

  // A white rounded square, tinted per sticker by its material colour.
  const tex = (() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')
    g.fillStyle = '#ffffff'
    g.beginPath()
    if (g.roundRect) g.roundRect(6, 6, 116, 116, 22)
    else g.rect(6, 6, 116, 116)
    g.fill()
    return new THREE.CanvasTexture(c)
  })()
  const body = new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 0.55 })
  const boxGeo = new THREE.BoxGeometry(0.97, 0.97, 0.97)
  const stickerGeo = new THREE.PlaneGeometry(0.86, 0.86)
  const cubies = []
  const stickers = new Map()
  const keyOf = (p, n) => `${p.join(',')}|${n.join(',')}`
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    if (!x && !y && !z) continue
    const cubie = new THREE.Mesh(boxGeo, body)
    cubie.position.set(x, y, z)
    cubie.userData.home = [x, y, z]
    for (const n of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      if (n[0] && n[0] !== x) continue
      if (n[1] && n[1] !== y) continue
      if (n[2] && n[2] !== z) continue
      const mesh = new THREE.Mesh(stickerGeo, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.35 }))
      mesh.position.set(n[0] * 0.49, n[1] * 0.49, n[2] * 0.49)
      mesh.lookAt(n[0], n[1], n[2])
      mesh.userData = { p: [x, y, z], n }
      cubie.add(mesh)
      stickers.set(keyOf([x, y, z], n), mesh)
    }
    spin.add(cubie)
    cubies.push(cubie)
  }

  function paint(cube) {
    CU.STICKERS.forEach((st, i) => {
      const mesh = stickers.get(keyOf(st.p, st.n))
      if (mesh) mesh.material.color.set(STICKER[cube[i]])
    })
    dirty = true
  }

  // ---- animation queue: turns play one after another; a long queue plays faster ----
  const queue = []
  let current = null
  let dirty = true
  const pivot = new THREE.Group()
  spin.add(pivot)

  function begin(move, cubeAfter) {
    const parsed = CU.parseMove(move)
    const t = CU.TURNS[parsed.base]
    const axis = new THREE.Vector3(...t.axis)
    const angle = parsed.times === 3 ? Math.PI / 2 : -Math.PI / 2 * parsed.times
    pivot.quaternion.identity()
    for (const c of cubies) {
      const d = c.userData.home[0] * t.axis[0] + c.userData.home[1] * t.axis[1] + c.userData.home[2] * t.axis[2]
      if (t.layers.includes(d)) pivot.attach(c)
    }
    const ms = reducedMotion.matches ? 0 : queue.length > 2 ? 70 : parsed.times === 2 ? 260 : 190
    current = { axis, angle, start: performance.now(), ms, cubeAfter }
  }
  function finish() {
    for (const c of [...pivot.children]) spin.attach(c)
    for (const c of cubies) {
      c.position.set(...c.userData.home)
      c.quaternion.identity()
    }
    pivot.quaternion.identity()
    paint(current.cubeAfter)
    current = null
  }
  function enqueue(move, cubeAfter) {
    // A backlog past a few scrambles' worth skips straight to the end state.
    if (queue.length >= MAX_QUEUE) {
      queue.length = 0
      if (current) finish()
      paint(cubeAfter)
      return
    }
    queue.push({ move, cubeAfter })
    if (!current) {
      const next = queue.shift()
      begin(next.move, next.cubeAfter)
    }
  }

  // ---- spinning the view, with momentum ----
  const spinVel = { x: 0, y: 0 }
  function spinBy(dx, dy) {
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx)
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy)
    spin.quaternion.premultiply(qy).premultiply(qx)
    dirty = true
  }

  // ---- pointer: a press on a sticker turns its layer by drag direction; elsewhere it spins ----
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  let gesture = null
  const toScreen = v => {
    const p = v.clone().project(camera)
    const r = renderer.domElement.getBoundingClientRect()
    return [(p.x + 1) / 2 * r.width, (1 - p.y) / 2 * r.height]
  }
  function onDown(e) {
    if (e.button !== 0) return
    e.preventDefault()
    renderer.domElement.setPointerCapture(e.pointerId)
    spinVel.x = spinVel.y = 0
    const r = renderer.domElement.getBoundingClientRect()
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    const hit = current ? null : ray.intersectObjects([...stickers.values()], false)[0]
    gesture = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, t: performance.now(), sticker: hit ? hit.object.userData : null, done: false }
  }
  function onMove(e) {
    if (!gesture) return
    const now = performance.now()
    if (!gesture.sticker) {
      const dx = (e.clientX - gesture.lastX) * 0.01
      const dy = (e.clientY - gesture.lastY) * 0.01
      spinBy(dx, dy)
      const dt = Math.max(1, now - gesture.t)
      spinVel.x = dx / dt
      spinVel.y = dy / dt
    } else if (!gesture.done) {
      const dx = e.clientX - gesture.x
      const dy = e.clientY - gesture.y
      // An unclear direction waits for more drag rather than giving up.
      if (Math.hypot(dx, dy) >= 14 && turnFromDrag(gesture.sticker, dx, dy)) gesture.done = true
    }
    gesture.lastX = e.clientX
    gesture.lastY = e.clientY
    gesture.t = now
  }
  function onUp() {
    if (gesture && !gesture.sticker && (performance.now() - gesture.t > 60 || reducedMotion.matches)) spinVel.x = spinVel.y = 0
    gesture = null
  }
  function turnFromDrag({ p, n }, dx, dy) {
    const len = Math.hypot(dx, dy)
    const centre = new THREE.Vector3(p[0] + n[0] * 0.5, p[1] + n[1] * 0.5, p[2] + n[2] * 0.5)
    const world = centre.clone().applyQuaternion(spin.quaternion)
    const [sx, sy] = toScreen(world)
    let best = null
    for (const a of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      if (a[0] * n[0] + a[1] * n[1] + a[2] * n[2] !== 0) continue
      // Where this sticker heads under a +90 degree turn about `a`, on screen.
      const along = new THREE.Vector3(...a).cross(centre).normalize().multiplyScalar(0.4)
      const [tx, ty] = toScreen(centre.clone().add(along).applyQuaternion(spin.quaternion))
      const vx = tx - sx
      const vy = ty - sy
      const vl = Math.hypot(vx, vy) || 1
      const dot = (vx * dx + vy * dy) / (vl * len)
      if (!best || Math.abs(dot) > Math.abs(best.dot)) best = { a, dot }
    }
    if (!best || Math.abs(best.dot) < 0.35) return false
    const k = Math.round(p[0] * best.a[0] + p[1] * best.a[1] + p[2] * best.a[2])
    const move = moveFor(best.a, k, best.dot > 0 ? 1 : -1)
    if (move) onTurn(move)
    return true
  }
  const canvas = renderer.domElement
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  // After the browser drops and restores the graphics context, draw again at once.
  const onRestored = () => { dirty = true }
  canvas.addEventListener('webglcontextrestored', onRestored)

  // ---- frame loop: draws only while something moves ----
  let frame = 0
  let last = performance.now()
  function loop(now) {
    const dt = Math.min(64, now - last)
    last = now
    if (current) {
      const t = current.ms ? Math.min(1, Math.max(0, (now - current.start) / current.ms)) : 1
      const eased = 1 - (1 - t) ** 3
      pivot.quaternion.setFromAxisAngle(current.axis, current.angle * eased)
      dirty = true
      if (t >= 1) {
        finish()
        const next = queue.shift()
        if (next) begin(next.move, next.cubeAfter)
      }
    }
    if (!gesture && (Math.abs(spinVel.x) > 1e-5 || Math.abs(spinVel.y) > 1e-5)) {
      spinBy(spinVel.x * dt, spinVel.y * dt)
      const friction = Math.pow(0.0025, dt / 1000)
      spinVel.x *= friction
      spinVel.y *= friction
    }
    if (dirty) {
      renderer.render(scene, camera)
      dirty = false
    }
    frame = requestAnimationFrame(loop)
  }
  const resize = () => {
    const w = stage.clientWidth
    const hgt = stage.clientHeight
    if (!w || !hgt) return
    renderer.setSize(w, hgt, false)
    camera.aspect = w / hgt
    camera.updateProjectionMatrix()
    dirty = true
  }
  const ro = new ResizeObserver(resize)
  ro.observe(stage)
  resize()
  frame = requestAnimationFrame(loop)

  return {
    paint,
    enqueue,
    /** Drops queued turns and ends the one playing, so a reset is not repainted by older states. */
    clear: () => {
      queue.length = 0
      if (current) finish()
    },
    resetView: () => {
      spinVel.x = spinVel.y = 0
      spin.quaternion.setFromEuler(new THREE.Euler(0.5, -0.62, 0))
      dirty = true
    },
    // Frees the GPU side too: a context per visit would otherwise pile up until the browser drops them.
    dispose: () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      canvas.removeEventListener('webglcontextrestored', onRestored)
      for (const mesh of stickers.values()) mesh.material.dispose()
      tex.dispose()
      body.dispose()
      boxGeo.dispose()
      stickerGeo.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}

function cubeGame(root) {
  let s = { ...readCubeSave(store.cube), finishedMs: null, showAlgs: false }
  s = { ...s, note: s.startedAt ? 'Solve resumed. The clock kept running while you were away.' : '' }
  const persist = () => saveGame('cube', { cube: s.cube, scrambledWith: s.scrambledWith, moves: s.moves, history: s.history, startedAt: s.startedAt })

  const stage = h('div', { class: 'cube-stage', role: 'img', 'aria-label': "Rubik's Cube. Drag the background to spin it, drag across a face to turn it." })
  const clock = h('div', { class: 'clock', 'aria-live': 'off' })
  const info = h('div', { class: 'rail' })
  root.replaceChildren(h('section', { class: 'panel' }, h('div', { class: 'rail' }, stage, clock), info))

  let view = null
  try {
    view = cube3d(stage, move => apply(move))
  } catch {
    stage.classList.add('flat')
  }
  const drawFlat = () => {
    if (view) return
    stage.replaceChildren(h('div', { class: 'net' }, NET.flatMap(([face, col, row]) => Array.from({ length: 9 }, (_, i) => h('div', {
      class: 'sticker',
      style: `grid-column:${col + (i % 3) + 1};grid-row:${row + Math.floor(i / 3) + 1};background:${STICKER[s.cube[face * 9 + i]]}`,
    })))))
  }
  view?.paint(s.cube)

  function turnBy(alg, base = s) {
    const tokens = alg.split(/\s+/).filter(Boolean)
    const solving = base.scrambledWith.length > 0 && base.finishedMs === null
    const startedAt = solving ? base.startedAt ?? Date.now() : base.startedAt
    let next = { ...base, moves: base.moves + tokens.length, history: [...base.history, ...tokens].slice(-500), startedAt, note: '' }
    // Each token animates on its own, the cube state after it attached.
    let cube = base.cube
    for (const tok of tokens) {
      cube = CU.turn(cube, tok)
      view?.enqueue(tok, cube)
    }
    next = { ...next, cube }
    if (solving && CU.isSolved(cube)) {
      const ms = Date.now() - startedAt
      addResult({ game: 'cube', ms })
      next = { ...next, finishedMs: ms, scrambledWith: [], startedAt: null, note: `Solved in ${formatMs(ms)} with ${next.moves} turns.` }
    }
    return next
  }
  const apply = alg => { s = turnBy(alg); persist(); render() }
  const scramble = () => {
    const moves = CU.scramble(Math.random)
    const scrambled = turnBy(moves.join(' '), { ...s, scrambledWith: [], finishedMs: null })
    s = { ...scrambled, scrambledWith: moves, moves: 0, history: [], startedAt: null, finishedMs: null, note: 'Scrambled. The clock starts on your first turn.' }
    persist()
    render()
  }
  const undo = () => {
    const last = s.history[s.history.length - 1]
    if (!last) return
    const inverse = last.endsWith("'") ? last.slice(0, -1) : last.endsWith('2') ? last : `${last}'`
    const turned = turnBy(inverse, { ...s, history: s.history.slice(0, -1) })
    s = { ...turned, history: turned.history.slice(0, -1), note: turned.note || `Undid ${last}.` }
    persist()
    render()
  }
  const reset = () => {
    s = { ...s, cube: CU.solved(), scrambledWith: [], moves: 0, history: [], startedAt: null, finishedMs: null, note: 'Reset to solved.' }
    view?.clear()
    view?.paint(s.cube)
    persist()
    render()
  }
  const clockText = () => s.finishedMs !== null ? formatMs(s.finishedMs) : s.startedAt !== null ? formatMs(Date.now() - s.startedAt) : '0.00'

  function render() {
    drawFlat()
    clock.textContent = clockText()
    const ao5 = ST.averageOfFive(record.cube.recentMs)
    // replaceChildren would print a null as the word "null": hidden lines are filtered out.
    info.replaceChildren(...[
      h('div', { class: 'record' },
        h('strong', {}, record.cube.bestMs === null ? '--' : formatMs(record.cube.bestMs)),
        h('span', { class: 'muted' }, `best · ${record.cube.solves} solves${ao5 === null ? '' : ` · ao5 ${formatMs(ao5)}`}`)),
      h('div', { class: 'status', 'aria-live': 'polite' }, s.note || (s.scrambledWith.length ? 'Solve it. The clock waits for your first turn.' : 'Scramble to start a timed solve.')),
      s.scrambledWith.length ? h('p', { class: 'faint' }, h('span', { class: 'label' }, 'Scramble '), s.scrambledWith.join(' ')) : null,
      h('div', { class: 'turns' }, TURN_SET.map(m => h('button', { class: 'btn', onclick: () => apply(m), 'aria-label': `Turn ${m}` }, m))),
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: scramble }, 'Scramble'),
        h('button', { class: 'btn', onclick: undo, disabled: s.history.length === 0 }, 'Undo'),
        h('button', { class: 'btn', onclick: reset }, 'Reset'),
        view ? h('button', { class: 'btn', onclick: () => view.resetView() }, 'Reset view') : null,
        h('button', { class: 'btn', 'aria-expanded': String(s.showAlgs), onclick: () => { s = { ...s, showAlgs: !s.showAlgs }; render() } }, s.showAlgs ? 'Hide algorithms' : 'Algorithms')),
      s.showAlgs ? h('div', { class: 'algs' }, CU.ALGS.map(a => h('button', { class: 'alg', onclick: () => apply(a.alg) }, a.name, h('code', {}, `${a.alg}  ·  x${a.order} returns to start`)))) : null,
      h('p', { class: 'faint' }, `${s.moves} turns. Drag a face to turn it, drag around the cube to spin it. Keys: U D R L F B M E S X Y Z, Shift for prime, Space scrambles, Backspace undoes.`),
    ].filter(Boolean))
  }
  render()
  const tick = setInterval(() => { if (s.startedAt !== null && s.finishedMs === null) clock.textContent = clockText() }, 47)
  const onKey = e => {
    if (typing(e) || modified(e)) return
    // Held keys repeat: one scramble or undo per press, never a flood.
    if (e.key === ' ') { e.preventDefault(); if (!e.repeat) scramble(); return }
    if (e.key === 'Backspace') { e.preventDefault(); if (!e.repeat) undo(); return }
    if (e.key.length !== 1) return
    const lower = e.key.toLowerCase()
    const base = 'udrlfbmes'.includes(lower) ? lower.toUpperCase() : 'xyz'.includes(lower) ? lower : null
    if (base) apply(e.shiftKey ? `${base}'` : base)
  }
  document.addEventListener('keydown', onKey)
  return () => {
    clearInterval(tick)
    document.removeEventListener('keydown', onKey)
    view?.dispose()
  }
}
