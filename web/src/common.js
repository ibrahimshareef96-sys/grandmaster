// Shared by every game on the page: storage, a DOM helper, motion helpers and
// drag-and-drop. Concatenated with the other web/src files into one script.
const { chess: C, ai: AI, cube: CU, solitaire: SO, runner: RU, mascot: MA, stats: ST, formatMs } = window.GM

// ---- storage: this browser only, every access guarded ----
const STORE_KEY = 'grandmaster.web.v1'
function readStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}
let store = readStore()
// Each write starts from this page's own copy, then what is stored now (a second
// window's saves), then the change. With storage blocked or full, the page's
// own copy still carries every game for the visit.
function writeStore(patch) {
  store = { ...store, ...readStore(), ...patch }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // Private windows and blocked storage: the games still play, nothing is kept.
  }
}
const saveGame = (key, value) => writeStore({ [key]: value })
let record = ST.readStats(store.stats)
function addResult(result) {
  record = ST.addResult(ST.readStats({ ...store, ...readStore() }.stats), result)
  writeStore({ stats: record })
}

// ---- DOM ----
function h(tag, props, ...kids) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') node.className = v
    else if (k === 'style') node.style.cssText = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else node.setAttribute(k, v === true ? '' : String(v))
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)))
  }
  return node
}
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const typing = e => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
const modified = e => e.ctrlKey || e.metaKey || e.altKey

function paintSprite(ctx, frame, x0, y0, px) {
  frame.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      const key = line[x]
      if (key === '.') continue
      ctx.fillStyle = MA.PALETTE[key] || '#000'
      ctx.fillRect(x0 + x * px, y0 + y * px, px, px)
    }
  })
}

// ---- motion ----
const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)'

/** Glides `node` from a screen rectangle to where it now sits. The start is the
 *  rectangle as measured (transforms included), so a move begun mid-flight
 *  continues from where the eye last saw it. */
function glideFrom(node, from, ms = 220) {
  if (!node || !from || reducedMotion.matches) return
  const to = node.getBoundingClientRect()
  const dx = from.left - to.left
  const dy = from.top - to.top
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
  node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: ms, easing: EASE_OUT })
}

/** Measures every `[data-key]` under `root`, runs `change` (which redraws),
 *  then glides each redrawn node with the same key from its old place. */
function glideAll(root, change) {
  const before = new Map()
  root.querySelectorAll('[data-key]').forEach(n => before.set(n.dataset.key, n.getBoundingClientRect()))
  change()
  root.querySelectorAll('[data-key]').forEach(n => glideFrom(n, before.get(n.dataset.key)))
}

/** The drag under way, if any: one at a time, so a lost release can never leave two running. */
let activeDrag = null
/** True while a piece or card is held: key shortcuts wait until it is let go. */
const dragging = () => activeDrag !== null

/**
 * Drag and drop with the pointer. On a press of `nodes[0]` the nodes follow the
 * pointer exactly once it has moved 4px. On release, `drop(target, rect)` runs
 * once: `target` is the element with `data-drop` under the pointer (or null),
 * `rect` the first node's place on screen. It returns true when the move was
 * made (the caller redraws and glides from `rect`); otherwise the nodes ease
 * back from where they were let go. A press that never moved is a click.
 * Only the pointer that pressed counts; a cancelled press does nothing.
 */
function startDrag(e, nodes, { drop, click, lift }) {
  if (e.button !== undefined && e.button !== 0) return
  activeDrag?.cancel()
  const id = e.pointerId
  const startX = e.clientX
  const startY = e.clientY
  let moved = false
  let dx = 0
  let dy = 0
  const first = nodes[0]
  try { first.setPointerCapture(id) } catch { /* the pointer is already gone */ }

  function detach() {
    first.removeEventListener('pointermove', onMove)
    first.removeEventListener('pointerup', onUp)
    first.removeEventListener('pointercancel', onCancel)
    first.removeEventListener('lostpointercapture', onLost)
    activeDrag = null
  }
  function easeBack() {
    for (const n of nodes) {
      n.style.transform = ''
      if (reducedMotion.matches || !n.isConnected) {
        n.classList.remove('lifted')
        continue
      }
      // Stays lifted (above its neighbours) until it is home.
      const anim = n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 200, easing: EASE_OUT })
      anim.onfinish = () => n.classList.remove('lifted')
      anim.oncancel = () => n.classList.remove('lifted')
    }
  }
  function onMove(ev) {
    if (ev.pointerId !== id) return
    dx = ev.clientX - startX
    dy = ev.clientY - startY
    if (!moved && Math.hypot(dx, dy) < 4) return
    if (!moved) {
      moved = true
      nodes.forEach(n => n.classList.add('lifted'))
      lift?.()
    }
    for (const n of nodes) n.style.transform = `translate(${dx}px, ${dy}px)`
  }
  function onUp(ev) {
    if (ev.pointerId !== id) return
    detach()
    if (!moved) return click?.()
    const rect = first.getBoundingClientRect()
    nodes.forEach(n => { n.style.visibility = 'hidden' })
    const under = document.elementFromPoint(ev.clientX, ev.clientY)
    nodes.forEach(n => { n.style.visibility = '' })
    const target = under ? under.closest('[data-drop]') : null
    if (!drop(target, rect)) easeBack()
  }
  function cancel() {
    detach()
    if (moved) {
      easeBack()
      drop(null, first.getBoundingClientRect())
    }
  }
  function onCancel(ev) {
    if (ev.pointerId === id) cancel()
  }
  // Capture is lost when the node is redrawn away or the browser takes the pointer.
  function onLost(ev) {
    if (ev.pointerId === id && activeDrag === handle) cancel()
  }
  const handle = { cancel }
  activeDrag = handle
  first.addEventListener('pointermove', onMove)
  first.addEventListener('pointerup', onUp)
  first.addEventListener('pointercancel', onCancel)
  first.addEventListener('lostpointercapture', onLost)
}
