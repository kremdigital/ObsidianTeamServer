import { load } from 'js-yaml';

export interface NoteProperty {
  key: string;
  /** Scalar values become strings; lists become string arrays (tags etc.). */
  value: string | string[];
}

export interface ParsedFrontmatter {
  properties: NoteProperty[];
  /** Markdown body with the frontmatter block removed. */
  body: string;
}

const FRONTMATTER_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Splits an Obsidian-style YAML frontmatter block off the top of a note and
 * flattens it into a display-friendly property list (mirroring Obsidian's
 * Properties panel). Invalid or non-object YAML is ignored — the body is
 * returned untouched so rendering never breaks on malformed metadata.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return { properties: [], body: content };

  const body = content.slice(match[0].length);
  let data: unknown;
  try {
    data = load(match[1]!);
  } catch {
    return { properties: [], body };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { properties: [], body };
  }

  const properties: NoteProperty[] = [];
  for (const [key, raw] of Object.entries(data as Record<string, unknown>)) {
    properties.push({ key, value: flatten(raw) });
  }
  return { properties, body };
}

function flatten(value: unknown): string | string[] {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map((v) => scalar(v)).filter((s) => s.length > 0);
  }
  return scalar(value);
}

function scalar(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
