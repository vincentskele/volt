# PizzaBot

PizzaBot is a Discord bot designed to provide a fun and interactive economy system for your server. Users can earn, spend, and manage virtual currency while enjoying features like jobs, pets, and games.

## Features
- **Basic Economy**: Manage wallets and banks with commands to deposit, withdraw, and transfer funds.
- **Admin Tools**: Grant money or items, create or remove items, and manage users and jobs.
- **Shop System**: Buy, sell, and redeem items.
- **Jobs**: Assign jobs to users for rewards.
- **Pets**: Create, view, and battle pets.
- **Games**: Play blackjack and other interactive games.

## Prerequisites
Ensure your environment meets the following requirements before setting up PizzaBot:

- **Node.js**: Version 16.x or higher.
  - [Download and install Node.js](https://nodejs.org/)
- **npm**: Comes with Node.js; ensures you can install dependencies.
- **SQLite**: Required for database functionality.
  - Install SQLite via your package manager (e.g., `apt`, `brew`, or `choco`).
  - [SQLite installation guide](https://www.sqlite.org/download.html)

## Installation
Follow these steps to set up PizzaBot on your server:

1. Clone the repository:
   ```bash
   git clone https://github.com/vincentskele/pizzabot && cd pizzabot
   ```

2. Copy the example environment file and configure it:
   ```bash
   cp .env.example .env
   nano .env
   ```
   Add your Discord bot token to the `.env` file:
   ```env
   DISCORD_TOKEN=your_discord_bot_token_here
   ```

3. Install the required dependencies:
   ```bash
   npm install
   ```

4. Start the bot:
   ```bash
   node bot.js
   ```

## Commands Overview

### Basic Economy
- **`$balance`**: Check wallet and bank balances.
- **`$deposit <amount>`**: Move money from wallet to bank.
- **`$withdraw <amount>`**: Move money from bank to wallet.
- **`$rob @user`**: Attempt to rob another user.

### Admin Commands
- **`$bake`**: Add 6969 currency to your wallet.
- **`$give-money @user <amount>`**: Transfer money to another user.
- **`$give-item @user <item>`**: Send an item to another user.
- **`$redeem <item>`**: Redeem an item from your inventory.

### Shop & Inventory
- **`$shop`**: View items available for sale.
- **`$buy <item>`**: Purchase an item.
- **`$inventory`**: Check your or another user’s inventory.
- **`$add-item <price> <name> - <desc>`**: Add an item (Admin).
- **`$remove-item <name>`**: Remove an item (Admin).

### Jobs
- **`$add-job <desc>`**: Create a job (Admin).
- **`$joblist`**: View all jobs.
- **`$work`**: Assign yourself a random job.
- **`$complete-job @user <jobID> <reward>`**: Mark a job as complete (Admin).

### Pet System
- **`$create-pet <name> <type>`**: Create a pet.
- **`$pets`**: View your or another user’s pets.
- **`$battle <your pet> @user <their pet> <bet>`**: Battle pets for rewards.

### Games
- **`$blackjack <bet>`**: Start a blackjack game.
- **`$hit`**: Draw another card in blackjack.
- **`$stand`**: Stay with your current hand.

## License
This project is open-source and available under the MIT License.

## Contribution
Feel free to contribute to PizzaBot! Submit pull requests or create issues for any bugs or feature suggestions.

---
Happy botting!

