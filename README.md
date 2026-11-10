# dsh-plugin-polza

Модели [polza.ai](https://polza.ai) в [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
провайдер `polza` в пикере моделей и команда `/polza`.

## Установка

```sh
dsh plugin --profile desktop add dsh-plugin-polza
```
или на странице **Plugins** приложения. Затем перезапустите приложение и откройте
**Настройки → Польза** → **Войти через Пользу**.

## Что появляется
- **Настройки → Польза** — аккаунт, баланс, лимит и расход ключа, выбор моделей пикера с поиском по каталогу и ценами в ₽.
- **Футер сайдбара** — баланс Пользы, по клику — подробности и «Пополнить».
- **Пикер моделей** — группа Polza с иконками провайдеров моделей.
- **Настройки → Модели** — карточка Polza.

## Команда `/polza`
То же из чата:

| | |
|---|---|
| `/polza login` | OAuth-вход, ключ сохраняется в хранилище harness (`POLZA_API_KEY`) |
| `/polza key pza_…` / `/polza logout` | сохранить / удалить ключ |
| `/polza balance` | баланс организации и лимит ключа |
| `/polza models` | модели в пикере с ценами |
| `/polza catalog <поиск>` | поиск по каталогу Пользы |

## Список моделей без UI
Список из настроек хранится в `~/.dsh/polza/models.json`. Стартовый набор можно задать в `~/.dsh/profiles/<профиль>/cordis.patch.yml`:
```yaml
- id: llm-polza
  config:
    models: [anthropic/claude-sonnet-5.5, openai/gpt-5.4, deepseek/deepseek-v4-pro]
```
