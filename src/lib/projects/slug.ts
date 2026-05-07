import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db/client';

const CYRILLIC_MAP: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

export function slugify(input: string): string {
  const lower = input.toLowerCase();
  let out = '';
  for (const char of lower) {
    if (char in CYRILLIC_MAP) {
      out += CYRILLIC_MAP[char];
    } else if (/[a-z0-9]/.test(char)) {
      out += char;
    } else if (/[\s\-_]/.test(char)) {
      out += '-';
    }
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'project';
  if (!(await exists(base))) return base;

  // Append random hex suffix until we find a free slug.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}-${randomBytes(2).toString('hex')}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base}-${randomBytes(4).toString('hex')}`;
}

async function exists(slug: string): Promise<boolean> {
  const found = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
  return found !== null;
}
