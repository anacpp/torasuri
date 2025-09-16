# torasuri

A Discord DAO bot for managing a transparent Stellar-based treasury.

Add the bot to your server:
https://discord.com/oauth2/authorize?client_id=1417270840738709584&permissions=8&integration_type=0&scope=bot+applications.commands

## Commands
(All commands use the Discord slash command interface.)

### /treasury setup start
Initialize the treasury for the current guild.
Flow:
1. Provide the treasury Stellar public key (G...)
2. (Optional) Set a micro-spend threshold (small spends can be auto-approved in future logic)
3. (Optional) Mention additional signer users
4. Confirm configuration

### /treasury donate [amount]
Generate a Freighter donation link.
Response shows:
- Treasury public key
- Required memo (do not change)
- Optional suggested amount
Steps for user:
1. Open provided link
2. Connect Freighter
3. Enter / confirm amount
4. Sign and submit
5. Bot detects on-chain payment shortly

### /spend purpose
Opens a modal to propose a spend with:
- Title
- Description / reason
- Recipient Discord user (@mention)
- Amount in XLM
If the recipient has a verified signer key, a spend entry is created awaiting approvals / submission logic.

### /treasury balance
Displays the current XLM balance of the configured treasury account.

## Notes
- A memo is attached to donations for attribution and matching intents.
- All payments are native XLM transfers to the configured treasury address.
- Only administrators (initial configuring user) and verified signers will be able to interact with advanced spend features.

## Project
The bot uses:
- Discord.js for interaction
- Stellar SDK for building and parsing transactions
- Express API for Freighter signing flows

MIT License.
