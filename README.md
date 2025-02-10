# Volt

Volt is an open source Discord bot and Web Dashboard designed by RoboDAO for RoboDAO to provide a fun and interactive Discord point system paired with a basic UI.

## Features
- **Points System**: Manage points with commands like deposit, withdraw, and transfer.
- **Admin Tools**: Grant points or items, create or remove items, and manage users and jobs.
- **Shop System**: Buy, sell, and redeem items.
- **Jobs**: Assign jobs to users for rewards.
- **Web UI**: Dynamic dashboard page.

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
   Add custom variables to `.env` file:


3. Install the required dependencies:
   ```bash
   npm install && npm init -y && npm install dotenv
   ``` 
   
4. Start the bot:
   ```bash
   node bot.js
   ```

## Commands Overview

### Point system
- **`balance`**: Check point balances.
- **`deposit <amount>`**: Move points from wallet to bank.
- **`withdraw <amount>`**: Move points from bank to wallet.
- **`rob @user`**: Attempt to rob another user.
- **`give @user <amount>`**: Transfer points to another user.
- **`leaderboard`**: Shows top 10 total balances.

### Shop & Inventory
- **`shop`**: View items available for sale.
- **`buy <item>`**: Purchase an item.
- **`inventory`**: Check your or another user’s inventory.
- **`remove-item <name>`**: Remove an item (Admin).

### Jobs and Giveaway
- **`joblist`**: View all jobs.
- **`work`**: Assign yourself a random job.
- **`giveaway`**: View the list of giveaways and see which ones youre entered in.

### Admin Commands
- **`give-item @user <item>`**: Send an item to another user.
- **`redeem <item>`**: Redeem an item from your inventory.
- **`add-job <desc>`**: Create a job.
- **`add-item <price> <name> - <desc>`**: Add an item.
- **`complete-job @user <jobID> <point amount>`**: Mark a job as complete.

## License
This project is open-source and available under the MIT License.

## Contribution
Feel free to contribute to Volt! Submit pull requests or create issues for any bugs or feature suggestions.

---
Happy botting!

