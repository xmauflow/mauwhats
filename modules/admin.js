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

async function checkIsAdmin(bot, sender) { //Admin check
    try {
        // Get admin number from config file
        const adminNumber = config.bot.owner;  
        // Check if sender is admin
        if (sender === adminNumber) {
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error('[Admin] Error checking admin status:', error);
        return false;
    }
}

export { sendMessageToAdmin, checkIsAdmin };