import type { Session } from "../shared/types.js";

/** Escape backticks so a selector containing ``` doesn't break the surrounding code span. */
function safeBackticks(s: string): string {
  return s.replace(/`/g, "\\`");
}

/**
 * Strip control chars and escape backticks from the session title before it
 * lands in a markdown heading. Filenames on POSIX systems are allowed to
 * contain newlines, `#`, `>`, and backticks — which would let a maliciously-
 * named .html file inject markdown structure (or worse, agent instructions)
 * into the additionalContext stream. Same threat model as safeComment.
 */
function safeTitle(s: string): string {
  return s
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/`/g, "\\`")
    .slice(0, 300);
}

/**
 * Sanitize free-form comment text before interpolating into markdown.
 *
 * The output is consumed by Claude as `additionalContext` — a user who
 * pastes a comment like "```\n## fake heading\n```" shouldn't be able to
 * spoof markdown structure that the agent interprets as instructions. We
 * neutralize fenced code blocks, leading-`#` headings, and stray
 * blockquote markers in addition to backticks.
 *
 * Note: this IS lossy on purpose — a comment legitimately discussing
 * markdown (e.g., "use ```js fences here") comes out with U+02BC
 * (Modifier Letter Apostrophe) where the backticks were. For an LLM
 * target the loss in fidelity is worth the prompt-injection defense.
 */
function safeComment(s: string): string {
  return s
    .replace(/```/g, "ʼʼʼ")        // U+02BC modifier letter apostrophe
    .replace(/^(#+\s)/gm, "\\$1")  // escape ATX headings at line start
    .replace(/^(>\s)/gm, "\\$1");  // escape blockquote markers at line start
}

/**
 * Strip stray ``` from the captured outerHTML so it can't terminate the
 * fence we wrap it in. Real DOM serialization won't produce literal triple
 * backticks, but if a page happens to contain one in a <pre> or attribute
 * value, the rest of the snippet would otherwise escape into raw markdown.
 */
function safeHtmlSnippet(s: string): string {
  return s.replace(/```/g, "ʼʼʼ");
}

export function toMarkdown(s: Session): string {
  const title = safeTitle(s.title);
  if (!s.annotations.length) return `# ${title}\n\n_No feedback._\n`;
  const lines: string[] = [`# Review of ${title}`, ""];
  s.annotations.forEach((a, i) => {
    if (!a.target) {
      lines.push(`## ${i + 1}. General note`);
    } else if (a.target.kind === "element") {
      lines.push(`## ${i + 1}. \`${safeBackticks(a.target.selector)}\``);
      // textContent / quotedText come from the bridge (whitespace-collapsed,
      // length-capped) but still pass through safeBackticks so a backtick
      // inside the captured snippet can't break the surrounding code span
      // in the agent's additionalContext.
      if (a.target.textContent) lines.push(`> ${safeBackticks(a.target.textContent)}`);
      // Emit the actual HTML so the agent can pattern-match against the
      // file's markup rather than guessing from selector + plain text.
      // Container-level pins were silently ignored before this — too
      // ambiguous to act on with just text + selector.
      if (a.target.outerHTMLSnippet) {
        lines.push("");
        lines.push("```html");
        lines.push(safeHtmlSnippet(a.target.outerHTMLSnippet));
        lines.push("```");
      }
    } else {
      // text-range annotation — quoted text is the substring the user selected
      lines.push(`## ${i + 1}. \`${safeBackticks(a.target.selector)}\` (text)`);
      lines.push(`> ${safeBackticks(a.target.quotedText)}`);
    }
    lines.push("");
    const comment = a.comment.trim();
    lines.push(comment ? safeComment(comment) : "_(no comment)_");
    lines.push("");
  });
  return lines.join("\n");
}

export function toJSON(s: Session): string {
  const feedback = s.annotations.map((a, i) => {
    const base = { number: i + 1, comment: a.comment.trim() };
    if (!a.target) {
      return { ...base, kind: "general" as const };
    }
    if (a.target.kind === "element") {
      return {
        ...base,
        kind: "element" as const,
        selector: a.target.selector,
        tag: a.target.tag,
        text: a.target.textContent ?? "",
        snippet: a.target.outerHTMLSnippet ?? "",
      };
    }
    return {
      ...base,
      kind: "text" as const,
      selector: a.target.selector,
      quotedText: a.target.quotedText,
      charOffset: a.target.charOffset,
    };
  });
  return JSON.stringify({ title: safeTitle(s.title), feedback }, null, 2);
}
