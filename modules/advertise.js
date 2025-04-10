// modules/advertise.js
import database from '../database.js';

export const ADS_COLLECTION = 'advertisements';

class AdvertiseManager {
    static async getAdvertisement(type) {
        try {
            const now = new Date();
            
            // Gunakan database.find langsung
            const ads = await database.find(ADS_COLLECTION, {
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
            });

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
            await database.updateOne(
                ADS_COLLECTION,
                { _id: selectedAd._id },
                { $inc: { showCount: 1 } }
            );

            return selectedAd;
        } catch (error) {
            console.error('[Advertise] Error getting advertisement:', error);
            return null;
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

            // Gunakan database.insertOne langsung
            await database.insertOne(ADS_COLLECTION, ad);
            console.log('[Advertise] New advertisement added:', title);
            return true;
        } catch (error) {
            console.error('[Advertise] Error adding advertisement:', error);
            return false;
        }
    }

    static async listAdvertisements() {
        try {
            // Gunakan database.find langsung
            const ads = await database.find(ADS_COLLECTION, {});
            return ads;
        } catch (error) {
            console.error('[Advertise] Error listing advertisements:', error);
            return [];
        }
    }

    static async getStats() {
        try {
            const now = new Date();
            const ads = await database.find(ADS_COLLECTION, {});
            
            if (!ads || ads.length === 0) {
                return "No advertisements found.";
            }

            let stats = "📊 *Advertisement Statistics*\n\n";
            
            // Group ads by type
            const adsByType = {};
            ads.forEach(ad => {
                if (!adsByType[ad.type]) {
                    adsByType[ad.type] = [];
                }
                adsByType[ad.type].push(ad);
            });

            // Generate statistics for each type
            for (const [type, typeAds] of Object.entries(adsByType)) {
                stats += `*${type.toUpperCase()}*\n`;
                stats += `Total Ads: ${typeAds.length}\n`;
                
                const activeAds = typeAds.filter(ad => {
                    if (!ad.startDate || !ad.endDate) return ad.active;
                    return ad.active && new Date(ad.endDate) >= now;
                });
                
                stats += `Active Ads: ${activeAds.length}\n`;
                
                // Calculate total impressions
                const totalImpressions = typeAds.reduce((sum, ad) => sum + (ad.showCount || 0), 0);
                stats += `Total Impressions: ${totalImpressions}\n\n`;

                // Show top 3 most shown ads
                const topAds = typeAds
                    .sort((a, b) => (b.showCount || 0) - (a.showCount || 0))
                    .slice(0, 3);

                if (topAds.length > 0) {
                    stats += "Top Performing Ads:\n";
                    topAds.forEach((ad, index) => {
                        stats += `${index + 1}. "${ad.title}" - ${ad.showCount || 0} shows\n`;
                    });
                }
                stats += "\n";
            }

            return stats;
        } catch (error) {
            console.error('[Advertise] Error getting statistics:', error);
            return "Error retrieving advertisement statistics.";
        }
    }
}

export default AdvertiseManager;