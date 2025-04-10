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

async function sendMessageToAdmin(bot, message) {
    try {
        // Get admin number from config file
        const adminNumber = config.bot.owner;  
        // Send message to admin number
        await bot.sendMessage(adminNumber, { text: message });
    } catch (error) {
        console.error('[Admin] Error sending message to admin:', error);
    }
}

async function checkIsAdmin(bot, sender) {
    try {
        console.log("[Debug] Checking if user is admin. Sender:", sender);
        console.log("[Debug] Config owners:", config.bot.owner);
        
        // Jika config.owners adalah array
        if (Array.isArray(config.bot.owner)) {
            return config.bot.owner.includes(sender);
        }
        
        // Jika config.owners adalah string
        if (typeof config.owners === 'string') {
            return config.owners === sender;
        }
        
        // Fallback: cek apakah sender adalah nomor bot
        const botNumber = bot.user.id.split(':')[0] + '@s.whatsapp.net';
        return sender === botNumber;
    } catch (error) {
        console.error("[Error] Failed to check admin status:", error);
        return false;
    }
}

export { sendMessageToAdmin, checkIsAdmin };