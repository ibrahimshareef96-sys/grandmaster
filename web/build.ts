// Builds the full version of the games: the page template with the bundled
// engines, the page's scripts and the mascot renders inlined.
//
//   bun web/build.ts           web/dist/grandmaster.html, Satoshi inlined when it is
//                              installed (for a host that allows only a few CDNs)
//   bun web/build.ts --public  docs/index.html, the page GitHub Pages serves: a whole
//                              document, Satoshi linked from Fontshare, never inlined
import { homedir } from 'node:os'
import { join } from 'node:path'

const here = import.meta.dir
const PUBLIC = process.argv.includes('--public')
const FONT = join(homedir(), 'Library/Fonts/Satoshi-Variable.ttf')
// Fontshare's own stylesheet: the font is served by Fontshare, not passed on by us.
const FONT_LINK = '<link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,700,900&display=swap">\n'
const DOCUMENT_HEAD =
  '<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
// One scope, in this order: shared helpers first, the tabs last.
const SOURCES = ['common.js', 'chess.js', 'cube.js', 'solitaire.js', 'runner.js', 'main.js']

const bundle = await Bun.build({ entrypoints: [join(here, 'entry.ts')], format: 'iife', minify: true, target: 'browser' })
if (!bundle.success) {
  for (const log of bundle.logs) console.error(log)
  process.exit(1)
}
const engine = await bundle.outputs[0]!.text()
const parts = await Promise.all(SOURCES.map(f => Bun.file(join(here, 'src', f)).text()))
const app = `(() => {\n'use strict'\n${parts.join('\n')}\n})()\n`
const template = await Bun.file(join(here, 'page.html')).text()

// Satoshi's file is never in the repository (its licence does not cover passing the
// file on). Inlined when it is installed and the build is private; otherwise linked.
const FONT_FACE = /@font-face \{\n  font-family: "Satoshi";[\s\S]*?\}\n/
if (!FONT_FACE.test(template)) {
  console.error('build: the Satoshi @font-face block in page.html has changed; update FONT_FACE')
  process.exit(1)
}
const fontFile = Bun.file(FONT)
const font = !PUBLIC && (await fontFile.exists()) ? Buffer.from(await fontFile.arrayBuffer()).toString('base64') : null
if (font === null && !PUBLIC) console.warn(`Satoshi not found at ${FONT}: linking it from Fontshare`)
const withFont = font === null
  ? FONT_LINK + template.replace(FONT_FACE, () => '')
  : template.replace('/*FONT*/', () => font)

// The 3D mascot renders (resized copies of the design system's cut-outs).
const dataUri = async (name: string) =>
  `data:image/webp;base64,${Buffer.from(await Bun.file(join(here, 'assets', name)).arrayBuffer()).toString('base64')}`
const art = JSON.stringify({ idle: await dataUri('mascot-3d-idle.webp'), cheer: await dataUri('mascot-3d-cheer.webp') })

// `</script` inside inlined code would end the tag early.
const safe = (code: string) => code.replaceAll('</script', '<\\/script')
const body = withFont
  .replace('/*ENGINE*/', () => safe(engine))
  .replace('/*APP*/', () => safe(app))
  .replace('/*ART*/', () => art)
const html = PUBLIC ? DOCUMENT_HEAD + body : body

// Every placeholder must have been filled: a leftover marker would break the page silently.
for (const marker of ['/*FONT*/', '/*ENGINE*/', '/*APP*/', '/*ART*/']) {
  if (html.includes(marker)) {
    console.error(`build: ${marker} was not replaced`)
    process.exit(1)
  }
}
if (!html.includes('window.GM_ART = {')) {
  console.error('build: the mascot renders were not inlined')
  process.exit(1)
}
if (PUBLIC && (/@font-face\s*\{[^}]*Satoshi/.test(html) || html.includes('base64,AAEAAA'))) {
  console.error('build: the public page must not carry the font file')
  process.exit(1)
}

const out = PUBLIC ? join(here, '../docs/index.html') : join(here, 'dist/grandmaster.html')
if (!PUBLIC) await Bun.write(join(here, 'dist/app.check.js'), app)
await Bun.write(out, html)
console.log(`${PUBLIC ? 'docs/index.html' : 'web/dist/grandmaster.html'} ${(html.length / 1024).toFixed(0)} KB`)
