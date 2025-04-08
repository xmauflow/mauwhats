/**
 * WhatsApp Bot Configuration
 * 
 * File ini berisi konfigurasi untuk bot WhatsApp
 * Mengambil konfigurasi dari file .env
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Inisialisasi dotenv
dotenv.config();

// Helper function untuk mengkonversi string ke boolean
const parseBoolean = (value) => {
    return value?.toLowerCase() === 'true';
};

// Helper function untuk mengkonversi string ke number
const parseNumber = (value, defaultValue) => {
    const parsed = parseInt(value);
    return isNaN(parsed) ? defaultValue : parsed;
};

const config = {
    // Konfigurasi Bot
    bot: {
        name: process.env.BOT_NAME || "MauWhats Bot",
        owner: process.env.BOT_OWNER || "6281234567890",
        bot_number: process.env.BOT_NUMBER || "6281234567890",
        prefix: process.env.BOT_PREFIX || ".",
        sessionPath: process.env.SESSION_PATH || "./session",
    },
    
    // Konfigurasi Koneksi
    connection: {
        usePairingCode: parseBoolean(process.env.USE_PAIRING_CODE) ?? true,
        logLevel: process.env.LOG_LEVEL || "silent",
        printQRInTerminal: parseBoolean(process.env.PRINT_QR_TERMINAL) ?? false,
        reconnectInterval: parseNumber(process.env.RECONNECT_INTERVAL, 5000),
    },
    
    // Konfigurasi Database
    db: {
        url: process.env.MONGODB_URI,
        name: process.env.DB_NAME,
    },
    
    // Konfigurasi Pesan
    message: {
        welcomeMessage: process.env.WELCOME_MESSAGE || "Halo! Saya adalah MauWhats Bot. Ketik !help untuk melihat daftar perintah.",
        errorMessage: process.env.ERROR_MESSAGE || "Maaf, terjadi kesalahan saat memproses perintah Anda.",
        notFoundMessage: process.env.NOT_FOUND_MESSAGE || "Perintah tidak ditemukan. Ketik !help untuk melihat daftar perintah.",
    },
    
    // Konfigurasi Fitur
    features: {
        autoRead: parseBoolean(process.env.AUTO_READ) ?? true,
        autoTyping: parseBoolean(process.env.AUTO_TYPING) ?? true,
        autoRecording: parseBoolean(process.env.AUTO_RECORDING) ?? false,
    }
};

export default config;