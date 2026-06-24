# 31 — Data Visualization via Browser

## Summary

When a user asks to visualize data (charts, graphs, plots), the agent should generate a self-contained HTML file using a charting library (Chart.js or Plotly via CDN) and open it in the system default browser with `open <file>`. No new tools or server changes required — uses existing `writeFile` and `shell` tools.

## Why Not Inline Terminal Charts

Terminal image protocols (Kitty, iTerm2, Sixel) have narrow support and produce static PNGs. Browser-based charts are interactive, zoomable, work on every OS, and require zero new infrastructure. This can be revisited later as an enhancement.

## Implementation

### System Prompt Addition

Add a visualization guidance block to the system prompt builder on the server. The instruction tells the agent:

1. Write a single self-contained `.html` file (CDN-linked Chart.js or Plotly, no local deps)
2. Embed the data directly in a `<script>` block — no fetch calls
3. Save to the project's working directory (e.g. `chart.html`, `visualization.html`)
4. Open with `open <filename>` (macOS) / `xdg-open` (Linux) / `start` (Windows) via the shell tool
5. Summarize the chart in text as well (for the conversation record)

### Prompt Text

Add to the BUILD mode section of the system prompt:

```
When asked to visualize or chart data, create a self-contained HTML file that uses Chart.js or Plotly loaded from CDN. Embed the data directly in the script — no external fetches. Save the file and open it in the user's browser with the `open` command (macOS), `xdg-open` (Linux), or `start` (Windows). Always describe the chart in text too.
```

### Where To Add

`packages/server/src/routes/chat.ts` → `buildSystemPrompt()` function, inside the BUILD-mode tool guidance section.

## Scope

- Server: ~3 lines added to system prompt builder
- CLI: No changes
- Shared: No changes
- Database: No changes

## Out of Scope

- Inline terminal chart rendering (future enhancement)
- Chart tool with structured input schema (over-engineered for this)
- Persisting generated charts across sessions
