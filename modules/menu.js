/**
 * Anonymous Chat Menu Module
 * Handles commands for anonymous chat functionality
 */
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import database from '../database.js';
import config from '../config.js';

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
        // Check if user is already in a chat
        const existingUser = await database.findOne(COLLECTION_NAME, { id: sender });
        if (existingUser) {
            if (existingUser.partner) {
                await bot.sendMessage(msg.key.remoteJid, {
                    text: 'You are already in an anonymous chat. Use *.stop* to end your current session first.'
                });
                return;
            } else if (existingUser.status === 'waiting') {
                await bot.sendMessage(msg.key.remoteJid, {
                    text: 'You are already searching for a partner. Please wait while we find someone for you.'
                });
                return;
            }
        }

        // Get or create user record
        let userRecord;
        if (existingUser) {
            userRecord = existingUser;
            // Update status to waiting
            await database.updateOne(COLLECTION_NAME, { id: sender }, {
                $set: { status: 'waiting', lastSearchTime: new Date() }
            });
        } else {
            // Create new user record
            userRecord = {
                id: sender,
                status: 'waiting',
                partner: null,
                joinedAt: new Date(),
                lastSearchTime: new Date(),
                recentPartners: [] // Array to store recent partners
            };
            await database.insertOne(COLLECTION_NAME, userRecord);
        }

        // Get the list of recent partners (those matched within the last hour)
        const recentPartners = userRecord.recentPartners || [];
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
        
        // Filter out partners older than 1 hour
        const currentRecentPartners = recentPartners
            .filter(entry => new Date(entry.timestamp) > oneHourAgo)
            .map(entry => entry.partnerId);

        console.log(`[Debug] User ${sender} has ${currentRecentPartners.length} recent partners to avoid`);

        // Find another waiting user that is not in the recent partners list
        const waitingUser = await database.findOne(COLLECTION_NAME, {
            status: 'waiting',
            id: { $ne: sender },
            id: { $nin: currentRecentPartners } // Exclude recent partners
        });

        if (waitingUser) {
            // Add each other to their recent partners list
            await database.updateOne(COLLECTION_NAME, { id: sender }, {
                $set: {
                    status: 'chatting',
                    partner: waitingUser.id
                },
                $push: {
                    recentPartners: {
                        partnerId: waitingUser.id,
                        timestamp: new Date()
                    }
                }
            });

            await database.updateOne(COLLECTION_NAME, { id: waitingUser.id }, {
                $set: {
                    status: 'chatting',
                    partner: sender
                },
                $push: {
                    recentPartners: {
                        partnerId: sender,
                        timestamp: new Date()
                    }
                }
            });

            // Notify both users
            await bot.sendMessage(msg.key.remoteJid, {
                text: '*Partner found!*\n\nYou are now connected to a random person. Be respectful and enjoy your conversation.\n\nUse *.next* to find a new partner or *.stop* to end the chat.'
            });

            await bot.sendMessage(waitingUser.id, {
                text: '*Partner found!*\n\nYou are now connected to a random person. Be respectful and enjoy your conversation.\n\nUse *.next* to find a new partner or *.stop* to end the chat.'
            });
        } else {
            await bot.sendMessage(msg.key.remoteJid, {
                text: '*Searching for a partner...*\n\nPlease wait while we find someone for you to chat with. You will be notified when a partner is found.\n\nUse *.stop* to cancel the search.'
            });
        }
    } catch (error) {
        console.error('[AnonymousChat] Search error:', error);
        await bot.sendMessage(msg.key.remoteJid, {
            text: 'An error occurred while searching for a partner. Please try again later.'
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

        // Update partner status
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
        const partnerId = user.partner;
        
        // Function to queue message if delivery fails
        const queueMessageOnFailure = async (content, messageType, caption = null, mediaBuffer = null) => {
            try {
                await database.insertOne('message_queue', {
                    sender: sender,
                    recipient: partnerId,
                    content: content,
                    messageType: messageType,
                    caption: caption,
                    mediaBuffer: mediaBuffer,
                    timestamp: new Date(),
                    status: 'pending',
                    retries: 0,
                    originalMessageId: msg.key.id
                });
                
                console.log(`[AnonymousChat] Message queued for later delivery to ${partnerId}`);
                
                // Notify sender that message will be delivered later
                await bot.sendMessage(sender, {
                    text: '⏳ Your message will be delivered when your partner comes back online.'
                });
                
                return true;
            } catch (queueError) {
                console.error('[AnonymousChat] Failed to queue message:', queueError);
                return false;
            }
        };
        
        // Try to deliver the message
        try {
            // Handle different message types
            if (messageContent.conversation) {
                // Simple text message
                await bot.sendMessage(partnerId, { 
                    text: messageContent.conversation 
                });
                return true;
            } 
            else if (messageContent.extendedTextMessage) {
                // Extended text message
                await bot.sendMessage(partnerId, { 
                    text: messageContent.extendedTextMessage.text 
                });
                return true;
            }
            else if (messageContent.imageMessage) {
                // Image message
                const imageBuffer = await downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    { 
                        logger: console,
                        reuploadRequest: bot.updateMediaMessage 
                    }
                );
                
                await bot.sendMessage(partnerId, { 
                    image: imageBuffer,
                    caption: messageContent.imageMessage.caption || '',
                    mimetype: messageContent.imageMessage.mimetype
                });
                return true;
            }
            else if (messageContent.videoMessage) {
                // Video message
                const videoBuffer = await downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    { 
                        logger: console,
                        reuploadRequest: bot.updateMediaMessage 
                    }
                );
                
                await bot.sendMessage(partnerId, { 
                    video: videoBuffer,
                    caption: messageContent.videoMessage.caption || '',
                    mimetype: messageContent.videoMessage.mimetype
                });
                return true;
            }
            else if (messageContent.audioMessage) {
                // Audio/voice message
                const audioBuffer = await downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    { 
                        logger: console,
                        reuploadRequest: bot.updateMediaMessage 
                    }
                );
                
                await bot.sendMessage(partnerId, { 
                    audio: audioBuffer,
                    mimetype: messageContent.audioMessage.mimetype,
                    ptt: messageContent.audioMessage.ptt || false
                });
                return true;
            }
            else if (messageContent.stickerMessage) {
                // Sticker message
                const stickerBuffer = await downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    { 
                        logger: console,
                        reuploadRequest: bot.updateMediaMessage 
                    }
                );
                
                await bot.sendMessage(partnerId, { 
                    sticker: stickerBuffer
                });
                return true;
            }
            else if (messageContent.documentMessage) {
                // Document message
                const docBuffer = await downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    { 
                        logger: console,
                        reuploadRequest: bot.updateMediaMessage 
                    }
                );
                
                await bot.sendMessage(partnerId, { 
                    document: docBuffer,
                    mimetype: messageContent.documentMessage.mimetype,
                    fileName: messageContent.documentMessage.fileName || 'document'
                });
                return true;
            }
            else if (messageContent.contactMessage || messageContent.contactsArrayMessage) {
                // Contact message
                if (messageContent.contactMessage) {
                    await bot.sendMessage(partnerId, { 
                        contacts: { 
                            displayName: messageContent.contactMessage.displayName,
                            contacts: [{ vcard: messageContent.contactMessage.vcard }] 
                        } 
                    });
                } else {
                    // Multiple contacts
                    await bot.sendMessage(partnerId, { 
                        contacts: messageContent.contactsArrayMessage 
                    });
                }
                return true;
            }
            else if (messageContent.locationMessage) {
                // Location message
                await bot.sendMessage(partnerId, { 
                    location: { 
                        degreesLatitude: messageContent.locationMessage.degreesLatitude,
                        degreesLongitude: messageContent.locationMessage.degreesLongitude
                    }
                });
                return true;
            }
            else {
                console.log('[AnonymousChat] Unsupported message type:', Object.keys(messageContent));
                
                // Notify sender that this message type is not supported
                await bot.sendMessage(sender, {
                    text: '❗ This message type could not be relayed to your partner.'
                });
                return false;
            }
        } catch (deliveryError) {
            console.error('[AnonymousChat] Message delivery failed:', deliveryError);
            
            // Queue the message for later delivery based on its type
            try {
                if (messageContent.conversation) {
                    return await queueMessageOnFailure(messageContent.conversation, 'text');
                } 
                else if (messageContent.extendedTextMessage) {
                    return await queueMessageOnFailure(messageContent.extendedTextMessage.text, 'text');
                }
                else if (messageContent.imageMessage) {
                    const imageBuffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { 
                            logger: console,
                            reuploadRequest: bot.updateMediaMessage 
                        }
                    );
                    return await queueMessageOnFailure(
                        null, 
                        'image', 
                        messageContent.imageMessage.caption || '', 
                        imageBuffer
                    );
                }
                else if (messageContent.videoMessage) {
                    const videoBuffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { 
                            logger: console,
                            reuploadRequest: bot.updateMediaMessage 
                        }
                    );
                    return await queueMessageOnFailure(
                        null, 
                        'video', 
                        messageContent.videoMessage.caption || '', 
                        videoBuffer
                    );
                }
                else if (messageContent.audioMessage) {
                    const audioBuffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { 
                            logger: console,
                            reuploadRequest: bot.updateMediaMessage 
                        }
                    );
                    return await queueMessageOnFailure(null, 'audio', null, audioBuffer);
                }
                else if (messageContent.stickerMessage) {
                    const stickerBuffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { 
                            logger: console,
                            reuploadRequest: bot.updateMediaMessage 
                        }
                    );
                    return await queueMessageOnFailure(null, 'sticker', null, stickerBuffer);
                }
                else if (messageContent.documentMessage) {
                    const docBuffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { 
                            logger: console,
                            reuploadRequest: bot.updateMediaMessage 
                        }
                    );
                    return await queueMessageOnFailure(
                        messageContent.documentMessage.fileName || 'document', 
                        'document', 
                        null, 
                        docBuffer
                    );
                }
                // Other message types are more complex to queue
                else {
                    // Notify sender that this message type couldn't be queued
                    await bot.sendMessage(sender, {
                        text: '❗ This message type could not be queued for later delivery.'
                    });
                    return false;
                }
            } catch (queueError) {
                console.error('[AnonymousChat] Failed to queue message:', queueError);
                return false;
            }
        }
    } catch (error) {
        console.error('[AnonymousChat] Relay error:', error);
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
async function processCommand(bot, msg, command, sender) {
    console.log(`[Debug] Processing command: ${command} from ${sender}`);
    
    try {
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
    } catch (error) {
        console.error(`[Error] Failed to process command ${command}:`, error);
        await bot.sendMessage(sender, { 
            text: '❌ An error occurred while processing your command. Please try again.' 
        });
        return true;
    }
}


// Export the module functions
export default {
    initializeCollections,
    processCommand,
    relayMessage,
    processMessageQueue
};