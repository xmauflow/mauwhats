/**
 * Anonymous Chat Menu Module
 * Handles commands for anonymous chat functionality
 */
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import database from '../database.js';
import config from '../config.js';
import AdvertiseManager from './advertise.js';
import { checkIsAdmin } from './admin.js';

// Collection name for anonymous chat users
const COLLECTION_NAME = config.anonymousChat?.collection || 'anonymous_chat';

async function cleanupRecentPartners() {
    try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
        
        // Update all users to remove partners older than 1 hour
        await database.updateMany(COLLECTION_NAME, {}, {
            $pull: {
                recentPartners: {
                    timestamp: { $lt: oneHourAgo }
                }
            }
        });
        
        console.log('[AnonymousChat] Cleaned up old recent partners entries');
    } catch (error) {
        console.error('[AnonymousChat] Cleanup error:', error);
    }
}


/**
 * Initialize the anonymous chat collections
 */
async function initializeCollections() {
    try {
        // Create the collections if they don't exist
        await database.collection(COLLECTION_NAME);
        await database.collection('message_queue');
        console.log('[AnonymousChat] Collections initialized');
        
        // Set up periodic cleanup of recent partners (every hour)
        setInterval(cleanupRecentPartners, 60 * 60 * 1000); // Run every hour
        
        // Set up periodic processing of message queue (every minute)
        setInterval(async () => {
            const bot = global.bot; // Assuming you store the bot instance globally
            if (bot) {
                await processMessageQueue(bot);
            }
        }, 60 * 1000); // Run every minute
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
        // Check if user is already in chat
        const existingUser = await database.findOne(COLLECTION_NAME, { 
            id: sender,
            status: 'chatting'
        });

        if (existingUser && existingUser.partner) {
            await bot.sendMessage(msg.key.remoteJid, { 
                text: '❌ You are already in a conversation. Use *.stop* to end the chat first.' 
            });
            return;
        }

        // Check if user is already searching
        const searchingUser = await database.findOne(COLLECTION_NAME, {
            id: sender,
            status: 'waiting'
        });

        if (searchingUser) {
            await bot.sendMessage(msg.key.remoteJid, { 
                text: '🔍 You are already in search mode. Please wait...\n\nUse *.stop* to cancel the search.' 
            });
            return;
        }

        // Find available partner
        const partner = await database.findOne(COLLECTION_NAME, {
            status: 'waiting',
            id: { $ne: sender }
        });

        if (partner) {
            // Connect both users
            await database.updateOne(COLLECTION_NAME, { id: sender }, {
                $set: {
                    status: 'chatting',
                    partner: partner.id,
                    lastActivity: new Date()
                }
            }, { upsert: true });

            await database.updateOne(COLLECTION_NAME, { id: partner.id }, {
                $set: {
                    status: 'chatting',
                    partner: sender,
                    lastActivity: new Date()
                }
            });

            // Send success messages
            const connectedMsg = '🎉 *Partner found!*\n\n' +
                               'You are now connected to a random person. ' +
                               'Be respectful and enjoy your conversation.\n\n' +
                               'Use *.next* to find a new partner or ' +
                               '*.stop* to end the chat.';

            await bot.sendMessage(msg.key.remoteJid, { text: connectedMsg });
            await bot.sendMessage(partner.id, { text: connectedMsg });

            // Send advertisement if configured
            await AdvertiseManager.sendAdvertisement(bot, sender, 'search');
            await AdvertiseManager.sendAdvertisement(bot, partner.id, 'search');
        } else {
            // Add user to waiting list
            await database.updateOne(COLLECTION_NAME, { id: sender }, {
                $set: {
                    status: 'waiting',
                    partner: null,
                    lastActivity: new Date()
                }
            }, { upsert: true });

            await bot.sendMessage(msg.key.remoteJid, { 
                text: '🔍 *Searching for a chat partner...*\n\n' +
                      'Please wait while we find someone for you.\n\n' +
                      'Use *.stop* to cancel the search.' 
            });
        }
    } catch (error) {
        console.error('[Search] Error:', error);
        throw error;
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
        // Check if user is in chat
        const user = await database.findOne(COLLECTION_NAME, {
            id: sender,
            status: 'chatting'
        });

        if (!user || !user.partner) {
            await bot.sendMessage(msg.key.remoteJid, { 
                text: '❌ You are not in a conversation with anyone.' 
            });
            return;
        }

        const partnerId = user.partner;

        // Notify current partner
        await bot.sendMessage(partnerId, { 
            text: '👋 Your partner has decided to find someone new.' 
        });

        // Update both users' status
        await database.updateOne(COLLECTION_NAME, { id: partnerId }, {
            $set: {
                status: 'idle',
                partner: null,
                lastActivity: new Date()
            }
        });

        // Start new search for current user
        await handleSearch(bot, msg, sender);

    } catch (error) {
        console.error('[Next] Error:', error);
        throw error;
    }
}

