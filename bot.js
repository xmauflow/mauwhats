// bot.js
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import database from "./database.js";
import anonymousChat from "./modules/menu.js";
import AdvertiseManager from "./modules/advertise.js";

const RECONNECT_INTERVAL = 5000;
const KEEP_ALIVE_INTERVAL = 10000;
const CONNECT_TIMEOUT = 60000;
const MESSAGE_HISTORY_HOURS = 6;

export async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState("session");
        
        const bot = makeWASocket({
            printQRInTerminal: true,
            auth: state,
            logger: pino({ level: "silent" }),
            syncFullHistory: true,
            retryRequestDelayMs: 1000,
            shouldSyncHistoryMessage: () => true,
            keepAliveIntervalMs: KEEP_ALIVE_INTERVAL,
            connectTimeoutMs: CONNECT_TIMEOUT,
            downloadHistory: true
        });

        setupMessageHandler(bot);
        setupConnectionHandler(bot);
        setupHistoryHandler(bot);
        
        // Save credentials when updated
        bot.ev.on("creds.update", saveCreds);
        
        // Handle errors
        bot.ev.on('error', (err) => {
            console.error('[Error] WebSocket Error:', err);
        });

        return bot;
    } catch (err) {
        console.error('[Fatal Error]:', err);
        setTimeout(startBot, RECONNECT_INTERVAL);
    }
}

function setupMessageHandler(bot) {
    bot.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg?.message || msg.key.remoteJid === 'status@broadcast') return;

        const from = msg.key.remoteJid;
        const body = extractMessageBody(msg);

        console.log(`[Message] From ${from}: ${body}`);

        if (body) {
            await handleCommand(bot, msg, body, from);
            await handleChatMessage(bot, msg, body, from);
        }
    });
}

function setupConnectionHandler(bot) {
    bot.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === "close") {
            handleDisconnection(lastDisconnect);
        } else if (connection === "open") {
            await handleSuccessfulConnection(bot);
        }
    });
}

function setupHistoryHandler(bot) {
    let lastProcessedTimestamp = 0;
    
    bot.ev.on('messaging-history.set', async ({ messages }) => {
        if (!messages?.length) return;
        
        console.log(`[History] Processing ${messages.length} messages`);
        await processHistoryMessages(bot, messages, lastProcessedTimestamp);
    });
}

async function handleCommand(bot, msg, body, from) {
    const isCommand = body.startsWith('.') || body.startsWith('/');
    if (!isCommand) return;

    const command = body.slice(1).trim().split(' ')[0].toLowerCase();
    console.log(`[Command] Processing: ${command}`);

    try {
        if (command === 'menu' || command === 'help') {
            await sendMenuMessage(bot, from);
            return;
        }

        if (['search', 'next', 'stop', 'sendpp', 'addad', 'listads', 'delad', 'adstats'].includes(command)) {
            const modifiedMsg = createModifiedMessage(msg, body);
            const handled = await anonymousChat.processCommand(bot, modifiedMsg, from);
            if (handled) {
                console.log(`[Command] Successfully handled: ${command}`);
            }
        }
    } catch (error) {
        console.error('[Error] Command processing failed:', error);
        await bot.sendMessage(from, { 
            text: '❌ An error occurred while processing your command. Please try again.' 
        });
    }
}

async function handleChatMessage(bot, msg, body, from) {
    if (!body.startsWith('.') && !body.startsWith('/')) {
        try {
            const relayed = await anonymousChat.relayMessage(bot, msg, from);
            if (relayed) {
                console.log('[Chat] Message relayed successfully');
            }
        } catch (error) {
            console.error('[Error] Message relay failed:', error);
        }
    }
}

async function sendMenuMessage(bot, from) {
    const menuMessage = `*Anonymous Chat Bot*\n\n` +
        `Chat with random people anonymously!\n\n` +
        `*Available Commands:*\n` +
        `*.search* - Find a chat partner\n` +
        `*.next* - Find a new partner\n` +
        `*.stop* - End the chat\n` +
        `*.sendpp* - Share your profile picture\n\n` +
        `Start chatting now! Type *.search* to begin.`;

    await bot.sendMessage(from, { text: menuMessage });
    console.log('[Menu] Sent successfully');
}

