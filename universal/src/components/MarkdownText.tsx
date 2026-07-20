import { Fragment } from "react";
import { View } from "react-native";
import { Text } from "soma-style";

/* A lightweight Markdown renderer for the chat — no dependency, handles the
   subset Claude actually emits: fenced code blocks, headings, bullet/numbered
   lists, blockquotes, and inline **bold** / `code`. Anything else falls through
   as plain body text. Not a full CommonMark parser; readability over fidelity. */

/** Inline parse: **bold** and `code` within one line → Text segments. */
function inline(text: string, keyBase: string) {
  const parts: React.ReactNode[] = [];
  // Split on **bold** and `code`, keeping the delimiters via capture groups.
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(
        <Text key={`${keyBase}-b${i}`} className="font-semibold text-text">
          {tok.slice(2, -2)}
        </Text>,
      );
    } else {
      parts.push(
        <Text key={`${keyBase}-c${i}`} className="rounded bg-surface-elevated px-1 font-mono text-teal">
          {tok.slice(1, -1)}
        </Text>,
      );
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) parts.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last)}</Fragment>);
  return parts;
}

export function MarkdownText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      blocks.push(
        <View key={key++} className="rounded-lg bg-surface-elevated px-3 py-2">
          <Text variant="micro" className="font-mono text-text-secondary">
            {buf.join("\n")}
          </Text>
        </View>,
      );
      continue;
    }

    // Blank line → spacer (skip; the gap comes from the container)
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      blocks.push(
        <Text key={key++} variant={h[1].length === 1 ? "title" : "eyebrow"} className="text-text">
          {inline(h[2], `h${key}`)}
        </Text>,
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      blocks.push(
        <View key={key++} className="border-l-2 border-border pl-3">
          <Text variant="body" className="italic text-text-secondary">
            {inline(line.slice(2), `q${key}`)}
          </Text>
        </View>,
      );
      i++;
      continue;
    }

    // Bullet / numbered list item
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (bullet || numbered) {
      const marker = bullet ? "•" : `${numbered![1]}.`;
      const content = bullet ? bullet[1] : numbered![2];
      blocks.push(
        <View key={key++} className="flex-row gap-2 pl-1">
          <Text variant="body" className="text-text-muted">
            {marker}
          </Text>
          <Text variant="body" className="flex-1 text-text">
            {inline(content, `l${key}`)}
          </Text>
        </View>,
      );
      i++;
      continue;
    }

    // Paragraph
    blocks.push(
      <Text key={key++} variant="body" className="text-text">
        {inline(line, `p${key}`)}
      </Text>,
    );
    i++;
  }

  return <View className="gap-1.5">{blocks}</View>;
}