// Fungsi helper untuk mencari partner yang tersedia
async function findAvailablePartner(userID) {
    try {
        // Cek waiting list untuk partner yang tersedia
        const waitingUser = await database.findOne('waiting_users', {
            userID: { $ne: userID }  // Jangan pilih diri sendiri
        });

        if (waitingUser) {
            // Hapus user dari waiting list
            await database.deleteOne('waiting_users', {
                userID: waitingUser.userID
            });
            return waitingUser.userID;
        }

        return null;
    } catch (error) {
        console.error('[Error] findAvailablePartner:', error);
        return null;
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
        const user = await database.findOne(COLLECTION_NAME, { id: sender });

        if (!user) {
            await bot.sendMessage(msg.key.remoteJid, { 
                text: '❌ You are not in a conversation or search.' 
            });
            return;
        }

        if (user.partner) {
            // Notify partner if exists
            await bot.sendMessage(user.partner, { 
                text: '👋 Your partner has ended the conversation.' 
            });

            // Update partner status
            await database.updateOne(COLLECTION_NAME, { id: user.partner }, {
                $set: {
                    status: 'idle',
                    partner: null,
                    lastActivity: new Date()
                }
            });
        }

        // Update user status
        await database.updateOne(COLLECTION_NAME, { id: sender }, {
            $set: {
                status: 'idle',
                partner: null,
                lastActivity: new Date()
            }
        });

        await bot.sendMessage(msg.key.remoteJid, { 
            text: '✅ Chat ended.\n\nUse *.search* to find a new partner.' 
        });

    } catch (error) {
        console.error('[Stop] Error:', error);
        throw error;
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
        const user = await database.findOne(COLLECTION_NAME, {
            id: sender,
            status: 'chatting'
        });

        if (!user || !user.partner) {
            await bot.sendMessage(msg.key.remoteJid, { 
                text: '❌ You must be in a conversation to send your profile picture.' 
            });
            return;
        }

        try {
            const ppUrl = await bot.profilePictureUrl(sender, 'image');
            
            // Send PP to partner
            await bot.sendMessage(user.partner, { 
                image: { url: ppUrl },
                caption: '👤 Partner\'s profile picture.'
            });

            await bot.sendMessage(msg.key.remoteJid, { 
                text: '✅ Profile picture successfully sent to your partner.' 
            });

        } catch (ppError) {
            await bot.sendMessage(msg.key.remoteJid, { 
                text: '❌ Could not fetch profile picture. Make sure you have a profile picture set.' 
            });
        }

    } catch (error) {
        console.error('[SendPP] Error:', error);
        throw error;
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
        const user = await database.findOne(COLLECTION_NAME, {
            id: sender,
            status: 'chatting'
        });

        if (!user || !user.partner) {
            return false;
        }

        // Forward message to partner
        await bot.sendMessage(user.partner, msg.message);
        return true;

    } catch (error) {
        console.error('[Relay] Error:', error);
        return false;
    }
}

