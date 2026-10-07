# Toolbox

Static site of browser tools (tools.tomasmartinez.xyz). Plain HTML, CSS and ES modules: no framework, no build step, no backend. Files never leave the user's device.

```sh
npx serve .            # or: python3 -m http.server 8000
```

Serve from the repo root; `file://` won't work (ES modules + absolute `/assets/` paths).

Project docs live in the AGENTS.md files:
- [AGENTS.md](AGENTS.md): structure, tool registry, shared code, design rules, templates, how to add a tool or category.
- [video-effects/AGENTS.md](video-effects/AGENTS.md): how each video tool works, import/export details, performance.
