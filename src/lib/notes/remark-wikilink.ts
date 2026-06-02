import { visit } from 'unist-util-visit';
import type { Root, Text, Link, Image, PhrasingContent } from 'mdast';
import { parseWikiTarget, isImageTarget } from './resolve';

/**
 * Remark plugin that rewrites Obsidian wikilinks inside text nodes:
 *
 *   [[Note]]            → link  url="wikilink:Note"
 *   [[Note#H|Alias]]    → link  url="wikilink:Note#H"  text="Alias"
 *   ![[image.png]]      → image url="wikiembed:image.png"
 *   ![[Note]]           → link  url="wikiembed:Note"   (note transclusion shown as a link)
 *
 * The custom `wikilink:` / `wikiembed:` protocols are resolved to real
 * files later, in the React renderer, where the project's file index is
 * available. Text inside code spans / fenced blocks is untouched because
 * those are `inlineCode` / `code` nodes, not `text` nodes.
 */
export function remarkWikilink() {
  return (tree: Root): void => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return;
      if (!node.value.includes('[[')) return;

      const replacements = splitWikilinks(node.value);
      if (!replacements) return;

      parent.children.splice(index, 1, ...replacements);
      // Resume traversal past the nodes we just inserted.
      return index + replacements.length;
    });
  };
}

const WIKILINK_RE = /(!?)\[\[([^\]\n]+)\]\]/g;

function splitWikilinks(value: string): PhrasingContent[] | null {
  const out: PhrasingContent[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;

  while ((match = WIKILINK_RE.exec(value)) !== null) {
    const [whole, bang, inner] = match;
    if (match.index > last) {
      out.push({ type: 'text', value: value.slice(last, match.index) });
    }

    const isEmbed = bang === '!';
    const { target, heading, alias } = parseWikiTarget(inner!);

    if (isEmbed && isImageTarget(target)) {
      const image: Image = {
        type: 'image',
        url: `wikiembed:${encodeURIComponent(inner!)}`,
        alt: alias ?? target,
        title: null,
      };
      out.push(image);
    } else {
      const display =
        alias ?? (target ? (heading ? `${target} › ${heading}` : target) : (heading ?? inner!));
      const link: Link = {
        type: 'link',
        url: `${isEmbed ? 'wikiembed' : 'wikilink'}:${encodeURIComponent(inner!)}`,
        title: null,
        children: [{ type: 'text', value: display }],
      };
      out.push(link);
    }

    last = match.index + whole!.length;
  }

  if (out.length === 0) return null;
  if (last < value.length) {
    out.push({ type: 'text', value: value.slice(last) });
  }
  return out;
}
