/**
 * Anonymous Chat Menu Module
 * Handles commands for anonymous chat functionality
 */

import database from '../database.js';
import config from '../config.js';

// Collection name for anonymous chat users
const COLLECTION_NAME = 'anonymous_chat';

/**
 * Initialize the anonymous chat collections
 */
async function initializeCollections() {
    try {
        // Create the collection if it doesn't exist
        await database.collection(COLLECTION_NAME);
        console.log('[AnonymousChat] Collections initialized');
    } catch (error) {
        console.error('[AnonymousChat] Error initializing collections:', error);
    }
}

/**
 * Handle the search command - find a chat partner
 * @param {Object} bot - The WhatsApp bot instance
 * @param {Object} msg - The message object
 * @param {String} sender - The sender's ID
 */
async function handleSearch(bot, msg, sender) {
    try {
        // Check if user is already in a chat
        const existingUser = await database.findOne(COLLECTION_NAME, { id: sender });
        if (existingUser && existingUser.partner) {
            await bot.sendMessage(msg.key.remoteJid, { 
                text: '❌ You are already in an anonymous chat. Use *.stop* to end your current session first.' 
            });
            return;
        }

        // Add user to waiting list or update their status
        if (existingUser) {
            await database.updateOne(COLLECTION_NAME, { id: sender }, { $set: { status: 'waiting' } });
        } else {
            await database.insertOne(COLLECTION_NAME, { 
                id: sender, 
                status: 'waiting', 
                partner: null,
                joinedAt: new Date()
            });
        }

        // Find another waiting user
        const waitingUser = await database.findOne(COLLECTION_NAME, { 
            status: 'waiting', 
            id: { $ne: sender } 
        });

        if (waitingUser) {
            // Match the users
            await database.updateOne(COLLECTION_NAME, { id: sender }, { 
                $set: { status: 'chatting', partner: waitingUser.id } 
            });
            await database.updateOne(COLLECTION_NAME, { id: waitingUser.id }, { 
                $set: { status: 'chatting', partner: sender } 
            });

            // Notify both users
            await bot.sendMessage(msg.key.remoteJid, { 
                text: '✅ *Partner found!*\n\nYou are now connected to a random person. Be respectful and enjoy your conversation.\n\nUse *.next* to find a new partner or *.stop* to end the chat.' 
            });
            
            await bot.sendMessage(waitingUser.id, { 
                text: '✅ *Partner found!*\n\nYou are now connected to a random person. Be respectful and enjoy your conversation.\n\nUse *.next* to find a new partner or *.stop* to end the chat.' 
            });
        } else {
            await bot.sendMessage(msg.key.remoteJid, { 
                text: '⏳ *Searching for a partner...*\n\nPlease wait while we find someone for you to chat with. You will be notified when a partner is found.\n\nUse *.stop* to cancel the search.' 
            });
        }
    } catch (error) {
        console.error('[AnonymousChat] Search error:', error);
        await bot.sendMessage(msg.key.remoteJid, { 
            text: '❌ An error occurred while searching for a partner. Please try again later.' 
        });
    }
}

/**
 * Handle the next command - find a new chat partner
 * @param {Object} bot - The WhatsApp bot instance
 * @param {Object} msg - The message object
 * @param {String} sender - The sender's ID
 */
async function handleNext(bot, msg, sender) {
    try {
        // Check if user is in a chat
        const user = await database.findOne(COLLECTION_NAME, { id: sender });
        if (!user || !user.partner) {
            await bot.sendMessage(msg.key.remoteJid, { 
                text: '❌ You are not in an anonymous chat. Use *.search* to find a partner first.' 
            });
            return;
        }

        const partnerId = user.partner;

        // Notify the partner
        await bot.sendMessage(partnerId, { 
            text: '👋 Your chat partner has left and is looking for someone new. Use *.search* to find a new partner.' 
        });

        // Update both users
        await database.updateOne(COLLECTION_NAME, { id: partnerId }, { 
            $set: { status: 'idle', partner: null } 
        });

        // Start search for new partner
        await handleSearch(bot, msg, sender);
    } catch (error) {
        console.error('[AnonymousChat] Next error:', error);
        await bot.sendMessage(msg.key.remoteJid, { 
            text: '❌ An error occurred while finding a new partner. Please try again later.' 
        });
    }
}

