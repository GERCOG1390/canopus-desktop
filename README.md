# Canopus

Десктоп-компаньон для EVE Online (Windows). Electron + React + TypeScript.

## Возможности

- **Персонаж** (EVE SSO): обзор, кошелёк, местоположение и корабль, очередь обучения, все навыки, ассеты с оценкой по Jita.
- **Рынок**: цены в пяти хабах, стакан Jita 4-4, история за 90 дней, оценка лута из буфера обмена, свои ордера с проверкой, перебиты ли они.
- **Карта**: маршрут с активностью по системам (убийства и прыжки за час), установка маршрута в клиенте игры, проходы в Thera/Turnur (EVE-Scout) с подсчётом прыжков.
- **Индустрия**: калькулятор производства и реакций (ME/TE, бонусы структур, индекс стоимости системы, налоги), текущие работы, колонии PI с таймерами экстракторов.
- **PvP**: статистика пилота и последние бои с zKillboard.

## Запуск

```powershell
npm install
npm run dev        # режим разработки
npm run build      # сборка в out/
npm run dist       # установщик Windows в release/
```

## Настройка EVE SSO

1. Создайте приложение на https://developers.eveonline.com/applications
   (Authentication & API Access, отметьте нужные scopes).
2. Callback URL: `eveauthcanopus://callback`. Canopus регистрирует эту схему в Windows при запуске.
3. Вставьте Client ID в «Настройки». Secret Key не нужен: используется PKCE.

Токены хранятся в `%APPDATA%\canopus\tokens.bin`, зашифрованные через Windows DPAPI.

## Устройство

- `src/main`: процесс Electron, HTTP-прокси с кэшем по заголовку `Expires` и белым списком хостов, EVE SSO.
- `src/preload`: мост `window.api`.
- `src/renderer`: интерфейс на React, по файлу на раздел в `pages/`.

Источники данных: ESI, zKillboard, EVE-Scout, Fuzzwork (рынок и SDE).