/**
 * Process any pending messages in the queue
 * @param {Object} bot - The WhatsApp bot instance
 */
async function processMessageQueue(bot) {
    try {
        const pendingMessages = await database.getPendingMessages();
        console.log(`[Queue] Processing ${pendingMessages.length} pending messages`);
        
        if (pendingMessages.length === 0) {
            return;
        }
        
        for (const queuedMsg of pendingMessages) {
            try {
                // Check if chat is still valid
                const sender = await database.findOne(COLLECTION_NAME, { id: queuedMsg.sender });
                if (!sender || sender.partner !== queuedMsg.recipient || sender.status !== 'chatting') {
                    // Chat no longer valid, mark message as cancelled
                    await database.updateOne('message_queue', 
                        { _id: queuedMsg._id },
                        { $set: {
                            status: 'cancelled',
                            reason: 'chat_ended'
                        }}
                    );
                    continue;
                }
                
                // Attempt delivery based on message type
                const deliveryNote = '\n\n_[This message was delivered after a connection issue]_';
                
                switch (queuedMsg.messageType) {
                    case 'text':
                        await bot.sendMessage(queuedMsg.recipient, { 
                            text: `${queuedMsg.content}${deliveryNote}` 
                        });
                        break;
                        
                    case 'image':
                        await bot.sendMessage(queuedMsg.recipient, { 
                            image: queuedMsg.mediaBuffer,
                            caption: queuedMsg.caption ? `${queuedMsg.caption}${deliveryNote}` : deliveryNote
                        });
                        break;
                        
                    case 'video':
                        await bot.sendMessage(queuedMsg.recipient, { 
                            video: queuedMsg.mediaBuffer,
                            caption: queuedMsg.caption ? `${queuedMsg.caption}${deliveryNote}` : deliveryNote
                        });
                        break;
                        
                    case 'audio':
                        await bot.sendMessage(queuedMsg.recipient, { 
                            audio: queuedMsg.mediaBuffer,
                            ptt: true // Voice note
                        });
                        break;
                        
                    case 'sticker':
                        await bot.sendMessage(queuedMsg.recipient, { 
                            sticker: queuedMsg.mediaBuffer
                        });
                        break;
                        
                    case 'document':
                        await bot.sendMessage(queuedMsg.recipient, { 
                            document: queuedMsg.mediaBuffer,
                            fileName: queuedMsg.content || 'document'
                        });
                        break;
                        
                    default:
                        console.warn(`[Queue] Unsupported message type: ${queuedMsg.messageType}`);
                        continue;
                }
                
                // Mark as delivered
                await database.updateOne('message_queue', 
                    { _id: queuedMsg._id },
                    { $set: {
                        status: 'delivered',
                        deliveredAt: new Date()
                    }}
                );
                
                // Notify sender of successful delivery
                try {
                    await bot.sendMessage(queuedMsg.sender, {
                        text: '✅ Your message has been delivered.'
                    });
                } catch (notifyError) {
                    console.error('[Queue] Failed to notify sender:', notifyError);
                }
            } catch (error) {
                console.error(`[Queue] Failed to process message ${queuedMsg._id}:`, error);
                
                // Update retry count
                const newRetryCount = (queuedMsg.retries || 0) + 1;
                if (newRetryCount < 3) { // Max 3 retries
                    await database.updateOne('message_queue', 
                        { _id: queuedMsg._id },
                        { $set: {
                            status: 'failed',
                            retries: newRetryCount,
                            lastAttempt: new Date(),
                            error: error.message
                        }}
                    );
                } else {
                    // Max retries reached, mark as failed
                    await database.updateOne('message_queue', 
                        { _id: queuedMsg._id },
                        { $set: {
                            status: 'failed_permanent',
                            lastAttempt: new Date(),
                            error: 'Max retries exceeded'
                        }}
                    );
                    
                    // Notify sender of permanent failure
                    try {
                        await bot.sendMessage(queuedMsg.sender, {
                            text: '❌ Your message could not be delivered after multiple attempts.'
                        });
                    } catch (notifyError) {
                        console.error('[Queue] Failed to notify sender of permanent failure:', notifyError);
                    }
                }
            }
        }
    } catch (error) {
        console.error('[Queue] Error processing message queue:', error);
    }
}