/**
 * Handle the stop command - end the current chat
 * @param {Object} bot - The WhatsApp bot instance
 * @param {Object} msg - The message object
 * @param {String} sender - The sender's ID
 */
async function handleStop(bot, msg, sender) {
    try {
        // Check if user is in a chat or waiting
        const user = await database.findOne(COLLECTION_NAME, { id: sender });
        if (!user) {
            await bot.sendMessage(msg.key.remoteJid, { 
                text: '❌ You are not in an anonymous chat session.' 
            });
            return;
        }

        if (user.partner) {
            // Notify the partner
            await bot.sendMessage(user.partner, { 
                text: '👋 Your chat partner has ended the conversation. Use *.search* to find a new partner.' 
            });

            // Update partner status
            await database.updateOne(COLLECTION_NAME, { id: user.partner }, { 
                $set: { status: 'idle', partner: null } 
            });
        }

        // Update user status
        await database.updateOne(COLLECTION_NAME, { id: sender }, { 
            $set: { status: 'idle', partner: null } 
        });

        await bot.sendMessage(msg.key.remoteJid, { 
            text: '✅ You have successfully ended the anonymous chat session. Use *.search* to start a new one.' 
        });
    } catch (error) {
        console.error('[AnonymousChat] Stop error:', error);
        await bot.sendMessage(msg.key.remoteJid, { 
            text: '❌ An error occurred while ending the chat. Please try again.' 
        });
    }
}

/**
 * Handle the sendpp command - send profile picture to partner
 * @param {Object} bot - The WhatsApp bot instance
 * @param {Object} msg - The message object
 * @param {String} sender - The sender's ID
 */
async function handleSendPP(bot, msg, sender) {
    try {
        // Check if user is in a chat
        const user = await database.findOne(COLLECTION_NAME, { id: sender });
        if (!user || !user.partner) {
            await bot.sendMessage(msg.key.remoteJid, { 
                text: '❌ You are not in an anonymous chat. Use *.search* to find a partner first.' 
            });
            return;
        }

        // Get profile picture
        let ppUrl;
        try {
            ppUrl = await bot.profilePictureUrl(sender, 'image');
        } catch (err) {
            await bot.sendMessage(msg.key.remoteJid, { 
                text: '❌ Could not retrieve your profile picture. Make sure you have a profile picture set.' 
            });
            return;
        }

        // Send profile picture to partner
        await bot.sendMessage(user.partner, { 
            image: { url: ppUrl },
            caption: '🖼️ Your anonymous chat partner has shared their profile picture with you.'
        });

        await bot.sendMessage(msg.key.remoteJid, { 
            text: '✅ Your profile picture has been sent to your chat partner.' 
        });
    } catch (error) {
        console.error('[AnonymousChat] SendPP error:', error);
        await bot.sendMessage(msg.key.remoteJid, { 
            text: '❌ An error occurred while sending your profile picture. Please try again later.' 
        });
    }
}

/**
 * Handle message relay between anonymous chat partners
 * @param {Object} bot - The WhatsApp bot instance
 * @param {Object} msg - The message object
 * @param {String} sender - The sender's ID
 */
async function relayMessage(bot, msg, sender) {
    try {
        // Check if user is in a chat
        const user = await database.findOne(COLLECTION_NAME, { id: sender });
        if (!user || !user.partner || user.status !== 'chatting') {
            return false; // Not in a chat, don't relay
        }

        // Get the message content
        const messageContent = msg.message;
        
        // Forward the message to the partner
        await bot.sendMessage(user.partner, messageContent);
        return true; // Message relayed
    } catch (error) {
        console.error('[AnonymousChat] Relay error:', error);
        return false;
    }
}

/**
 * Process commands for anonymous chat
 * @param {Object} bot - The WhatsApp bot instance
 * @param {Object} msg - The message object
 * @param {String} command - The command (without prefix)
 * @param {String} sender - The sender's ID
 */
async function processCommand(bot, msg, command, sender) {
    switch (command.toLowerCase()) {
        case 'search':
            await handleSearch(bot, msg, sender);
            return true;
        case 'next':
            await handleNext(bot, msg, sender);
            return true;
        case 'stop':
            await handleStop(bot, msg, sender);
            return true;
        case 'sendpp':
            await handleSendPP(bot, msg, sender);
            return true;
        default:
            return false;
    }
}

// Export the module functions
export default {
    initializeCollections,
    processCommand,
    relayMessage
};