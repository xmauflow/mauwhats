import database from '../database.js';

const ADS_COLLECTION = 'advertisements';

/**
 * Advertisement Manager Class
 */
class AdvertiseManager {
    /**
     * Initialize advertisement collection
     */
    static async initializeCollection() {
        try {
            await database.collection(ADS_COLLECTION);
            console.log('[Advertise] Collection initialized');
        } catch (error) {
            console.error('[Advertise] Error initializing collection:', error);
        }
    }

    /**
     * Add new advertisement
     * @param {Object} adData - Advertisement data
     * @param {String} adData.title - Title of the advertisement
     * @param {String} adData.content - Content of the advertisement
     * @param {String} adData.type - Type of advertisement (start, search, chat, end)
     * @param {Boolean} adData.active - Whether the advertisement is active
     * @param {Date} adData.startDate - Start date for the advertisement
     * @param {Date} adData.endDate - End date for the advertisement
     * @param {Number} adData.priority - Priority level (1-10, higher means more frequent)
     */
    static async addAdvertisement(adData) {
        try {
            const newAd = {
                ...adData,
                createdAt: new Date(),
                updatedAt: new Date(),
                showCount: 0
            };

            await database.insertOne(ADS_COLLECTION, newAd);
            console.log('[Advertise] New advertisement added:', newAd.title);
            return true;
        } catch (error) {
            console.error('[Advertise] Error adding advertisement:', error);
            return false;
        }
    }

    /**
     * Update existing advertisement
     * @param {String} adId - Advertisement ID
     * @param {Object} updateData - Data to update
     */
    static async updateAdvertisement(adId, updateData) {
        try {
            const update = {
                ...updateData,
                updatedAt: new Date()
            };

            await database.updateOne(ADS_COLLECTION, 
                { _id: adId },
                { $set: update }
            );
            console.log('[Advertise] Advertisement updated:', adId);
            return true;
        } catch (error) {
            console.error('[Advertise] Error updating advertisement:', error);
            return false;
        }
    }

    /**
     * Delete advertisement
     * @param {String} adId - Advertisement ID
     */
    static async deleteAdvertisement(adId) {
        try {
            await database.deleteOne(ADS_COLLECTION, { _id: adId });
            console.log('[Advertise] Advertisement deleted:', adId);
            return true;
        } catch (error) {
            console.error('[Advertise] Error deleting advertisement:', error);
            return false;
        }
    }

    /**
     * Get advertisement for specific event
     * @param {String} type - Type of event (start, search, chat, end)
     * @returns {Object|null} Advertisement object or null if none found
     */
    static async getAdvertisement(type) {
        try {
            const now = new Date();
            
            // Find active ads for this type that are within their date range
            const ads = await database.find(ADS_COLLECTION, {
                type: type,
                active: true,
                startDate: { $lte: now },
                endDate: { $gte: now }
            }).toArray();

            if (!ads || ads.length === 0) {
                return null;
            }

            // Sort by priority and show count (favor high priority and less shown ads)
            ads.sort((a, b) => {
                const scoreA = (a.priority * 1000) - a.showCount;
                const scoreB = (b.priority * 1000) - b.showCount;
                return scoreB - scoreA;
            });

            // Get the top ad
            const selectedAd = ads[0];

            // Update show count
            await database.updateOne(ADS_COLLECTION,
                { _id: selectedAd._id },
                { $inc: { showCount: 1 } }
            );

            return selectedAd;
        } catch (error) {
            console.error('[Advertise] Error getting advertisement:', error);
            return null;
        }
    }

    /**
     * Get advertisement stats
     * @returns {Object} Statistics about advertisements
     */
    static async getStats() {
        try {
            const now = new Date();
            const stats = {
                total: await database.count(ADS_COLLECTION, {}),
                active: await database.count(ADS_COLLECTION, {
                    active: true,
                    startDate: { $lte: now },
                    endDate: { $gte: now }
                }),
                byType: {},
                totalShows: 0
            };

            // Get counts by type
            const types = ['start', 'search', 'chat', 'end'];
            for (const type of types) {
                stats.byType[type] = await database.count(ADS_COLLECTION, { type });
            }

            // Get total shows
            const allAds = await database.find(ADS_COLLECTION, {}).toArray();
            stats.totalShows = allAds.reduce((sum, ad) => sum + (ad.showCount || 0), 0);

            return stats;
        } catch (error) {
            console.error('[Advertise] Error getting stats:', error);
            return null;
        }
    }

    /**
     * Format advertisement message
     * @param {Object} ad - Advertisement object
     * @returns {String} Formatted message
     */
    static formatAdMessage(ad) {
        if (!ad) return null;

        return `📢 *${ad.title}*\n\n${ad.content}\n\n` +
               `_This is a promotional message from the bot administrator._`;
    }

    /**
     * Send advertisement to user
     * @param {Object} bot - WhatsApp bot instance
     * @param {String} userId - User ID to send advertisement to
     * @param {String} type - Type of advertisement to send
     */
    static async sendAdvertisement(bot, userId, type) {
        try {
            const ad = await this.getAdvertisement(type);
            if (!ad) return;

            const message = this.formatAdMessage(ad);
            if (!message) return;

            await bot.sendMessage(userId, { text: message });
            console.log(`[Advertise] Sent ${type} advertisement to ${userId}`);
        } catch (error) {
            console.error('[Advertise] Error sending advertisement:', error);
        }
    }

    /**
     * List all advertisements
     * @param {Object} filter - Filter criteria
     * @returns {Array} List of advertisements
     */
    static async listAdvertisements(filter = {}) {
        try {
            return await database.find(ADS_COLLECTION, filter).toArray();
        } catch (error) {
            console.error('[Advertise] Error listing advertisements:', error);
            return [];
        }
    }
}

export default AdvertiseManager;