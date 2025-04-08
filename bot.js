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
            browser: ["MauWhats Bot", "Chrome", "1.0.0"],
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
                    
                    // Initialize anonymous chat collections
                    await anonymousChat.initializeCollections();
                } catch (error) {
                    console.error('[Warning] MongoDB connection failed:', error.message);
                    console.error('[Error Details]:', error);
                }
            }
        });

        // Listen for credentials updates
        bot.ev.on("creds.update", saveCreds);
        
        // Handle incoming messages
        bot.ev.on('messages.upsert', async ({ messages }) => {
            if (!messages || !messages[0]) return;
            
            const msg = messages[0];
            if (!msg.message) return; // Not a message
            
            // Skip if message is from status broadcast
            if (msg.key.remoteJid === 'status@broadcast') return;
            
            // Skip if message is from me
            if (msg.key.fromMe) return;
            
            // Get sender ID
            const sender = msg.key.remoteJid;
            
            // Extract message body
            const body = msg.message.conversation || 
                        msg.message.extendedTextMessage?.text || 
                        msg.message.imageMessage?.caption || 
                        msg.message.videoMessage?.caption || '';
            
            console.log(`[Message] From ${sender}: ${body.substring(0, 50)}${body.length > 50 ? '...' : ''}`);
            
            // Process commands
            if (body.startsWith(config.prefix)) {
                const command = body.slice(config.prefix.length).trim().split(' ')[0];
                
                console.log(`[Command] ${command} from ${sender}`);
                
                // Handle menu command
                if (command.toLowerCase() === 'menu' || command.toLowerCase() === 'help') {
                    try {
                        console.log(`[Bot] Sending menu to ${sender}`);
                        await advertise.sendAnonymousChatAd(bot, sender);
                        return;
                    } catch (error) {
                        console.error('[Error] Failed to send menu:', error);
                    }
                }
                
                // Try to process as anonymous chat command
                try {
                    const handled = await anonymousChat.processCommand(bot, msg, command, sender);
                    if (handled) return; // Command was handled by anonymous chat module
                } catch (error) {
                    console.error('[Error] Failed to process command:', error);
                }
            } else {
                // Try to relay message if not a command
                try {
                    const relayed = await anonymousChat.relayMessage(bot, msg, sender);
                    if (relayed) return; // Message was relayed to anonymous chat partner
                } catch (error) {
                    console.error('[Error] Failed to relay message:', error);
                }
            }
        });
        
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