# Контрибьютинг

Спасибо за желание помочь! Несколько правил, которые делают совместную
работу гладкой.

## Локальная разработка

```bash
git clone <repo-url> server
cd server
pnpm install

# Создайте две локальные БД (один раз)
createdb obsidian_sync_dev
createdb obsidian_sync_test

cp .env.example .env
pnpm db:migrate
pnpm db:seed

pnpm dev
```

Подробнее — в [`README.md`](./README.md#разработка).

## Перед PR

Запустите все проверки локально:

```bash
pnpm format        # автоформат Prettier
pnpm lint          # ESLint, должно быть 0 ошибок и 0 warning'ов
pnpm typecheck     # tsc --noEmit
pnpm test:all      # vitest unit + integration
pnpm test:e2e      # Playwright (~30s, поднимает dev сервер)
```

Все должно пройти. Это же запустит CI.

## Стиль кода

- **TypeScript:** строгие настройки уже включены в `tsconfig.json` —
  `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- **Prettier** управляет всем форматированием — не спорьте с ним руками.
  Конфиг — `.prettierrc`.
- **ESLint** — `eslint-config-next` + наше правило о подчёркивании для
  intentionally-unused аргументов.
- **Импорты:** алиас `@/*` для путей в `src/`. Группируем как: внешние
  пакеты → `@/lib`, `@/components` → относительные. Prettier сортирует
  Tailwind classes автоматически.
- **Имена:** `camelCase` для функций и переменных, `PascalCase` для
  компонентов и типов, `SCREAMING_SNAKE_CASE` для верхних констант.

## Conventional Commits

Каждый коммит должен соответствовать
[Conventional Commits](https://www.conventionalcommits.org/) — это
проверяется hook'ом `commitlint`.

Поддерживаемые типы (стандартные `@commitlint/config-conventional`):

| type       | для чего                                |
| ---------- | --------------------------------------- |
| `feat`     | новая функциональность                  |
| `fix`      | исправление бага                        |
| `refactor` | переработка без поведенческих изменений |
| `perf`     | оптимизация                             |
| `test`     | только тесты                            |
| `docs`     | только документация                     |
| `chore`    | обслуживание (зависимости, конфиги)     |
| `style`    | форматирование, без изменения смысла    |
| `ci`       | CI/CD                                   |
| `build`    | система сборки                          |

Примеры:

```
feat(auth): add password reset flow
fix(socket): drop stale yjs updates on reconnect
docs(api): add accept-invite endpoint
chore: bump prisma to 7.9
```

## Тесты

Новый код **должен** иметь тесты, **если**:

- это бизнес-логика в `src/lib/` (минимум — unit);
- это новый API-эндпоинт (минимум — integration через Vitest, либо e2e через Playwright);
- это исправление бага (regression test, чтобы он больше не вернулся).

UI-компоненты тестировать не обязательно поштучно — достаточно покрыть
сценарий e2e Playwright'ом.

## Миграции БД

Изменили `prisma/schema.prisma`? Создайте миграцию:

```bash
pnpm db:migrate -- --name describe_change
```

Миграцию **закоммитьте**. На production она применяется через
`pnpm db:migrate:deploy` в `scripts/upgrade.sh`.

## Pre-commit hook

Husky запускает lint-staged перед коммитом:

- `*.ts/tsx` → eslint --fix + prettier --write
- `*.json/md/yml/css` → prettier --write

Если хук падает — исправьте проблемы, **не** коммитьте через `--no-verify`.

## Pull request

- Один логический change на PR. Несколько мелких — лучше нескольких
  мелких PR'ов, чем одного большого.
- В описании опишите **why**, а не только **what**.
- Если PR меняет схему БД, API или Socket.IO события — обновите
  соответствующий раздел в `docs/`.
- Если PR добавляет фичу заметную пользователю — добавьте запись в
  `CHANGELOG.md` под `## [Unreleased]`.

## Безопасность

Если вы нашли уязвимость, **не** открывайте публичный issue. Свяжитесь с
maintainer'ами в приватном порядке (security advisory на GitHub или email).

## Лицензия

Все ваши вклады публикуются под лицензией [MIT](./LICENSE).
