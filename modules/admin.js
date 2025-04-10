import config from '../config.js';

export default async (bot) => {
    try {
        // Get admin number from config file
        const adminNumber = config.bot.owner;  
        // Send message to admin number
        await bot.sendMessage(adminNumber, { text: 'Bot is online!' });
    } catch (error) {
        console.error('[Admin] Error sending message to admin:', error);
    }
};

/**
 * Sends a message to the admin
 * @param {Object} bot - The bot instance
 * @param {string} message - The message to send
 */
export async function sendMessageToAdmin(bot, message) {
    try {
        const adminNumber = config.bot.owner;
        if (!adminNumber) {
            console.error('[Admin] No admin number configured');
            return;
        }
        
        await bot.sendMessage(adminNumber, { text: message });
    } catch (error) {
        console.error('[Admin] Error sending message to admin:', error);
    }
}

/**
 * Checks if a user is an admin
 * @param {Object} bot - The bot instance
 * @param {string} sender - The sender's WhatsApp ID
 * @returns {boolean} - True if sender is admin, false otherwise
 */
export function checkIsAdmin(bot, sender) {
    try {
        console.log("[Debug] Checking if user is admin. Sender:", sender);
        
        // Pastikan config.bot.owner ada
        if (!config.bot?.owner) {
            console.error("[Error] Bot owner not configured in config.js");
            return false;
        }
        
        // Jika owner adalah array
        if (Array.isArray(config.bot.owner)) {
            return config.bot.owner.includes(sender);
        }
        
        // Jika owner adalah string
        return config.bot.owner === sender;
    } catch (error) {
        console.error("[Error] Failed to check admin status:", error);
        return false;
    }
}