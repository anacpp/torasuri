# Torasuri

Discord bot + Express HTTP API written in TypeScript.

## Features
- Express REST API (health + extendable routes)
- Discord bot (slash command example: /ping)
- Centralized logger (pino + pretty in dev)
- Environment validation (Zod)
- Clean modular structure (commands, events, services, utils)
- Path aliases via TypeScript + runtime (tsc-alias / module-alias)
- Linting (ESLint) + Formatting (Prettier) + Husky pre-commit

## Tech Stack
TypeScript, Node.js, Express, discord.js, Pino, Zod, ESLint, Prettier

## Project Structure
```
src/
  server.ts                # Bootstrap (Express + Discord)
  core/
    logger.ts              # Logger
  bot/
    client.ts              # Discord client creation & login
    commands/
      ping.ts              # Example slash command
    events/
      interactionCreate.ts # Interaction handler
      ready.ts             # Ready event
  http/
    routes/
      index.ts             # Route registration
  utils/
    env.ts                 # Environment validation
  (config|services|schemas|types|middlewares) # Extend as needed
```

## Requirements
- Node.js >= 18.17
- A Discord bot token (create at: https://discord.com/developers/applications)

## Environment Variables
Copy `.env.example` to `.env` and fill values:
```
DISCORD_TOKEN=your-token
PORT=3000
LOG_LEVEL=info
```

## Installation
```bash
npm install
```

## Development
```bash
npm run dev
```
Starts:
- Express server (default: http://localhost:3000)
- Discord login (requires DISCORD_TOKEN)

## Path Aliases
Examples:
```ts
import { logger } from '@logger';
import { registerRoutes } from '@router';
import { createDiscordClient } from '@discord/client';
```
Configured in `tsconfig.json` and `_moduleAliases` (package.json). Build uses `tsc` + `tsc-alias`.

## Build & Run (Production)
```bash
npm run build
npm start
```
Outputs JS to `dist/`.

## Slash Commands
Currently only a local example (`ping`). To deploy commands, add a registrar script (e.g. using REST API) — not included yet.

## Lint & Format
```bash
npm run lint
npm run lint:fix
npm run format
```
Husky runs lint-staged on commit.

## Suggested Extensions / Next Steps
- Add command deployment script
- Add error handling middleware
- Add testing (Jest / Vitest)
- Add Dockerfile / CI workflow

## Deployment Notes
Minimal PM2 example:
```bash
npm run build
NODE_ENV=production pm2 start dist/server.js --name torasuri
```

## Contributing
1. Fork & branch
2. Commit with conventional messages (suggested)
3. Open PR

## License
MIT (set author in package.json if desired).

## TODO
- Command loader & auto-registration
- Configuration module
- Metrics & monitoring

---
Feel free to extend structure (`services`, `middlewares`, `schemas`, etc.) as the bot/API grows.
