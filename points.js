require('dotenv').config();

const points = {
  name: process.env.POINTS_NAME || 'pizza', // Default points name
  symbol: process.env.POINTS_SYMBOL || '🍕', // Default symbol
  helpCommand: process.env.HELP_COMMAND || 'help' // Default help command
};

function formatCurrency(amount) {
  return `${amount} ${points.symbol}`;
}

module.exports = { points, formatCurrency };
