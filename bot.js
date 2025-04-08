import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "fs";
import mongodb from "./database.js";

(async function start() {
    const session = await useMultiFileAuthState("session");
    const bot = makeWASocket({
        printQRInTerminal: true,  // Always print QR in terminal
        auth: session.state,
        logger: pino({ level: "silent" }).child({ level: "silent" })
    });
    
    bot.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === "close") {
            const shouldReconnect = 
                (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            
            // If error is "restartRequired", this is part of normal auth flow
            if ((lastDisconnect.error)?.output?.statusCode === DisconnectReason.restartRequired) {
                console.log('Reconnecting after QR scan...');
            } else {
                console.log('Connection closed due to ', lastDisconnect.error);
                
                // Handle unauthorized error by deleting session
                if ((lastDisconnect.error)?.output?.statusCode === 401 && 
                    (lastDisconnect.error)?.output?.payload?.error === "Unauthorized") {
                    await fs.promises.rm("session", {
                        recursive: true,
                        force: true
                    });
                }
            }
            
            if (shouldReconnect) {
                start();
            }
            return;
        }
        
        if (connection === "open") {
            try {
                await mongodb.connect();
            } catch (error) {
                console.error('Error connecting to MongoDB:', error);
            }
            console.log(
                "Berhasil terhubung dengan: " + bot.user.id.split(":")[0]
            );
        }
    });
    
    bot.ev.on("creds.update", session.saveCreds);
})();