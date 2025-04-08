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
        await database.collection('offline_messages');
        console.log('[AnonymousChat] Collections initialized');
        
        // Set up periodic cleanup of recent partners (every hour)
        setInterval(cleanupRecentPartners, 60 * 60 * 1000); // Run every hour
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
        const queueMessageOnFailure = async (messageData) => {
            try {
                await database.addToMessageQueue({
                    sender: sender,
                    recipient: partnerId,
                    messageData: messageData,
                    timestamp: new Date(),
                    messageType: Object.keys(messageContent)[0], // Store the message type
                    originalMessageId: msg.key.id
                });
                console.log(`[AnonymousChat] Message queued for later delivery to ${partnerId}`);
                
                // Notify sender that message will be delivered later
                await bot.sendMessage(sender, {
                    text: '⏳ Your message will be delivered when your partner comes back online.'
                });
            } catch (queueError) {
                console.error('[AnonymousChat] Failed to queue message:', queueError);
            }
        };
        
        // Handle different message types
        try {
            if (messageContent.conversation) {
                // Text message
                await bot.sendMessage(partnerId, { 
                    text: messageContent.conversation 
                });
            } 
            else if (messageContent.extendedTextMessage) {
                // Extended text message
                await bot.sendMessage(partnerId, { 
                    text: messageContent.extendedTextMessage.text 
                });
            }
            else if (messageContent.imageMessage) {
                // Image message
                try {
                    const buffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { 
                            logger: console,
                            reuploadRequest: bot.updateMediaMessage 
                        }
                    );
                    
                    await bot.sendMessage(partnerId, { 
                        image: buffer,
                        caption: messageContent.imageMessage.caption || ''
                    });
                } catch (error) {
                    console.error('[Error] Failed to download and relay image:', error);
                    
                    // Queue the message for later delivery
                    await queueMessageOnFailure({
                        type: 'image',
                        content: '📷 [Your partner sent an image that will be delivered when you\'re both online]',
                        caption: messageContent.imageMessage?.caption || ''
                    });
                    return true;
                }
            }
            else if (messageContent.videoMessage) {
                // Video message
                try {
                    const buffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { 
                            logger: console,
                            reuploadRequest: bot.updateMediaMessage 
                        }
                    );
                    
                    await bot.sendMessage(partnerId, { 
                        video: buffer,
                        caption: messageContent.videoMessage.caption || ''
                    });
                } catch (error) {
                    console.error('[Error] Failed to download and relay video:', error);
                    
                    // Queue the message for later delivery
                    await queueMessageOnFailure({
                        type: 'video',
                        content: '🎥 [Your partner sent a video that will be delivered when you\'re both online]',
                        caption: messageContent.videoMessage?.caption || ''
                    });
                    return true;
                }
            }
            else if (messageContent.audioMessage) {
                // Audio message
                try {
                    const buffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { 
                            logger: console,
                            reuploadRequest: bot.updateMediaMessage 
                        }
                    );
                    
                    await bot.sendMessage(partnerId, { 
                        audio: buffer,
                        mimetype: 'audio/mp4'
                    });
                } catch (error) {
                    console.error('[Error] Failed to download and relay audio:', error);
                    
                    // Queue the message for later delivery
                    await queueMessageOnFailure({
                        type: 'audio',
                        content: '🔊 [Your partner sent an audio message that will be delivered when you\'re both online]'
                    });
                    return true;
                }
            }
            else if (messageContent.stickerMessage) {
                // Sticker message
                try {
                    const buffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { 
                            logger: console,
                            reuploadRequest: bot.updateMediaMessage 
                        }
                    );
                    
                    await bot.sendMessage(partnerId, { 
                        sticker: buffer
                    });
                } catch (error) {
                    console.error('[Error] Failed to download and relay sticker:', error);
                    
                    // Queue the message for later delivery
                    await queueMessageOnFailure({
                        type: 'text',
                        content: '🎭 [Your partner sent a sticker that will be delivered when you\'re both online]'
                    });
                    return true;
                }
            }
            else if (messageContent.documentMessage) {
                // Document message
                try {
                    const buffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { 
                            logger: console,
                            reuploadRequest: bot.updateMediaMessage 
                        }
                    );
                    
                    await bot.sendMessage(partnerId, { 
                        document: buffer,
                        mimetype: messageContent.documentMessage.mimetype,
                        fileName: messageContent.documentMessage.fileName || 'file'
                    });
                } catch (error) {
                    console.error('[Error] Failed to download and relay document:', error);
                    
                    // Queue the message for later delivery
                    await queueMessageOnFailure({
                        type: 'document',
                        content: '📄 [Your partner sent a document that will be delivered when you\'re both online]',
                        fileName: messageContent.documentMessage?.fileName || 'file'
                    });
                    return true;
                }
            }
            else if (messageContent.contactMessage || messageContent.contactsArrayMessage) {
                // Contact message
                if (messageContent.contactMessage) {
                    // Single contact
                    await bot.sendMessage(partnerId, { 
                        contacts: { 
                            displayName: messageContent.contactMessage.displayName,
                            contacts: [{ vcard: messageContent.contactMessage.vcard }]
                        }
                    });
                } else if (messageContent.contactsArrayMessage) {
                    // Multiple contacts
                    await bot.sendMessage(partnerId, { 
                        contacts: messageContent.contactsArrayMessage
                    });
                }
            }
            else if (messageContent.locationMessage) {
                // Location message
                await bot.sendMessage(partnerId, { 
                    location: { 
                        degreesLatitude: messageContent.locationMessage.degreesLatitude,
                        degreesLongitude: messageContent.locationMessage.degreesLongitude
                    }
                });
            }
            else if (messageContent.liveLocationMessage) {
                // Live location message
                await bot.sendMessage(partnerId, { 
                    text: '📍 [Your partner shared their live location]' 
                });
            }
            else if (messageContent.reactionMessage) {
                // Reaction message - we'll skip these as they're not essential
                console.log('[Debug] Skipping reaction message');
                return true;
            }
            else if (messageContent.protocolMessage) {
                // Protocol message - we'll skip these as they're internal WhatsApp messages
                console.log('[Debug] Skipping protocol message');
                return true;
            }
            else {
                // Unsupported message type
                console.log('[Debug] Unsupported message type:', Object.keys(messageContent));
                await bot.sendMessage(partnerId, { 
                    text: '[Your partner sent a message type that cannot be forwarded]' 
                });
            }
            
            return true; // Message relayed successfully
        } catch (deliveryError) {
            console.error('[AnonymousChat] Message delivery failed:', deliveryError);
            
            // Determine message type for queueing
            let messageData;
            if (messageContent.conversation) {
                messageData = {
                    type: 'text',
                    content: messageContent.conversation
                };
            } else if (messageContent.extendedTextMessage) {
                messageData = {
                    type: 'text',
                    content: messageContent.extendedTextMessage.text
                };
            } else if (messageContent.imageMessage) {
                messageData = {
                    type: 'text',
                    content: '📷 [Image message]',
                    caption: messageContent.imageMessage?.caption || ''
                };
            } else if (messageContent.videoMessage) {
                messageData = {
                    type: 'text',
                    content: '🎥 [Video message]',
                    caption: messageContent.videoMessage?.caption || ''
                };
            } else if (messageContent.audioMessage) {
                messageData = {
                    type: 'text',
                    content: '🔊 [Audio message]'
                };
            } else if (messageContent.stickerMessage) {
                messageData = {
                    type: 'text',
                    content: '🎭 [Sticker]'
                };
            } else if (messageContent.documentMessage) {
                messageData = {
                    type: 'text',
                    content: '📄 [Document: ' + (messageContent.documentMessage?.fileName || 'file') + ']'
                };
            } else if (messageContent.contactMessage || messageContent.contactsArrayMessage) {
                messageData = {
                    type: 'text',
                    content: '👤 [Contact]'
                };
            } else if (messageContent.locationMessage) {
                messageData = {
                    type: 'text',
                    content: '📍 [Location]'
                };
            } else {
                messageData = {
                    type: 'text',
                    content: '[Message]'
                };
            }
            
            // Queue the message for later delivery
            await queueMessageOnFailure(messageData);
            return true;
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
        console.log('[AnonymousChat] Processing message queue...');
        
        // Get all pending messages
        const pendingMessages = await database.getPendingMessages();
        
        if (pendingMessages.length === 0) {
            console.log('[AnonymousChat] No pending messages in queue');
            return;
        }
        
        console.log(`[AnonymousChat] Found ${pendingMessages.length} pending messages`);
        
        const deliveredMessageIds = [];
        
        // Process each message
        for (const queuedMsg of pendingMessages) {
            try {
                // Check if both users are still in a chat together
                const sender = await database.findOne(COLLECTION_NAME, { id: queuedMsg.sender });
                
                if (sender && 
                    sender.status === 'chatting' && 
                    sender.partner === queuedMsg.recipient) {
                    
                    // Send the message based on type
                    if (queuedMsg.messageData.type === 'text') {
                        await bot.sendMessage(queuedMsg.recipient, {
                            text: `${queuedMsg.messageData.content}\n\n_[This message was delivered after a connection issue]_`
                        });
                    } 
                    else if (queuedMsg.messageData.type === 'image' && queuedMsg.mediaBuffer) {
                        // If we have the media buffer stored
                        await bot.sendMessage(queuedMsg.recipient, {
                            image: queuedMsg.mediaBuffer,
                            caption: `${queuedMsg.messageData.caption || ''}\n\n_[This message was delivered after a connection issue]_`
                        });
                    }
                    else if (queuedMsg.messageData.type === 'video' && queuedMsg.mediaBuffer) {
                        await bot.sendMessage(queuedMsg.recipient, {
                            video: queuedMsg.mediaBuffer,
                            caption: `${queuedMsg.messageData.caption || ''}\n\n_[This message was delivered after a connection issue]_`
                        });
                    }
                    else if (queuedMsg.messageData.type === 'audio' && queuedMsg.mediaBuffer) {
                        await bot.sendMessage(queuedMsg.recipient, {
                            audio: queuedMsg.mediaBuffer,
                            mimetype: 'audio/mp4'
                        });
                    }
                    else if (queuedMsg.messageData.type === 'document' && queuedMsg.mediaBuffer) {
                        await bot.sendMessage(queuedMsg.recipient, {
                            document: queuedMsg.mediaBuffer,
                            mimetype: queuedMsg.messageData.mimetype || 'application/octet-stream',
                            fileName: queuedMsg.messageData.fileName || 'file'
                        });
                    }
                    else {
                        // For other types or if media buffer is not available, send a text notification
                        await bot.sendMessage(queuedMsg.recipient, {
                            text: `${queuedMsg.messageData.content}\n\n_[This message was delivered after a connection issue]_`
                        });
                    }
                    
                    // Notify the sender that their message was delivered
                    await bot.sendMessage(queuedMsg.sender, {
                        text: '✅ Your previously queued message has been delivered to your partner.'
                    });
                    
                    // Mark as delivered
                    deliveredMessageIds.push(queuedMsg._id);
                    console.log(`[AnonymousChat] Delivered queued message to ${queuedMsg.recipient}`);
                } else {
                    // Users are no longer chatting, discard the message
                    deliveredMessageIds.push(queuedMsg._id);
                    console.log(`[AnonymousChat] Discarded queued message as users are no longer chatting`);
                    
                    // Notify the sender that their message couldn't be delivered
                    try {
                        await bot.sendMessage(queuedMsg.sender, {
                            text: '❌ Your previously queued message could not be delivered because you are no longer in a chat with that partner.'
                        });
                    } catch (notifyError) {
                        console.error('[AnonymousChat] Failed to notify sender about discarded message:', notifyError);
                    }
                }
            } catch (error) {
                console.error(`[AnonymousChat] Error delivering queued message:`, error);
            }
        }
        
        // Clear delivered messages from the queue
        if (deliveredMessageIds.length > 0) {
            await database.clearDeliveredMessages(deliveredMessageIds);
            console.log(`[AnonymousChat] Cleared ${deliveredMessageIds.length} messages from queue`);
        }
    } catch (error) {
        console.error('[AnonymousChat] Error processing message queue:', error);
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