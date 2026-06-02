import { slugifyHeading } from './slug';

const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;
const FENCE_RE = /^(```|~~~)/;

/**
 * Extracts a single heading's section from a markdown document — the heading
 * line itself plus everything beneath it, stopping at the next heading of the
 * same or higher level. Used to inline `![[Note#Heading]]` embeds the way
 * Obsidian does. Headings inside fenced code blocks are ignored. Returns null
 * when no heading matches the requested slug.
 */
export function extractHeadingSection(content: string, headingSlug: string): string | null {
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let start = -1;
  let level = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE_RE.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const m = HEADING_RE.exec(line);
    if (!m) continue;

    if (start === -1) {
      if (slugifyHeading(m[2]!) === headingSlug) {
        start = i;
        level = m[1]!.length;
      }
      continue;
    }

    // We're past the matched heading — stop at the next same/higher heading.
    if (m[1]!.length <= level) {
      return lines.slice(start, i).join('\n').trim();
    }
  }

  if (start === -1) return null;
  return lines.slice(start).join('\n').trim();
}
