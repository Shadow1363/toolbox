# [Tom's Toolbox](tools.tomasmartinez.xyz)

Static site of browser tools. Plain HTML, CSS and ES modules: no framework, no build step, no backend. Files never leave the user's device.

```sh
npx serve .            # or: python3 -m http.server 8000
```

Serve from the repo root; `file://` won't work (ES modules + absolute `/assets/` paths).

Project docs live in the AGENTS.md files:

- [AGENTS.md](AGENTS.md): structure, tool registry, shared code, design rules, templates, how to add a tool or category.
- [video-effects/AGENTS.md](video-effects/AGENTS.md): how each video tool works, import/export details, performance.
- [image/AGENTS.md](image/AGENTS.md): the image tools (mockups, code screenshots, editors, compression…), shared image helpers, libraries and limitations.

## Contributing

Ideas and bug reports are welcome: open an issue and pick **Feature request** or **Bug report**. Pull requests get a short checklist; read [AGENTS.md](AGENTS.md) first.

## License

© 2026 Tomas Martinez ([tomasmartinez.xyz](https://tomasmartinez.xyz)). Licensed under the [GNU GPL v3.0](LICENSE)
