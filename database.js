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

    collection(name) {
        if (!this.db) {
            throw new Error('Database not connected');
        }
        return this.db.collection(name);
    }

    async findOne(collectionName, query) {
        try {
            return await this.collection(collectionName).findOne(query);
        } catch (error) {
            console.error(`Error in findOne (${collectionName}):`, error);
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

    async insertOne(collectionName, document) {
        try {
            return await this.collection(collectionName).insertOne(document);
        } catch (error) {
            console.error(`Error in insertOne (${collectionName}):`, error);
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
            return await this.collection(collectionName).deleteOne(filter);
        } catch (error) {
            console.error(`Error in deleteOne (${collectionName}):`, error);
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