/**
 * Process commands for anonymous chat
 * @param {Object} bot - The WhatsApp bot instance
 * @param {Object} msg - The message object
 * @param {String} command - The command (without prefix)
 * @param {String} sender - The sender's ID
 */
async function processCommand(bot, msg, sender) {
    console.log("[Debug] processCommand called with sender:", sender);
    
    // Ekstrak body dengan aman
    const msgBody = msg.body || 
                  (msg.message?.conversation) || 
                  (msg.message?.extendedTextMessage?.text) || 
                  (msg.message?.imageMessage?.caption) || 
                  '';
    
    const command = msgBody.toLowerCase().trim();
    console.log("[Debug] Command extracted:", command);
    
    // Check if user is admin
    const isAdmin = await checkIsAdmin(bot, sender);
    console.log("[Debug] Is admin check result:", isAdmin);
    
    if (isAdmin) {
        console.log("[Debug] User is admin, processing admin commands");
        
        if (command.startsWith('.addad')) {
            console.log("[Debug] Processing .addad command");
            const fullCommand = msgBody.slice(7).trim(); // Hapus '.addad ' dan gunakan msgBody asli, bukan command
            const parts = fullCommand.split('|').map(p => p.trim());
            
            if (parts.length !== 4) {
                await bot.sendMessage(sender, {
                    text: ' Format salah!\n\nFormat yang benar:\n.addad <type> <title> | <content> | <priority> | <days_active>\n\n' +
                        'Contoh:\n.addad start Selamat Datang |  Selamat datang di bot chat anonymous! | 5 | 30\n\n' +
                        'Types yang tersedia: start, search, chat, end'
                });
                return true;
            }
        
            const [typeAndTitle, content, priority, daysActive] = parts;
            
            // Gunakan msgBody asli untuk mendapatkan type dan title
            const typeAndTitleOriginal = msgBody.slice(7).trim().split('|')[0].trim();
            const [type, ...titleParts] = typeAndTitleOriginal.split(' ');
            
            // Validasi type
            const validTypes = ['start', 'search', 'chat', 'end'];
            if (!validTypes.includes(type.toLowerCase())) {
                await bot.sendMessage(sender, {
                    text: ' Type tidak valid!\n\nType yang tersedia:\nstart, search, chat, end'
                });
                return true;
            }
            
            const title = titleParts.join(' ');
            
            // Validasi priority
            const priorityNum = parseInt(priority);
            if (isNaN(priorityNum) || priorityNum < 1 || priorityNum > 10) {
                await bot.sendMessage(sender, {
                    text: ' Priority harus berupa angka antara 1-10'
                });
                return true;
            }
            
            // Validasi days_active
            const days = parseInt(daysActive);
            if (isNaN(days) || days < 1) {
                await bot.sendMessage(sender, {
                    text: ' days_active harus berupa angka positif'
                });
                return true;
            }
        
            // Gunakan content asli tanpa mengubah case
            const contentOriginal = msgBody.slice(7).trim().split('|')[1].trim();
        
            try {
                const success = await AdvertiseManager.addAdvertisement(
                    type.toLowerCase(), 
                    title,
                    contentOriginal, // Gunakan content asli
                    priorityNum,
                    days
                );
                await bot.sendMessage(sender, {
                    text: success ? ' Iklan berhasil ditambahkan!' : ' Gagal menambahkan iklan'
                });
            } catch (error) {
                console.error('[Error] Failed to add advertisement:', error);
                await bot.sendMessage(sender, {
                    text: ' Terjadi kesalahan saat menambahkan iklan'
                });
            }
            return true;
        }
        
        if (command === '.listads') {
            const ads = await AdvertiseManager.listAdvertisements();
            if (!ads.length) {
                await bot.sendMessage(sender, {
                    text: ' No advertisements found'
                });
                return true;
            }

            const adList = ads.map(ad => 
                `ID: ${ad._id}\n` +
                `Type: ${ad.type}\n` +
                `Title: ${ad.title}\n` +
                `Active: ${ad.active ? 'Yes' : 'No'}\n` +
                `Priority: ${ad.priority}\n` +
                `Shows: ${ad.showCount || 0}\n` +
                `Expires: ${ad.endDate.toLocaleDateString()}\n`
            ).join('\n---\n');

            await bot.sendMessage(sender, {
                text: ` *Advertisement List*\n\n${adList}`
            });
            return true;
        }

        if (command.startsWith('.delad')) {
            const adId = command.slice(7).trim();
            const success = await AdvertiseManager.deleteAdvertisement(adId);
            await bot.sendMessage(sender, {
                text: success ? ' Advertisement deleted successfully!' : ' Failed to delete advertisement'
            });
            return true;
        }

        if (command === '.adstats') {
            const stats = await AdvertiseManager.getStats();
            if (!stats) {
                await bot.sendMessage(sender, {
                    text: ' Failed to get advertisement statistics'
                });
                return true;
            }

            const statsMessage = 
                ` *Advertisement Statistics*\n\n` +
                `Total Ads: ${stats.total}\n` +
                `Active Ads: ${stats.active}\n` +
                `Total Shows: ${stats.totalShows}\n\n` +
                `*By Type:*\n` +
                Object.entries(stats.byType)
                    .map(([type, count]) => `${type}: ${count}`)
                    .join('\n');

            await bot.sendMessage(sender, {
                text: statsMessage
            });
            return true;
        }
    }
    
    try {
        // Ekstrak perintah tanpa awalan
        const cleanCommand = command.startsWith('.') ? command.slice(1) : command;
        
        switch (cleanCommand) {
            case 'adstats':
                const stats = await AdvertiseManager.getStats();
                await bot.sendMessage(msg.key.remoteJid, { text: stats });
                return true;
                
            case 'delad':
                const adId = args[0];
                if (!adId) {
                    await bot.sendMessage(msg.key.remoteJid, { 
                        text: '❌ Please provide an advertisement ID. Usage: .delad [id]' 
                    });
                    return true;
                }
                
                const result = await AdvertiseManager.deleteAdvertisement(adId);
                
                if (result.success) {
                    await bot.sendMessage(msg.key.remoteJid, { 
                        text: `✅ ${result.message}` 
                    });
                } else {
                    await bot.sendMessage(msg.key.remoteJid, { 
                        text: `❌ ${result.message}` 
                    });
                }
                return true;
            
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
    } catch (error) {
        console.error(`[Error] Failed to process command ${command}:`, error);
        await bot.sendMessage(sender, { 
            text: ' An error occurred while processing your command. Please try again.' 
        });
        return true;
    }
}

// Help command handler
async function sendHelpMessage(bot, msg) {
    const helpText = `🤖 *Anonymous Chat Bot*\n\n` +
                    `Available Commands:\n\n` +
                    `*.search* - Find a chat partner\n` +
                    `*.next* - Find a new partner\n` +
                    `*.stop* - End the chat\n` +
                    `*.sendpp* - Share your profile picture\n` +
                    `*.help* - Show this help message\n\n` +
                    `Start chatting now by typing *.search*!`;

    await bot.sendMessage(msg.key.remoteJid, { text: helpText });
}

// Export the module functions
export {
    processCommand,
    relayMessage,
    sendHelpMessage
};