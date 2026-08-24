import { describe, expect, it } from 'vitest';
import {
  baseName,
  dirName,
  hasExtension,
  joinPath,
  keepExtension,
  noteFileName,
} from '@/lib/notes/paths';

describe('baseName / dirName', () => {
  it('разделяет путь на папку и имя', () => {
    expect(dirName('сцены/серия-1/первая.md')).toBe('сцены/серия-1');
    expect(baseName('сцены/серия-1/первая.md')).toBe('первая.md');
  });

  it('для корня папка пустая', () => {
    expect(dirName('корневая.md')).toBe('');
    expect(baseName('корневая.md')).toBe('корневая.md');
  });
});

describe('joinPath', () => {
  it('в корне не ставит ведущий слэш', () => {
    expect(joinPath('', 'заметка.md')).toBe('заметка.md');
    expect(joinPath('сцены', 'заметка.md')).toBe('сцены/заметка.md');
  });
});

describe('hasExtension', () => {
  it('различает расширение и точку в середине имени', () => {
    expect(hasExtension('заметка.md')).toBe(true);
    expect(hasExtension('сц. 1-30')).toBe(false);
    expect(hasExtension('Сцена 2')).toBe(false);
    // Точка в конце расширением не считается.
    expect(hasExtension('странное.')).toBe(false);
  });
});

describe('noteFileName', () => {
  it('дописывает .md, если расширения нет', () => {
    expect(noteFileName('Сцена 2')).toBe('Сцена 2.md');
    // Точка в середине — не расширение: «сц. 1-30» должно стать «сц. 1-30.md»,
    // а не остаться файлом без расширения.
    expect(noteFileName('сц. 1-30')).toBe('сц. 1-30.md');
  });

  it('не трогает имя с расширением', () => {
    expect(noteFileName('схема.canvas')).toBe('схема.canvas');
    expect(noteFileName('заметка.md')).toBe('заметка.md');
  });
});

describe('keepExtension', () => {
  it('возвращает расширение исходного имени', () => {
    expect(keepExtension('первая.md', 'вторая')).toBe('вторая.md');
    expect(keepExtension('карта.png', 'схема')).toBe('схема.png');
  });

  it('уважает явно указанное расширение', () => {
    expect(keepExtension('первая.md', 'вторая.txt')).toBe('вторая.txt');
  });

  it('у файла без расширения ничего не выдумывает', () => {
    expect(keepExtension('LICENSE', 'ЛИЦЕНЗИЯ')).toBe('ЛИЦЕНЗИЯ');
    // Ведущая точка — скрытый файл, а не расширение.
    expect(keepExtension('.gitignore', 'правила')).toBe('правила');
  });
});
