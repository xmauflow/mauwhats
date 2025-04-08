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
            syncFullHistory: true
        });

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

        // Connection handling
        bot.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            
            // ... existing code ...
            
            if (connection === "open") {
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

        bot.ev.on('messaging-history.set', async ({ chats, contacts, messages, isLatest }) => {
            console.log(`[History Sync] Received ${messages.length} messages, ${chats.length} chats`);
            
            try {
                // Process only if we have messages
                if (messages && messages.length > 0) {
                    // Sort messages by timestamp to process them in order
                    const sortedMessages = [...messages].sort((a, b) => a.messageTimestamp - b.messageTimestamp);
                    
                    // Process each message
                    for (const msg of sortedMessages) {
                        // Skip messages from status broadcast
                        if (msg.key.remoteJid === 'status@broadcast') continue;
                        
                        // Skip messages sent by the bot itself
                        if (msg.key.fromMe) continue;
                        
                        // Skip old messages (more than 1 hour old)
                        const msgTime = new Date(msg.messageTimestamp * 1000);
                        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                        if (msgTime < oneHourAgo) continue;
                        
                        const from = msg.key.remoteJid;
                        
                        // Extract message body
                        const body = (msg.message?.conversation) ? msg.message.conversation :
                                   (msg.message?.extendedTextMessage?.text) ? msg.message.extendedTextMessage.text :
                                   (msg.message?.imageMessage?.caption) ? msg.message.imageMessage.caption : '';
                        
                        console.log(`[History] Processing message from ${from}: ${body}`);
                        
                        // Skip commands for history processing
                        if (body && (body.startsWith('.') || body.startsWith('/'))) {
                            continue;
                        }
                        
                        // Try to relay non-command messages
                        if (msg.message) {
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
                    
                    console.log('[History Sync] Finished processing history messages');
                }
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

// Start the bot
connectToWhatsApp();