import { MongoClient } from 'mongodb';
import config from './config.js';

class Database {
    constructor() {
        this.client = null;
        this.db = null;
    }

    async connect(url = config.MONGODB_URI, dbName = config.MONGODB_DB_NAME) {
        try {
            this.client = new MongoClient(url);
            await this.client.connect();
            this.db = this.client.db(dbName);
            console.log('Connected to MongoDB successfully');
        } catch (error) {
            console.error('MongoDB connection error:', error);
            throw error;
        }
    }

    async close() {
        try {
            if (this.client) {
                await this.client.close();
                console.log('MongoDB connection closed');
            }
        } catch (error) {
            console.error('Error closing MongoDB connection:', error);
            throw error;
        }
    }

    // Method untuk mendapatkan collection
    collection(name) {
        if (!this.db) {
            throw new Error('Database connection not established');
        }
        return this.db.collection(name);
    }

    // Helper methods untuk operasi umum
    async insertOne(collectionName, document) {
        try {
            const result = await this.collection(collectionName).insertOne(document);
            return result;
        } catch (error) {
            console.error(`Error inserting into ${collectionName}:`, error);
            throw error;
        }
    }

    async find(collectionName, query = {}, options = {}) {
        try {
            return await this.collection(collectionName).find(query, options).toArray();
        } catch (error) {
            console.error(`Error finding in ${collectionName}:`, error);
            throw error;
        }
    }

    async findOne(collectionName, query = {}) {
        try {
            return await this.collection(collectionName).findOne(query);
        } catch (error) {
            console.error(`Error finding one in ${collectionName}:`, error);
            throw error;
        }
    }

    async updateOne(collectionName, filter, update) {
        try {
            return await this.collection(collectionName).updateOne(filter, update);
        } catch (error) {
            console.error(`Error updating in ${collectionName}:`, error);
            throw error;
        }
    }

    async deleteOne(collectionName, filter) {
        try {
            return await this.collection(collectionName).deleteOne(filter);
        } catch (error) {
            console.error(`Error deleting in ${collectionName}:`, error);
            throw error;
        }
    }
}

// Create singleton instance
const database = new Database();
export default database;
