// ─────────────────────────────────────────────────────────
//  Report Viewer — convert tournament markdown to styled HTML
// ─────────────────────────────────────────────────────────
//
//  Uses `marked` to convert markdown → HTML, wrapped in a
//  dark-themed page with Print/PDF support via Ctrl+P.
// ─────────────────────────────────────────────────────────

import { Marked } from "marked";

// ── Dark theme HTML wrapper ─────────────────────────────

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>⚔️ D&D Arena Reports</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #c9d1d9; --text-dim: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --red: #f85149; --yellow: #d29922;
    --gold: #ffd700;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.6; padding: 0;
  }

  .nav {
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 12px 24px; display: flex; align-items: center; gap: 16px;
    position: sticky; top: 0; z-index: 10;
  }
  .nav h1 { font-size: 18px; color: var(--accent); }
  .nav .spacer { flex: 1; }
  .nav button {
    background: var(--accent); color: var(--bg); border: none;
    padding: 6px 16px; border-radius: 6px; cursor: pointer; font-weight: 600;
  }
  .nav button:hover { opacity: 0.85; }

  .content { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }

  .md h1 { color: var(--gold); font-size: 28px; margin: 0 0 16px; border-bottom: 2px solid var(--border); padding-bottom: 12px; }
  .md h2 { color: var(--accent); font-size: 22px; margin: 24px 0 12px; }
  .md h3 { color: var(--text); font-size: 18px; margin: 20px 0 8px; }
  .md p { margin: 8px 0; }
  .md ul, .md ol { margin: 8px 0; padding-left: 24px; }
  .md li { margin: 4px 0; }
  .md strong { color: #fff; }
  .md em { color: var(--text-dim); }
  .md hr { border: none; border-top: 1px solid var(--border); margin: 24px 0; }
  .md blockquote {
    border-left: 3px solid var(--accent); padding: 8px 16px;
    background: var(--surface); border-radius: 0 6px 6px 0; margin: 12px 0;
  }

  .md table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 14px; }
  .md th { background: var(--surface); color: var(--accent); font-weight: 600; text-align: left; }
  .md th, .md td { padding: 8px 12px; border: 1px solid var(--border); }
  .md tr:nth-child(even) { background: rgba(255,255,255,0.02); }
  .md tr:hover { background: rgba(88,166,255,0.05); }

  .md code { background: var(--surface); padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  .md pre { background: var(--surface); padding: 16px; border-radius: 8px; overflow-x: auto; margin: 12px 0; }
  .md pre code { background: none; padding: 0; }

  .md details { margin: 8px 0; }
  .md summary { cursor: pointer; color: var(--accent); font-weight: 500; }
  .md details[open] summary { margin-bottom: 8px; }

  @media print {
    .nav { display: none !important; }
    body { background: white; color: black; }
    .md th { background: #f0f0f0; }
    .md table { font-size: 11px; }
    .content { padding: 16px; max-width: 100%; }
  }
</style>
</head>
<body>
<nav class="nav">
  <h1>⚔️ Arena Reports</h1>
  <div class="spacer"></div>
  <button onclick="window.print()">🖨️ Print / PDF</button>
</nav>
<div class="content">
{{CONTENT}}
</div>
</body>
</html>`;

// ── Public API ──────────────────────────────────────────

const marked = new Marked({
  gfm: true,
  breaks: false,
});

/** Convert a markdown string to a styled HTML page. */
export function markdownToHtml(md: string): string {
  const html = marked.parse(md) as string;
  return HTML_TEMPLATE.replace("{{CONTENT}}", html);
}
