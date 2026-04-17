// testRawUbl.js

const logoApi = require('./services/logo-api');

async function runRawLogTest() {
    console.log("🔍 Starting Raw UBL Log Test...");

    try {
        // 1. Get the list to find a valid UUID
        const list = await logoApi.getGelenInvoiceList(1);
        const inv = list[0];

        if (!inv) {
            console.log("⚠️ No invoices found in the Gelen list.");
            return;
        }

        console.log(`📡 Found Invoice: ${inv.invoiceId} (UUID: ${inv.uuId})`);

        // 2. Fetch the Base64 UBL
        const base64Content = await logoApi.getInvoiceUBL(inv.uuId);

        if (!base64Content) {
            console.log("❌ Base64 content is empty or null.");
            return;
        }
        const zlib = require('zlib'); // Built-in Node module

        // 3. Decode Base64 to XML String
        const xmlData = Buffer.from(base64Content, 'base64').toString('utf-8');

        // 4. Log the result
        console.log("\n--- RAW XML START ---");
        console.log(xmlData.substring(0, 1500)); // Logging first 1500 chars to avoid flooding terminal
        console.log("--- RAW XML END ---\n");

        console.log("✅ If you see <Invoice> tags above, the test is successful!");

    } catch (error) {
        console.error("💥 Test Failed:", error.message);
    }
}

runRawLogTest();