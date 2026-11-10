# dsh-polza — плагин DeepSeek Harness «Polza» (провайдер polza.ai)

Бандл `@polza-ai/dsh-plugin-polza` для DeepSeek Harness (`github.com/deepseek-ai/deepseek-harness`, cordis-плагины):
маршрут LLM `polza` на Chat Completions Пользы (`https://polza.ai/api/v1`) + команда `/polza`
(login через OAuth PKCE с коллбэком на 127.0.0.1, key, logout, balance, models, catalog).
Аналог `~/code/bb-polza` для bb, но без движка: цикл агента — harness, здесь только адаптер.

## Устройство
- `src/index.ts` — плагин `llm-polza`: Config (baseURL, apiKeyEnv=POLZA_API_KEY, models — белый список, volatile),
  регистрирует `PolzaAdapter extends PiAiAdapter` (из `@deepseek-ai/dsh-llm-pi-ai`) на маршрут `polza`.
  Стрим, картинки, replay, ошибки — работа PiAiAdapter; мы даём `ResolvedPiAiProviderProfile` (`src/route.ts`).
  Это внутренний тип pi-ai-адаптера → при апгрейде harness проверять `config.d.ts` пакета; `engines.dsh` узкий.
- `src/models.ts` — каталог → `Model<'openai-completions'>`: compat `thinkingFormat: openrouter`, `max_tokens`,
  без store/developer, `cacheControlFormat: anthropic` для `anthropic/*`; уровни reasoning из `reasoning.supported_efforts`.
- `src/catalog.ts` — публичный `/v1/models?type=chat`, кэш `$DSH_HOME/polza/catalog.json`, обновление раз в 6 ч.
- `src/contract.ts`, `src/oauth.ts`, `src/account.ts` — перенесены из bb-polza.
- Необязательные сервисы (`credentials`, `attachments`, `fs`, `commands`) — только через `ctx.inject([...])`:
  без объявления `ctx.get()` возвращает undefined (проверено).

## UI (браузерная половина, `src/client/`)
- Экспорт `./client` → `lib/client.js` в формате клиентских модулей harness: tsdown собирает CJS (`client.raw.cjs`),
  `scripts/wrap-client.mjs` заворачивает в `window.__ModuleLoader__.load({ id, factory })`. Наружу только
  платформенные `react`, `react/jsx-runtime`, `@deepseek-ai/dsh-client-ui-primitives`; CSS — свой `<style data-plugin…>`.
- Слоты: `settings.section` id `polza` (+ `settings.section.icon`), `sidebar.footer.action` (чип баланса → Modal;
  открыть настройки программно в 0.2.2 нельзя), `settings.models.footer`. Иконки провайдеров у моделей в пикере —
  CSS-маска по `[data-provider-id="polza"][data-model-id=…]` (реестра иконок нет); SVG берёт хост с
  `icons.polza.ai/{icon_provider_slug}.svg` (кэш `$DSH_HOME/polza/icons`), отдаёт `/api/polza/icons`.
- Клиент ↔ хост: точные Fetch-маршруты `ctx.connection.fetch.register` `/api/polza/{state,login,login-cancel,logout,key,catalog,models}`
  (`src/http-api.ts`); доверие и cookie проверяет harness. Клиент: `fetch(new URL('api/polza/…', document.baseURI))`.
- Белый список из UI — `$DSH_HOME/polza/models.json` (`src/whitelist.ts`); без файла — `config.models`.
- Айдентика: `icon.svg` (лаймовый знак на #0C0E12), `locale/{en,ru}.json` meta, `docs/DETAIL*.md` — страница Plugins.
- Проверка UI без приложения: изолированный `DSH_HOME`, `"$DSH" plugin --profile web add link:…`,
  `POLZA_API_KEY=… "$DSH" web --no-open --port 3417`, открыть напечатанный URL с `?token=`.

## Команды
- `npm install`, `npm run build` (tsdown → `lib/index.js`, harness-пакеты и pi-ai — peer, zod вбандлен),
  `npm run typecheck` (хост + клиент), `npm test` (vitest; `tests/adapter.test.ts` гоняет настоящий PiAiAdapter против фейкового SSE).
- CLI harness: `DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"`.
  Профилем `desktop` управляет только приложение (`--dump-config` для него запрещён).
- Установка в приложение (сделано 2026-11-10): `"$DSH" plugin --profile desktop add link:/Users/ilya/code/dsh-polza`,
  после пересборки — перезапуск приложения. Удалить: `"$DSH" plugin --profile desktop remove @polza-ai/dsh-plugin-polza`.
- Смоук без приложения: изолированный `DSH_HOME=<tmp>`, `"$DSH" plugin --profile headless add link:…`, патч
  `- id: agent-default-model\n  config: {provider: polza, model: anthropic/claude-haiku-5.5}`, затем
  `POLZA_API_KEY=… "$DSH" --profile headless --patch <патч> "задача"`.

## Публикация
- npm: `@polza-ai/dsh-plugin-polza` (организация polza-ai, `publishConfig.access: public`), GitHub `polza-ai/dsh-plugin-polza`.
- Релиз: поднять `version`, `npm run typecheck && npm test`, проверить tarball (`npm pack` → изолированный `DSH_HOME`,
  `"$DSH" plugin --profile web add <tgz>` → `"$DSH" web`), коммит, тег `vX.Y.Z` **до** `npm publish`, push main+тег,
  `gh release create`. Тег `v0.1.0` на GitHub указывает на коммит до переименования пакета (npm 0.1.0 собран из d01cbdd).
- Пользователи ставят: Плагины → Добавить плагин → `@polza-ai/dsh-plugin-polza` (собранный пакет, без allowBuilds).
- У Ильи в профиле desktop — link на эту папку (не npm-версия).

## Не сделано
- Расход в рублях по треду; регистрация `ctx.authorization` flow (в 0.2.2 нет общего UI для него).