function extractMessageBody(msg) {
    const messageTypes = msg.message;
    if (!messageTypes) return '';

    // Text messages
    if (messageTypes.conversation) return messageTypes.conversation;
    if (messageTypes.extendedTextMessage?.text) return messageTypes.extendedTextMessage.text;
    
    // Media messages with captions
    if (messageTypes.imageMessage?.caption) return messageTypes.imageMessage.caption;
    if (messageTypes.videoMessage?.caption) return messageTypes.videoMessage.caption;
    if (messageTypes.documentMessage?.caption) return messageTypes.documentMessage.caption;
    
    // View Once messages
    if (messageTypes.viewOnceMessage) {
        const viewOnceContent = messageTypes.viewOnceMessage.message;
        if (viewOnceContent?.imageMessage?.caption) return viewOnceContent.imageMessage.caption;
        if (viewOnceContent?.videoMessage?.caption) return viewOnceContent.videoMessage.caption;
        if (viewOnceContent?.imageMessage) return 'View Once Image';
        if (viewOnceContent?.videoMessage) return 'View Once Video';
        return 'View Once Message';
    }
    
    if (messageTypes.viewOnceMessageV2) {
        const viewOnceContent = messageTypes.viewOnceMessageV2.message;
        if (viewOnceContent?.imageMessage?.caption) return viewOnceContent.imageMessage.caption;
        if (viewOnceContent?.videoMessage?.caption) return viewOnceContent.videoMessage.caption;
        if (viewOnceContent?.imageMessage) return 'View Once Image V2';
        if (viewOnceContent?.videoMessage) return 'View Once Video V2';
        return 'View Once Message V2';
    }
    
    // Sticker messages
    if (messageTypes.stickerMessage) return 'Sticker';
    
    // Other media types
    if (messageTypes.audioMessage) return 'Audio';
    if (messageTypes.videoMessage) return 'Video';
    if (messageTypes.imageMessage) return 'Image';
    if (messageTypes.documentMessage) return 'Document';
    
    return '';
}

function createModifiedMessage(msg, body) {
    return {
        ...msg,
        body: body,
        key: { ...msg.key }
    };
}

function handleDisconnection(lastDisconnect) {
    const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
    console.log(`[Connection] Closed due to ${lastDisconnect?.error?.message || 'unknown reason'}`);
    
    if (shouldReconnect) {
        console.log('[Connection] Attempting to reconnect...');
        setTimeout(startBot, RECONNECT_INTERVAL);
    }
}

async function handleSuccessfulConnection(bot) {
    console.log('[Connection] Successfully connected to WhatsApp');
    console.log(`[Bot] Using number: ${bot.user.id.split(":")[0]}`);
    
    try {
        // Initialize collections and process pending messages
        await anonymousChat.processMessageQueue(bot);
        console.log('[Queue] Message queue processed');
    } catch (error) {
        console.error('[Error] Failed to process message queue:', error);
    }
}

async function processHistoryMessages(bot, messages, lastProcessedTimestamp) {
    try {
        const sortedMessages = messages.sort((a, b) => a.messageTimestamp - b.messageTimestamp);
        const sixHoursAgo = new Date(Date.now() - MESSAGE_HISTORY_HOURS * 60 * 60 * 1000);
        
        for (const msg of sortedMessages) {
            if (shouldSkipHistoryMessage(msg, lastProcessedTimestamp, sixHoursAgo)) continue;
            
            await processHistoryMessage(bot, msg);
            lastProcessedTimestamp = Math.max(lastProcessedTimestamp, msg.messageTimestamp);
        }
        
        console.log('[History] Finished processing messages');
    } catch (error) {
        console.error('[History] Error processing:', error);
    }
}

function shouldSkipHistoryMessage(msg, lastProcessedTimestamp, sixHoursAgo) {
    if (msg.messageTimestamp <= lastProcessedTimestamp) return true;
    if (msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return true;
    
    const msgTime = new Date(msg.messageTimestamp * 1000);
    return msgTime < sixHoursAgo;
}

async function processHistoryMessage(bot, msg) {
    const from = msg.key.remoteJid;
    console.log(`[History] Processing message from ${from}`);
    
    if (msg.message) {
        const body = extractMessageBody(msg);
        
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
}