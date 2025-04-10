// modules/advertise.js
import database from '../database.js';

export const ADS_COLLECTION = 'advertisements';

class AdvertiseManager {
    static async getAdvertisement(type) {
        try {
            const collection = database.db.collection(ADS_COLLECTION);
            const now = new Date();

            // Dapatkan semua iklan yang sesuai dengan kriteria
            const ads = await collection.find({
                type: type,
                active: true,
                $or: [
                    {
                        startDate: { $exists: false },
                        endDate: { $exists: false }
                    },
                    {
                        $and: [
                            { startDate: { $lte: now } },
                            { endDate: { $gte: now } }
                        ]
                    }
                ]
            }).toArray();

            if (!ads || ads.length === 0) {
                console.log(`[Advertise] No active advertisements found for type: ${type}`);
                return null;
            }

            // Urutkan berdasarkan prioritas dan jumlah tampil
            ads.sort((a, b) => {
                if (a.priority !== b.priority) {
                    return b.priority - a.priority;
                }
                return (a.showCount || 0) - (b.showCount || 0);
            });

            // Pilih iklan pertama
            const selectedAd = ads[0];

            // Update jumlah tampil
            await collection.updateOne(
                { _id: selectedAd._id },
                { $inc: { showCount: 1 } }
            );

            return selectedAd;
        } catch (error) {
            console.error('[Advertise] Error getting advertisement:', error);
            throw error;
        }
    }

    static async sendAdvertisement(bot, recipient, type) {
        try {
            const ad = await this.getAdvertisement(type);
            if (!ad) {
                console.log(`[Advertise] No advertisement available for type: ${type}`);
                return false;
            }

            const message = this.formatAdMessage(ad);
            await bot.sendMessage(recipient, { text: message });
            return true;
        } catch (error) {
            console.error('[Advertise] Error sending advertisement:', error);
            return false;
        }
    }

    static formatAdMessage(ad) {
        return `*${ad.title || 'Advertisement'}*\n\n${ad.content}\n\n_This is a promotional message from the bot administrator._`;
    }

    static async addAdvertisement(type, title, content, priority = 1, duration = 30) {
        try {
            const collection = database.db.collection(ADS_COLLECTION);
            const now = new Date();
            const endDate = new Date();
            endDate.setDate(now.getDate() + duration);

            const ad = {
                type,
                title,
                content,
                priority: parseInt(priority),
                active: true,
                showCount: 0,
                startDate: now,
                endDate: endDate,
                createdAt: now
            };

            await collection.insertOne(ad);
            console.log('[Advertise] New advertisement added:', title);
            return true;
        } catch (error) {
            console.error('[Advertise] Error adding advertisement:', error);
            return false;
        }
    }
}

export default AdvertiseManager;