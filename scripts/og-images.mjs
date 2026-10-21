#!/usr/bin/env node
/*
 * Renders the share images (og:image) from the 16:10 SVG thumbnails: social sites don't show SVG.
 *
 *   node scripts/og-images.mjs            # only missing or older-than-their-SVG images
 *   node scripts/og-images.mjs --all      # everything
 *
 * Writes assets/img/og/<id>.png (1200×750) for every category and tool, plus og/default.png from
 * assets/img/og-default.svg (home page). The PNGs are committed; the site still has no build step.
 * Needs network once: resvg is installed into a cache folder outside the repo, not into node_modules.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESVG = '@resvg/resvg-js@2.6.2';
const ALL = process.argv.includes('--all');
const { tools, categories } = await import(pathToFileURL(join(ROOT, 'assets/js/tools.js')));

const cache = join(tmpdir(), 'toolbox-og-resvg');
if (!existsSync(join(cache, 'node_modules/@resvg/resvg-js'))) {
  mkdirSync(cache, { recursive: true });
  console.log(`Installing ${RESVG} into ${cache}…`);
  execFileSync('npm', ['install', '--silent', '--no-save', '--prefix', cache, RESVG], { stdio: 'inherit' });
}
const { Resvg } = createRequire(join(cache, 'package.json'))('@resvg/resvg-js');

const out = join(ROOT, 'assets/img/og');
mkdirSync(out, { recursive: true });
const jobs = [
  ['default', '/assets/img/og-default.svg'],
  ...[...categories, ...tools.filter((t) => t.status !== 'soon')].map((x) => [x.id, x.thumbnail]),
];
let made = 0;
for (const [id, thumb] of jobs) {
  const src = join(ROOT, thumb.slice(1));
  const dest = join(out, `${id}.png`);
  if (!thumb.endsWith('.svg')) { console.warn(`skip ${id}: ${thumb} is not an SVG`); continue; }
  if (!ALL && existsSync(dest) && statSync(dest).mtimeMs >= statSync(src).mtimeMs) continue;
  const png = new Resvg(readFileSync(src, 'utf8'), { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: true } }).render().asPng();
  writeFileSync(dest, png);
  made++;
}
console.log(`${made} share image(s) written to assets/img/og/.`);
