# 🚀 CommunityCoin: Decentralized Treasury for Online Communities

**Tagline:** "Doar fácil, ver fácil, confiar fácil."

## ✨ Introduction

CommunityCoin (also known as StellarTreasury) is an innovative bot-driven solution for Discord and Telegram communities, revolutionizing how online groups manage their finances. We address critical pain points faced by communities today:

*   **Complexity of traditional crypto donations:** Difficult for non-technical users.
*   **Lack of real-time spending transparency:** Opaque financial flows erode trust.
*   **Bureaucracy of multi-signature for micro-expenses:** Hinders agility for daily operational needs.

Leveraging the **Stellar blockchain**, CommunityCoin provides a secure, transparent, and user-friendly platform. It empowers community members to **donate effortlessly** via simple chat commands and QR codes, while enabling treasurers to execute **micro-spending instantly** for everyday needs (e.g., server costs, community events) without cumbersome, multi-level approvals. All financial activities are publicly recorded on the Stellar network, reflected on a transparent dashboard, and notified in real-time, fostering unparalleled trust and engagement.

Our solution turns complex financial management into a seamless, integrated chat experience, living up to its promise of "Doar fácil, ver fácil, confiar fácil."

## 🌟 Key Features (MVP)

For this hackathon, we focused on delivering the core value proposition:

1.  **Effortless Donations via Chat:**
    *   **`/doar <amount> <asset>` command:** Users can initiate donations directly from their Discord/Telegram chat.
    *   **Dynamic QR Code / Stellar Payment Link:** The bot responds with an easy-to-scan QR code and a clickable payment link, allowing any Stellar wallet user to donate in seconds.
    *   **Real-time Public Notifications:** Upon successful donation, the bot announces the contribution in the community channel, fostering transparency and appreciation.

2.  **Instant Micro-Spending for Treasurers:**
    *   **`/gastar <amount> <asset> <recipient_address> <description>` command:** Designated treasurers can execute small expenses directly from the chat.
    *   **Bypass Bureaucracy:** For amounts below a pre-defined threshold, these transactions are processed instantly, demonstrating how common multi-signature overhead for small costs can be avoided.
    *   **Public Spending Notifications:** The bot announces the expenditure in the community channel, including a link to the Stellar transaction on StellarExpert for full auditability.

3.  **Transparent Community Dashboard:**
    *   A simple web-based dashboard provides a clear overview of the treasury's current balance and a list of recent transactions (donations and expenditures).
    *   Each transaction is linked to StellarExpert, ensuring full on-chain verifiability.

## 💡 How It Works (High-Level Workflow)

User commands the bot ➡️ Bot interacts with Backend API ➡️ Backend API leverages Stellar SDK to manage transactions on Stellar Network ➡️ Real-time updates pushed back to chat and displayed on web dashboard.

## 🛠 Technologies Used

*   **Blockchain Protocol:** [Stellar Network](https://www.stellar.org/) (chosen for its low transaction fees, high speed, native multi-signature capabilities, and robust stablecoin ecosystem)
*   **Stellar SDK:** `js-stellar-sdk` (for all Stellar-related interactions: account management, transaction building, signing, and submission)
*   **Bot Frameworks:**
    *   `discord.js` (for Discord integration)
    *   `telegraf.js` (for Telegram integration)
*   **Backend:** Node.js with Express.js (handling bot commands, orchestrating Stellar API calls, and managing treasurer permissions)
*   **Frontend (Dashboard):** React.js (for the simple, real-time web dashboard)
*   **Database:** MongoDB / Firestore (for storing bot-related metadata like community configurations, treasurer roles, and transaction descriptions)
*   **Stellar Integrations:** StellarExpert API (for fetching real-time account data and providing links for transaction auditability)

## 👥 Team

We are a passionate duo committed to empowering online communities with transparent and efficient financial tools:

*   **Ana Carla César**
*   **Marcos Guimarães Trindade**

## 🚀 Future Enhancements (Beyond Hackathon)

Our vision extends far beyond this MVP. Future developments will include:

*   **Advanced On-Chain Governance (via Soroban):** Implementing quadratic voting, delegated voting, and automated proposal execution.
*   **Seamless Fiat On/Off-Ramps:** Direct integration with local payment providers to easily convert fiat to stablecoins and vice-versa.
*   **NFT-based Reputation & Access:** Using non-fungible tokens on Stellar for community badges, weighted voting, and token-gated access.
*   **Comprehensive Budgeting Tools:** Allowing treasurers to set up "budget boxes" for specific initiatives and track progress towards funding goals.
*   **Enhanced UI/UX:** More interactive elements within Discord/Telegram, richer data visualization on the dashboard.

## ⚙️ Setup & Run (Local)

To run CommunityCoin locally, please follow these steps:

1.  **Clone the repository:**
    ```bash
    git clone [YOUR_REPO_URL_HERE]
    cd communitycoin
    ```
2.  **Install dependencies:**
    ```bash
    npm install # or yarn install
    ```
3.  **Configure environment variables:**
    *   Create a `.env` file in the root directory.
    *   Add your Discord Bot Token, Telegram Bot Token, Stellar Secret Key for the treasury account (for MVP), and any API keys (e.g., for StellarExpert).
    ```
    DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN
    TELEGRAM_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
    STELLAR_TREASURY_SECRET=YOUR_STELLAR_TREASURY_SECRET_KEY # WARNING: For MVP/Testnet only. Never use mainnet secret keys directly in code.
    STELLAR_NETWORK=testnet # or public
    STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
    # ... other variables like MongoDB URI, etc.
    ```
4.  **Run the bot:**
    ```bash
    npm start # or node src/index.js
    ```
5.  **Run the dashboard (if separate):**
    ```bash
    cd frontend # or wherever your dashboard code is
    npm install
    npm start
    ```
    *Ensure the dashboard is configured to connect to your local backend API or directly to the Stellar Horizon endpoint.*

## �� License

This project is licensed under the [MIT License](LICENSE).
