/**
 * Advertisement Module
 * Handles promotional messages for the bot features
 */

/**
 * Send advertisement message about the anonymous chat feature
 * @param {Object} bot - The WhatsApp bot instance
 * @param {String} jid - The JID to send the message to
 */
async function sendAnonymousChatAd(bot, jid) {
    const adMessage = `*🔒 Anonymous Chat Bot 🔒*

Chat with random people without revealing your identity!

*Available Commands:*
*.search* - Find a chat partner
*.next* - Skip current partner & find a new one
*.stop* - End the anonymous chat
*.sendpp* - Share your profile picture

*How it works:*
1. Type *.search* to start looking for a partner
2. Once connected, all your messages will be forwarded to them
3. Your identity remains hidden unless you choose to reveal it
4. Be respectful and follow community guidelines

Start chatting anonymously now! Type *.search* to begin.`;

    try {
        await bot.sendMessage(jid, { 
            text: adMessage
        });
        console.log(`[Bot] Sent menu to ${jid}`);
    } catch (error) {
        console.error('[Error] Failed to send menu:', error);
    }
}

export default {
    sendAnonymousChatAd
};