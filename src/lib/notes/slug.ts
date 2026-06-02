/**
 * Heading → anchor-id slugifier. Kept deliberately close to Obsidian /
 * GitHub behaviour so that `[[Note#Some Heading]]` and in-document
 * `#some-heading` links line up with the ids rendered on the headings.
 */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=<>?,./:;"'{}[\]\\|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
