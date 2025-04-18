import { MongoClient } from 'mongodb';
import config from './config.js';

class Database {
    constructor() {
        this.client = null;
        this.db = null;
    }

    async connect(url = config.db.url, dbName = config.db.name) {
        try {
            // Check if MongoDB URI is configured
            if (!url) {
                throw new Error('MongoDB URI is not configured. Please set MONGODB_URI in your .env file');
            }
            
            // Check if database name is configured
            if (!dbName) {
                throw new Error('MongoDB database name is not configured. Please set DB_NAME in your .env file');
            }

            this.client = new MongoClient(url);
            await this.client.connect();
            this.db = this.client.db(dbName);
            console.log('Connected to MongoDB successfully');
        } catch (error) {
            console.error('MongoDB connection error:', error);
            throw error;
        }
    }

    async initializeCollections() {
        try {
            // Create basic collections
            await this.createCollection('anonymous_chat');
            await this.createCollection('message_queue');
            await this.createCollection('advertisements');
            
            // Create indexes for better performance
            await this.db.collection('anonymous_chat').createIndex({ status: 1 });
            await this.db.collection('anonymous_chat').createIndex({ lastSearchTime: 1 });
            await this.db.collection('message_queue').createIndex({ timestamp: 1 });
            await this.db.collection('advertisements').createIndex({ type: 1 });
            
            console.log('[Database] Collections initialized successfully');
        } catch (error) {
            console.error('[Database] Error initializing collections:', error);
            throw error;
        }
    }

    async createCollection(name) {
        try {
            const collections = await this.db.listCollections().toArray();
            if (!collections.some(col => col.name === name)) {
                await this.db.createCollection(name);
                console.log(`[Database] Collection '${name}' created`);
            }
        } catch (error) {
            console.error(`[Database] Error creating collection '${name}':`, error);
            throw error;
        }
    }

    collection(name) {
        if (!this.db) {
            throw new Error('Database not connected');
        }
        return this.db.collection(name);
    }

    // Add this to your Database class methods

    /**
     * Add a message to the queue for delivery when bot is back online
     * @param {Object} message - Message object to be delivered
     */
    async addToMessageQueue(message) {
        try {
            return await this.collection('message_queue').insertOne(message);
        } catch (error) {
            console.error('Error adding message to queue:', error);
            throw error;
        }
    }

    /**
     * Get all pending messages from the queue
     */
    async getPendingMessages() {
        try {
            return await this.collection('message_queue').find({
                $or: [
                    { status: 'pending' },
                    { status: 'failed', retries: { $lt: 3 } }
                ]
            }).toArray();
        } catch (error) {
            console.error('Error getting pending messages:', error);
            return [];
        }
    }

    /**
     * Remove a message from the queue after delivery
     * @param {String} messageId - ID of the message to remove
     */
    async removeFromMessageQueue(messageId) {
        try {
            return await this.collection('message_queue').deleteOne({ _id: messageId });
        } catch (error) {
            console.error('Error removing message from queue:', error);
            throw error;
        }
    }

    /**
     * Clear all delivered messages from the queue
     * @param {Array} messageIds - Array of message IDs to remove
     */
    async clearDeliveredMessages(messageIds) {
        try {
            return await this.collection('message_queue').deleteMany({ 
                _id: { $in: messageIds } 
            });
        } catch (error) {
            console.error('Error clearing delivered messages:', error);
            throw error;
        }
    }

    /**
     * Record a message that was sent while the bot was offline
     * @param {Object} message - Message object that was sent offline
     */
    async recordOfflineMessage(message) {
        try {
            return await this.collection('offline_messages').insertOne(message);
        } catch (error) {
            console.error('Error recording offline message:', error);
            throw error;
        }
    }

    /**
     * Get all offline messages that haven't been processed yet
     */
    async getUnprocessedOfflineMessages() {
        try {
            return await this.collection('offline_messages').find({ processed: false }).toArray();
        } catch (error) {
            console.error('Error getting unprocessed offline messages:', error);
            throw error;
        }
    }

    /**
     * Mark offline messages as processed
     * @param {Array} messageIds - Array of message IDs to mark as processed
     */
    async markOfflineMessagesAsProcessed(messageIds) {
        try {
            return await this.collection('offline_messages').updateMany(
                { _id: { $in: messageIds } },
                { $set: { processed: true } }
            );
        } catch (error) {
            console.error('Error marking offline messages as processed:', error);
            throw error;
        }
    }

    async findOne(collectionName, query = {}) {
        try {
            return await this.db.collection(collectionName).findOne(query);
        } catch (error) {
            console.error('[Database] FindOne error:', error);
            return null;
        }
    }

    async find(collectionName, query, options = {}) {
        try {
            return await this.collection(collectionName).find(query, options).toArray();
        } catch (error) {
            console.error(`Error in find (${collectionName}):`, error);
            return [];
        }
    }

    /**
     * Insert a document into a collection
     * @param {String} collectionName - Name of the collection
     * @param {Object} document - Document to insert
     */
    async insertOne(collectionName, document) {
        try {
            return await this.collection(collectionName).insertOne(document);
        } catch (error) {
            console.error(`Error inserting document into ${collectionName}:`, error);
            throw error;
        }
    }

    async updateOne(collectionName, filter, update) {
        try {
            return await this.collection(collectionName).updateOne(filter, update);
        } catch (error) {
            console.error(`Error in updateOne (${collectionName}):`, error);
            throw error;
        }
    }

    async deleteOne(collectionName, filter) {
        try {
            return await this.db.collection(collectionName).deleteOne(filter);
        } catch (error) {
            console.error('[Database] DeleteOne error:', error);
            throw error;
        }
    }

    async updateMany(collectionName, filter, update) {
        try {
            return await this.collection(collectionName).updateMany(filter, update);
        } catch (error) {
            console.error(`Error in updateMany (${collectionName}):`, error);
            throw error;
        }
    }

    async close() {
        if (this.client) {
            await this.client.close();
            this.client = null;
            this.db = null;
        }
    }
}

// Create singleton instance
const database = new Database();
export default database;