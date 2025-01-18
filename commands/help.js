// commands/help.js
class HelpModule {
  static getHelpMessage() {
    return `
**Pizza Bot Commands (with Bank, Rob, Jobs, Pets & Games):**

**Basic Economy:**
  🍕 **$balance** [@user]: Shows wallet & bank for you or another user.
  🍕 **$deposit <amount>**: Move money from wallet to bank.
  🍕 **$withdraw <amount>**: Move money from bank to wallet.
  🍕 **$rob @user**: Attempt to rob another user's wallet.

**Admin Bake & Transfers:**
  🍕 **$bake** (Admin): Get 6969 in your wallet.
  🍕 **$give-money @user <amount>**: Give wallet money to another user.
  🍕 **$give-item @user <item name>**: Send 1 item to another user.
  🍕 **$redeem <item name>**: Use/redeem an item in your inventory.

**Shop & Inventory:**
  🛍️ **$shop**: View items for sale.
  🛍️ **$buy <item name>**: Purchase an item (from your wallet).
  🛍️ **$inventory** (or **$inv**) [@user]: Show someone's items.
  🛍️ **$add-item <price> <name> - <desc>** (Admin)
  🛍️ **$remove-item <name>** (Admin)

**Leaderboard & Admin System:**
  🍕 **$leaderboard**: Shows top 10 total (wallet+bank).
  🍕 **$add-admin @user**, **$remove-admin @user**, **$list-admins**

**Jobs (multi-assignee, per-user completion):**
  🛠️ **$add-job <desc>** (Admin): Create a new job.
  🛠️ **$joblist**: View all jobs & current assignees.
  🛠️ **$work**: Assign yourself to a random job (multi-person).
  🛠️ **$complete-job <@user> <jobID> <reward>** (Admin): Pays user for job completion

**Pet System:**
  🐾 **$create-pet <name> <type>**: Create a pet (types: dragon, phoenix, griffin, unicorn)
  🐾 **$pets** [@user]: View your or another user's pets
  🐾 **$battle <your pet> @user <their pet> <bet>**: Battle pets for pizza rewards!

**Games:**
  🎲 **$blackjack <bet>**: Start a blackjack game
  🎲 **$hit**: Draw another card in blackjack
  🎲 **$stand**: Stay with your current hand in blackjack
    `;
  }

  static async execute(command, message, args) {
    if (command === 'pizzahelp') {
      try {
        await message.channel.send(this.getHelpMessage());
        return true;
      } catch (error) {
        console.error('Error sending help message:', error);
        try {
          await message.channel.send('🚫 An error occurred while displaying the help message.');
        } catch (err) {
          console.error('Failed to send error message:', err);
        }
      }
    }
    return false;
  }
}

module.exports = HelpModule;
