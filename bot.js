// bot.js
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "fs";
import mongodb from "./database.js";
import config from "./config.js";
import anonymousChat from "./modules/menu.js";
import advertise from "./modules/advertise.js";


async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState("session");
        
        const bot = makeWASocket({
            printQRInTerminal: true,
            auth: state,
            logger: pino({ level: "silent" }),
            // Enable full history sync
            syncFullHistory: true,
            // Increase message retry count
            retryRequestDelayMs: 1000,
            // Get all messages since last disconnect
            shouldSyncHistoryMessage: () => true,
            // Keep connection alive
            keepAliveIntervalMs: 10000,
            // Automatically reconnect
            connectTimeoutMs: 60000,
            // Download history messages
            downloadHistory: true
        });

        let lastProcessedTimestamp = 0;
        // Handle incoming messages
        bot.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            const msg = messages[0];
            if (!msg || !msg.message) return;

            // Skip messages from status broadcast
            if (msg.key.remoteJid === 'status@broadcast') return;

            // Get basic message info
            const from = msg.key.remoteJid;
            const body = (msg.message.conversation) ? msg.message.conversation :
                        (msg.message.extendedTextMessage?.text) ? msg.message.extendedTextMessage.text :
                        (msg.message.imageMessage?.caption) ? msg.message.imageMessage.caption : '';

            // Log the received message
            console.log(`[Message] From ${from}: ${body}`);

            // Handle commands
            if (body) {
                // Check for both . and / prefix
                const isCommand = body.startsWith('.') || body.startsWith('/');
                if (isCommand) {
                    const command = body.slice(1).trim().split(' ')[0].toLowerCase();
                    console.log(`[Command] Processing command: ${command}`);

                    try {
                        // Handle menu command
                        if (command === 'menu' || command === 'help') {
                            console.log('[Debug] Sending menu...');
                            const menuMessage = `*🔒 Anonymous Chat Bot 🔒*\n\n` +
                                             `Chat with random people without revealing your identity!\n\n` +
                                             `*Available Commands:*\n` +
                                             `*.search* - Find a chat partner\n` +
                                             `*.next* - Skip current partner & find a new one\n` +
                                             `*.stop* - End the anonymous chat\n` +
                                             `*.sendpp* - Share your profile picture\n\n` +
                                             `Start chatting anonymously now! Type *.search* to begin.`;

                            await bot.sendMessage(from, { 
                                text: menuMessage 
                            });
                            console.log('[Debug] Menu sent successfully');
                            return;
                        }

                        // Handle anonymous chat commands
                        if (['search', 'next', 'stop', 'sendpp'].includes(command)) {
                            console.log(`[Debug] Processing anonymous chat command: ${command}`);
                            const handled = await anonymousChat.processCommand(bot, msg, command, from);
                            if (handled) {
                                console.log(`[Debug] Command ${command} handled successfully`);
                                return;
                            }
                        }
                    } catch (error) {
                        console.error('[Error] Failed to process command:', error);
                        await bot.sendMessage(from, { 
                            text: '❌ Sorry, there was an error processing your command. Please try again.' 
                        });
                    }
                }
            }

            if (!body.startsWith('.') && !body.startsWith('/')) {
                try {
                    const relayed = await anonymousChat.relayMessage(bot, msg, from);
                    if (relayed) {
                        console.log('[Debug] Message relayed successfully');
                    }
                } catch (error) {
                    console.error('[Error] Failed to relay message:', error);
                }
            }
        });

        // Handle connection updates
        bot.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === "close") {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(`[Connection] Closed due to ${lastDisconnect?.error?.message || 'unknown reason'}`);
                
                if (shouldReconnect) {
                    console.log('[Connection] Reconnecting...');
                    setTimeout(connectToWhatsApp, 5000);
                }
            } else if (connection === "open") {
                console.log('[Success] Connected to WhatsApp!');
                console.log(`[Info] Using number: ${bot.user.id.split(":")[0]}`);
                
                try {
                    await mongodb.connect();
                    console.log('[Success] Connected to MongoDB database.');
                    await anonymousChat.initializeCollections();
                    
                    // Process any pending messages in the queue
                    await anonymousChat.processMessageQueue(bot);
                } catch (error) {
                    console.error('[Warning] MongoDB connection failed:', error.message);
                }
            }
        });

        bot.ev.on('messaging-history.set', async ({ messages }) => {
            console.log(`[History Sync] Processing ${messages?.length || 0} messages`);
            
            if (!messages || messages.length === 0) return;

            try {
                // Sort messages by timestamp
                const sortedMessages = messages.sort((a, b) => a.messageTimestamp - b.messageTimestamp);
                
                for (const msg of sortedMessages) {
                    // Skip if message is older than last processed
                    if (msg.messageTimestamp <= lastProcessedTimestamp) continue;
                    
                    // Skip status messages and messages from self
                    if (msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) continue;
                    
                    const from = msg.key.remoteJid;
                    
                    // Process message if it's not too old (within last 6 hours)
                    const msgTime = new Date(msg.messageTimestamp * 1000);
                    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
                    
                    if (msgTime >= sixHoursAgo) {
                        console.log(`[History] Processing message from ${from} at ${msgTime}`);
                        
                        // Handle non-command messages
                        if (msg.message) {
                            const body = (msg.message.conversation) ? msg.message.conversation :
                                       (msg.message.extendedTextMessage?.text) ? msg.message.extendedTextMessage.text :
                                       (msg.message.imageMessage?.caption) ? msg.message.imageMessage.caption : '';
                            
                            // Skip command messages in history
                            if (!body.startsWith('.') && !body.startsWith('/')) {
                                try {
                                    const relayed = await anonymousChat.relayMessage(bot, msg, from);
                                    if (relayed) {
                                        console.log(`[History] Successfully relayed message from ${from}`);
                                    }
                                } catch (error) {
                                    console.error('[History] Failed to relay message:', error);
                                }
                            }
                        }
                        
                        // Update last processed timestamp
                        lastProcessedTimestamp = Math.max(lastProcessedTimestamp, msg.messageTimestamp);
                    }
                }
                
                console.log('[History Sync] Finished processing history messages');
            } catch (error) {
                console.error('[History Sync] Error processing history:', error);
            }
        });

        // Save credentials when updated
        bot.ev.on("creds.update", saveCreds);

        // Handle errors
        bot.ev.on('error', (err) => {
            console.error('[Error] WebSocket Error:', err);
        });

        return bot;
    } catch (err) {
        console.error('[Fatal Error]:', err);
        setTimeout(connectToWhatsApp, 5000);
    }
}

async function requestMessageHistory(bot) {
    try {
        // Request history for all chats
        const chats = await bot.store.chats.all();
        for (const chat of chats) {
            try {
                await bot.requestMessageHistory(chat.id, 100); // Request last 100 messages
            } catch (error) {
                console.error(`[History] Failed to request history for ${chat.id}:`, error);
            }
        }
    } catch (error) {
        console.error('[History] Failed to request message history:', error);
    }
}

// Start the bot
connectToWhatsApp();