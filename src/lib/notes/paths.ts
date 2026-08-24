/**
 * Разбор путей вальта на стороне браузера — для контекстного меню дерева.
 *
 * Отдельный модуль, а не приватные функции компонента: логика мелкая, но
 * молчаливая. Съеденный экран в `/\.[^./]+$/` не роняет ни типы, ни линтер —
 * просто заметки перестают получать расширение. Ловится только тестом.
 */

/** Имя файла без папки. Для файла в корне — сам путь. */
export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/** Папка, в которой лежит путь. Для корня — пустая строка. */
export function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

/**
 * Есть ли у имени расширение (`.md`, `.png`), а не просто точка в середине.
 *
 * «Всё после последней точки» здесь не годится: в вальтах сплошь имена вроде
 * `сц. 1-30`, и такая проверка сочла бы расширением `. 1-30` — заметка ушла бы
 * на сервер без `.md` и перестала быть заметкой. Поэтому расширение — только
 * короткий буквенно-цифровой хвост.
 */
export function hasExtension(name: string): boolean {
  return /\.[A-Za-z0-9]{1,8}$/.test(name);
}

/**
 * Расширение переносится со старого имени, если в новом его не указали.
 *
 * В дереве заметка показана как «Сцена 1», без `.md` — переименовав её в
 * «Сцена 2», пользователь не имеет в виду файл без расширения.
 */
export function keepExtension(oldName: string, newName: string): string {
  if (hasExtension(newName)) return newName;
  const dot = oldName.lastIndexOf('.');
  return dot > 0 ? newName + oldName.slice(dot) : newName;
}

/** Имя новой заметки: без расширения — значит `.md`. */
export function noteFileName(rawName: string): string {
  return hasExtension(rawName) ? rawName : `${rawName}.md`;
}
