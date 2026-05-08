// runSync.js
require('dotenv').config();

const { syncGelenInvoices, syncGidenInvoices } = require('./services/sync-service');

async function main() {
    try {
        console.log("📂 Initializing Data Sync...");
        await syncGelenInvoices();
        await syncGidenInvoices();
        console.log("✨ All tasks completed successfully.");
        process.exit(0);
    } catch (error) {
        console.error("💥 Critical Sync Failure:", error);
        process.exit(1);
    }
}

main();