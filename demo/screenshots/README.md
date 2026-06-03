# Screenshots

Drop dashboard screenshots here (referenced by `demo/README.md` and the root README):

- `analyze.png` — a single run's five-pillar report (expand a task to show its transcript).
- `compare.png` — the cross-run comparison view (e.g. `toolkit-mcp @haiku` vs `@sonnet`).

To capture (uses the anonymized demo data — safe to share):

```bash
npm run build
node dist/cli/index.js view --out demo/results   # → http://localhost:4000
```
