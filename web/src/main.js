// Starts the page: the 3D mascot in the header and the four game tabs. Keys 1 to
// 4 switch games; the open game is remembered and can be linked as #cube etc.
// Shown once decoded, so there is never a broken-image flash; a missing render leaves it hidden.
const headerMascot = document.getElementById('mascot')
headerMascot.onload = () => { headerMascot.hidden = false }
if (window.GM_ART?.idle) headerMascot.src = window.GM_ART.idle

const GAMES = [
  { id: 'chess', label: 'Chess', mount: chessGame },
  { id: 'cube', label: "Rubik's Cube", mount: cubeGame },
  { id: 'solitaire', label: 'Solitaire', mount: solitaireGame },
  { id: 'runner', label: 'Mascot Run', mount: runnerGame },
]
const tabs = document.getElementById('tabs')
const stage = document.getElementById('game')
let unmount = () => {}
let currentTab = GAMES.some(g => g.id === location.hash.slice(1)) ? location.hash.slice(1)
  : GAMES.some(g => g.id === store.tab) ? store.tab : 'chess'

function show(id) {
  try {
    unmount()
  } catch {
    // A game that fails to clean up must not stop the next one starting.
  }
  currentTab = id
  writeStore({ tab: id })
  // Keep a link's #game in step with the open game, so a reload stays here.
  if (location.hash && location.hash !== `#${id}`) {
    try { history.replaceState(null, '', `#${id}`) } catch { /* the frame may refuse it */ }
  }
  tabs.replaceChildren(...GAMES.map((g, i) => h('button', {
    class: 'tab', role: 'tab', 'aria-selected': String(g.id === id), onclick: () => show(g.id),
  }, g.label, h('kbd', {}, i + 1))))
  const game = GAMES.find(g => g.id === id) || GAMES[0]
  try {
    unmount = game.mount(stage)
  } catch (error) {
    unmount = () => {}
    stage.replaceChildren(h('p', { class: 'status' }, `${game.label} could not start here: ${error instanceof Error ? error.message : 'unknown error'}.`))
  }
}
document.addEventListener('keydown', e => {
  if (typing(e) || modified(e)) return
  const n = Number(e.key)
  if (n >= 1 && n <= GAMES.length) show(GAMES[n - 1].id)
})
window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1)
  if (GAMES.some(g => g.id === id) && id !== currentTab) show(id)
})
show(currentTab)
