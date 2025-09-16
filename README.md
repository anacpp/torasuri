# Torasuri

Discord bot + Express HTTP API written in TypeScript.

## Features
- Express REST API (health + extendable routes)
- Discord bot (slash command examples: /ping, /treasury)
- Interactive treasury setup wizard
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
    client.ts              # Discord client creation & login + command registration
    commands/
      ping.ts              # Example ping command
      treasury.ts          # Treasury wizard command
    events/
      interactionCreate.ts # Interaction handler (commands, buttons, modals)
      ready.ts             # Ready event
      messageCreate.ts     # Gemini mention parsing example
  http/
    routes/
      index.ts             # Route registration
  services/
    gemini.ts              # Gemini API wrapper
    treasury.ts            # Treasury config store
  schemas/
    treasury.ts            # Zod schema for treasury configs
  utils/
    env.ts                 # Environment validation
```

## Requirements
- Node.js >= 18.17
- A Discord bot token (https://discord.com/developers/applications)

## Environment Variables
Copy `.env.example` to `.env` and fill values:
```
DISCORD_TOKEN=your-token
DISCORD_CLIENT_ID=your-app-client-id
# Optional guild for faster dev registration
DISCORD_GUILD_ID=your-guild-id
PORT=3000
LOG_LEVEL=info
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-1.5-flash
```
If `DISCORD_GUILD_ID` is present, commands register instantly for that guild; otherwise global registration (may take up to 1 hour to propagate).

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
- Discord login (requires DISCORD_TOKEN & DISCORD_CLIENT_ID)

## Treasury Setup Wizard
Command: `/treasury setup start`

Guided steps (ephemeral):
1. Stellar public key (modal)
2. Micro-spend threshold (modal, optional, parses formats like 100, 100.50, R$100, 150 reais)
3. Additional signers (mention users or skip)
4. Summary + Confirm / Cancel

Other subcommands:
- `/treasury view` shows current config
- `/treasury reset` (admin only - placeholder in current version)

Validation:
- Stellar key must match `^G[A-Z0-9]{55}$`
- Threshold converted to integer cents
- Additional signers exclude admin & deduplicated
- Quorum auto-computed as 2/3 rounded up (requiredApprovals/totalSigners)

On confirmation, final JSON returned:
```json
{
  "type": "treasurySetup",
  "guildId": "...",
  "stellarPublicKey": "...",
  "adminUserId": "...",
  "microSpendThresholdInCents": 12345,
  "multisig": { "requiredApprovals":2, "totalSigners":3, "quorumRatio":"2/3" },
  "additionalSignerIds": ["..."]
}
```

State & Timeouts:
- One active wizard per guild (5 min timeout)
- Cancel anytime with Cancel button
- Bot restart clears in-progress wizard

## Path Aliases
Examples:
```ts
import { logger } from '@logger';
import { createDiscordClient } from '@discord/client';
```

## Build & Run (Production)
```bash
npm run build
npm start
```
Outputs JS to `dist/`.

## Slash Commands
Auto-registered on ready event. Use a guild ID for fast iteration.

## Lint & Format
```bash
npm run lint
npm run lint:fix
npm run format
```

## Deployment Notes
```bash
npm run build
NODE_ENV=production pm2 start dist/server.js --name torasuri
```

## TODO
- Implement /treasury reset logic with admin enforcement
- Persistence layer (DB) for treasury configs
- Tests for amount parsing & schema
- Enhanced permission checks

## License
MIT
