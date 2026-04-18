const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionsBitField } = require('discord.js');
const db = require('../../db');

function canManageLedger(member, botAdmins, userId) {
  const isBotAdmin = botAdmins.includes(userId);
  const isServerAdmin = member?.permissions?.has?.(PermissionsBitField.Flags.Administrator);
  return isBotAdmin || isServerAdmin;
}

function formatLedgerResult(label, result, idKey) {
  if (result.valid) {
    const count = result.transactionCount ?? result.eventCount ?? 0;
    return `✅ ${label}: verified (${count} record(s))`;
  }

  return (
    `🚫 ${label}: failed\n` +
    `Broken index: ${result.firstBrokenIndex}\n` +
    `Record ID: ${result[idKey] ?? 'unknown'}\n` +
    `Reason: ${result.reason || 'Unknown'}`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify-ledger')
    .setDescription('Verify Volt ledger integrity.'),

  async execute(context, messageOrInteraction) {
    const isPrefix = Boolean(messageOrInteraction);
    const source = isPrefix ? messageOrInteraction : context;
    const member = source.member;
    const user = source.author || source.user;

    try {
      const botAdmins = await db.getAdmins();
      if (!canManageLedger(member, botAdmins, user.id)) {
        const payload = { content: '🚫 Only bot admins or server administrators can verify the ledger.', ephemeral: true };
        if (isPrefix) return messageOrInteraction.reply(payload);
        return context.reply(payload);
      }

      const [ledgerResult, eventResult] = await Promise.all([
        db.verifyLedgerIntegrity(),
        db.verifySystemEventIntegrity(),
      ]);
      const content = [
        formatLedgerResult('Volt transaction ledger', ledgerResult, 'transactionId'),
        formatLedgerResult('System event ledger', eventResult, 'eventId'),
      ].join('\n\n');

      if (isPrefix) {
        return messageOrInteraction.reply(content);
      }

      return context.reply({ content, ephemeral: true });
    } catch (error) {
      const payload = { content: `🚫 Ledger verification failed: ${error.message || error}`, ephemeral: true };
      if (isPrefix) return messageOrInteraction.reply(payload);
      return context.reply(payload);
    }
  },
};
