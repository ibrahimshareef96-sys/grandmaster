// Builds web/dist/grandmaster.html: the page template with the Satoshi font,
// the bundled engines and the page's scripts inlined (the artifact host allows
// scripts only from a few CDNs). Run: bun web/build.ts
import { homedir } from 'node:os'
import { join } from 'node:path'

const here = import.meta.dir
const FONT = join(homedir(), 'Library/Fonts/Satoshi-Variable.ttf')
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
// Satoshi is not in the repository (its licence does not cover passing the file on).
// With it installed the page uses it; without it the page falls back to Arial.
const FONT_FACE = /@font-face \{\n  font-family: "Satoshi";[\s\S]*?\}\n/
if (!FONT_FACE.test(template)) {
  console.error('build: the Satoshi @font-face block in page.html has changed; update FONT_FACE')
  process.exit(1)
}
const fontFile = Bun.file(FONT)
const font = (await fontFile.exists()) ? Buffer.from(await fontFile.arrayBuffer()).toString('base64') : null
if (font === null) console.warn(`Satoshi not found at ${FONT}: building with the fallback font`)
const withFont = font === null ? template.replace(FONT_FACE, () => '') : template.replace('/*FONT*/', () => font)
// The 3D mascot renders (resized copies of the design system's cut-outs).
const dataUri = async (name: string) =>
  `data:image/webp;base64,${Buffer.from(await Bun.file(join(here, 'assets', name)).arrayBuffer()).toString('base64')}`
const art = JSON.stringify({ idle: await dataUri('mascot-3d-idle.webp'), cheer: await dataUri('mascot-3d-cheer.webp') })

// `</script` inside inlined code would end the tag early.
const safe = (code: string) => code.replaceAll('</script', '<\\/script')
const html = withFont
  .replace('/*ENGINE*/', () => safe(engine))
  .replace('/*APP*/', () => safe(app))
  .replace('/*ART*/', () => art)

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
await Bun.write(join(here, 'dist/app.check.js'), app)
await Bun.write(join(here, 'dist/grandmaster.html'), html)
console.log(`web/dist/grandmaster.html ${(html.length / 1024).toFixed(0)} KB`)
