# [Tom's Toolbox](https://tools.tomasmartinez.xyz)

Static site of browser tools. Plain HTML, CSS and ES modules: no framework, no build step, no backend. Files never leave the user's device.

```sh
npx serve .            # or: python3 -m http.server 8000
```

Serve from the repo root; `file://` won't work (ES modules + absolute `/assets/` paths).

Project docs live in the AGENTS.md files:

- [AGENTS.md](AGENTS.md): structure, tool registry, shared code, design rules, templates, how to add a tool or category.
- [video-effects/AGENTS.md](video-effects/AGENTS.md): how each video tool works, import/export details, performance.
- [convert/AGENTS.md](convert/AGENTS.md): the file converter, encoders, hashes, JSON, colors, timestamps and QR codes.
- [image/AGENTS.md](image/AGENTS.md): the image tools (mockups, code screenshots, editors, compression…), shared image helpers, libraries and limitations.
- [audio/AGENTS.md](audio/AGENTS.md): the extractor + transcript, trimmer, waveform videos and noise reduction, and the shared audio modules.
- [dev/AGENTS.md](dev/AGENTS.md): regex, diff, cron, CSS generators, SVG optimizer, meta tags, validators and generators.

Before a pull request, run the consistency check (Node 22+, no install):

```sh
node scripts/check.mjs           # registry, folders, thumbnails, meta tags, sitemap, issue templates, CDN pins
node scripts/check.mjs --fix     # rewrite share meta blocks, sitemap.xml and robots.txt
node scripts/og-images.mjs       # render share images (assets/img/og/*.png) from the SVG thumbnails
```

## Contributing

Ideas and bug reports are welcome: open an issue and pick **Feature request** or **Bug report**. Pull requests get a short checklist; read [AGENTS.md](AGENTS.md) first.

## License

© 2026 Tomas Martinez ([tomasmartinez.xyz](https://tomasmartinez.xyz)). Licensed under the [GNU GPL v3.0](LICENSE)
