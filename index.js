// index.js
import { startBot } from './bot.js';
import database from './database.js';

async function initialize() {
    console.log('[Starting] WhatsApp Anonymous Chat Bot is initializing...');
    
    try {
        // Connect to database first
        await database.connect();
        console.log('[Database] Successfully connected to MongoDB');
        
        // Initialize collections through database class
        await database.initializeCollections();
        console.log('[Collections] Successfully initialized all collections');
        
        // Start the bot
        await startBot();
        console.log('[Bot] Successfully started WhatsApp connection');
    } catch (error) {
        console.error('[Fatal Error] Failed to initialize:', error);
        process.exit(1);
    }
}

// Handle process termination
process.on('SIGINT', async () => {
    console.log('\n[Shutdown] Gracefully shutting down...');
    try {
        await database.close();
        console.log('[Shutdown] Database connection closed');
        process.exit(0);
    } catch (error) {
        console.error('[Shutdown] Error during shutdown:', error);
        process.exit(1);
    }
});

// Start the application
initialize();