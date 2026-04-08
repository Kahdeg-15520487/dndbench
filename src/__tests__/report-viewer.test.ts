// ─────────────────────────────────────────────────────────
//  Report Viewer Tests
// ─────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { markdownToHtml } from "../arena/report-viewer.js";

describe("Report Viewer", () => {
  describe("markdownToHtml", () => {
    it("wraps content in HTML template", () => {
      const html = markdownToHtml("# Hello");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("</html>");
    });

    it("converts markdown headings", () => {
      const html = markdownToHtml("# Title\n## Subtitle");
      expect(html).toContain("<h1");
      expect(html).toContain("Title");
      expect(html).toContain("<h2");
      expect(html).toContain("Subtitle");
    });

    it("converts markdown tables", () => {
      const md = "| A | B |\n|---|---|\n| 1 | 2 |";
      const html = markdownToHtml(md);
      expect(html).toContain("<table");
      expect(html).toContain("<th");
      expect(html).toContain("<td");
    });

    it("converts bold and italic text", () => {
      const html = markdownToHtml("**bold** and *italic*");
      expect(html).toContain("<strong>bold</strong>");
      expect(html).toContain("<em>italic</em>");
    });

    it("converts code blocks", () => {
      const html = markdownToHtml("```\ncode here\n```");
      expect(html).toContain("<pre");
      expect(html).toContain("<code");
      expect(html).toContain("code here");
    });

    it("includes print button in nav", () => {
      const html = markdownToHtml("# Test");
      expect(html).toContain("Print / PDF");
      expect(html).toContain("window.print()");
    });

    it("includes dark theme CSS variables", () => {
      const html = markdownToHtml("# Test");
      expect(html).toContain("--bg:");
      expect(html).toContain("--accent:");
      expect(html).toContain("--text:");
    });

    it("includes print media query", () => {
      const html = markdownToHtml("# Test");
      expect(html).toContain("@media print");
    });

    it("handles empty markdown", () => {
      const html = markdownToHtml("");
      expect(html).toContain("<!DOCTYPE html>");
    });

    it("handles markdown with links", () => {
      const html = markdownToHtml("[click here](http://example.com)");
      expect(html).toContain('<a href="http://example.com"');
      expect(html).toContain("click here");
    });

    it("handles markdown with lists", () => {
      const html = markdownToHtml("- item 1\n- item 2\n- item 3");
      expect(html).toContain("<ul");
      expect(html).toContain("<li");
    });

    it("handles markdown with blockquotes", () => {
      const html = markdownToHtml("> quote text");
      expect(html).toContain("<blockquote");
      expect(html).toContain("quote text");
    });

    it("handles markdown with horizontal rules", () => {
      const html = markdownToHtml("above\n\n---\n\nbelow");
      expect(html).toContain("<hr");
    });
  });
});
