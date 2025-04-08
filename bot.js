import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "fs";
import mongodb from "./database.js";
import anonymousChat from './modules/menu.js';

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState("session");
        
        const bot = makeWASocket({
            printQRInTerminal: true,
            auth: state,
            logger: pino({ level: "silent" }).child({ level: "silent" }),
            connectTimeoutMs: 60000, // Increase timeout to 60 seconds
            defaultQueryTimeoutMs: 60000, // Increase query timeout
            keepAliveIntervalMs: 10000, // Keep alive every 10 seconds
        });

        bot.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === "close") {
                const error = lastDisconnect?.error?.output;
                const statusCode = error?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log('\n[Status] Connection closed.');
                
                if (statusCode === DisconnectReason.restartRequired) {
                    console.log('[Info] Restarting connection after QR scan...');
                } else if (statusCode === DisconnectReason.timedOut) {
                    console.log('[Error] Connection timeout. Retrying...');
                } else if (statusCode === 401) {
                    console.log('[Auth] Unauthorized. Clearing session...');
                    try {
                        await fs.promises.rm("session", { recursive: true, force: true });
                        console.log('[Info] Session cleared successfully.');
                    } catch (err) {
                        console.error('[Error] Failed to clear session:', err);
                    }
                } else {
                    console.log('[Info] Disconnected due to:', lastDisconnect?.error?.message);
                }
                
                if (shouldReconnect) {
                    console.log('[Info] Attempting to reconnect...\n');
                    setTimeout(connectToWhatsApp, 3000); // Wait 3 seconds before reconnecting
                } else {
                    console.log('[Info] Connection closed permanently.');
                }
                return;
            }
            
            if (connection === "connecting") {
                console.log('[Status] Connecting to WhatsApp...');
            }
            
            if (connection === "open") {
                console.log('[Success] Connected to WhatsApp!');
                console.log(`[Info] Using number: ${bot.user.id.split(":")[0]}`);
                
                try {
                    await mongodb.connect();
                    console.log('[Success] Connected to MongoDB database.');
                } catch (error) {
                    console.error('[Error] MongoDB connection failed:', error.message);
                }
            }
        });

        // Add message handler to process commands and relay messages
        bot.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg.message) return; // Not a message
            
            // Skip if message is from status broadcast
            if (msg.key.remoteJid === 'status@broadcast') return;
            
            // Get sender ID
            const sender = msg.key.remoteJid;
            
            // Check if this is a command
            const body = msg.message.conversation || 
                        msg.message.extendedTextMessage?.text || 
                        msg.message.imageMessage?.caption || 
                        msg.message.videoMessage?.caption || '';
            
            // Process commands
            if (body.startsWith(config.prefix)) {
                const command = body.slice(config.prefix.length).trim().split(' ')[0];
                
                // Try to process as anonymous chat command
                const handled = await anonymousChat.processCommand(bot, msg, command, sender);
                
                if (handled) return; // Command was handled by anonymous chat module
                
                // Handle other commands here...
            } else {
                // Try to relay message if not a command
                const relayed = await anonymousChat.relayMessage(bot, msg, sender);
                
                if (relayed) return; // Message was relayed to anonymous chat partner
                
                // Handle other non-command messages here...
            }
        });
        // Listen for credentials updates
        bot.ev.on("creds.update", saveCreds);
        
        // Handle errors globally
        bot.ev.on('error', (err) => {
            console.error('[Error] WebSocket Error:', err);
        });

        return bot;
    } catch (err) {
        console.error('[Fatal Error]:', err);
        // Wait 5 seconds before retrying
        setTimeout(connectToWhatsApp, 5000);
    }
}

// Start the bot
connectToWhatsApp();