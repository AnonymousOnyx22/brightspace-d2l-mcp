
import TurndownService from "turndown";

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

export function convertHtmlToMarkdown(
  html: string
): { markdown: string; html: string } {
  // Handle null/empty input
  if (!html || html.trim().length === 0) {
    return { markdown: "", html: "" };
  }

  try {
    const markdown = turndownService.turndown(html);
    return { markdown, html };
  } catch (error) {
    // If conversion fails, fallback to raw HTML
    return { markdown: html, html };
  }
}
