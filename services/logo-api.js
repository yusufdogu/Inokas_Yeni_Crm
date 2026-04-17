const axios = require('axios');

require('dotenv').config();

// Token cache to avoid logging in for every single request
let authCache = null;

async function login() {
    // If we have a cache, we could check expiry here, but for now let's just use it
    if (authCache) return authCache;

    try {
        const loginUrl = `${process.env.LOGO_BASE_URL}/api/v1.0/token`;
        console.log("🔗 Attempting login at:", loginUrl); // <--- ADD THIS

        const response = await axios.post(`${process.env.LOGO_BASE_URL}/api/v1.0/user/integrationLogin`, {
            username: process.env.LOGO_USERNAME,
            password: process.env.LOGO_PASSWORD
        }, {
            headers: {
                'apiKey': process.env.LOGO_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log("LOGO LOGIN KEYS:", Object.keys(response.data.data));

        authCache = response.data.data;
        return authCache;
    } catch (error) {
        console.error("❌ Logo Giriş Hatası:", error.response?.data || error.message);
        throw error;
    }
}



async function getGelenInvoiceList(page = 1, limit = 100) {
    const auth = await login();

    // Dökümana uygun tarih formatı (YYYY-MM-DD HH:mm:ss)
    const startDate = "2026-01-01 00:00:00";
    const endDate = "2026-04-16 00:00:00"

    try {
        const response = await axios.post(`${process.env.LOGO_BASE_URL}/api/v1.0/einvoices/myInvoicesList`, {
            filters: [
                {
                    columnName: "issueDate", // Dökümandaki sütun adı
                    operator: 5,            // >= (Büyük veya eşit)
                    value: startDate
                },
                {
                    columnName: "issueDate",
                    operator: 2,            // <= (Küçük veya eşit)
                    value: endDate
                }
            ],
            sorting: { issueDate: -1 }, // En yeni en üstte
            paging: {
                currentPage: page,
                pageSize: limit
            },
            count: true
        }, {
            headers: {
                'Authorization': `Bearer ${auth.accessToken}`,
                'tenantId': auth.tenantId,
                'apiKey': process.env.LOGO_API_KEY,
                'UserId': auth.userId,
                'UserEmail': process.env.LOGO_USERNAME,
                'UserName': process.env.LOGO_USERNAME,
                'Content-Type': 'application/json;charset=utf-8'
            }
        });

        console.log("Gelen Invoice KEYS:", Object.keys(response.data.data.data[0]));
        return response.data?.data?.data || [];
    } catch (error) {
        console.error(`❌ Liste çekme hatası (Sayfa ${page}):`, error.response?.data || error.message);
        return [];
    }
}
async function getInvoiceUBL(uuId) {
    const auth = await login();
    const url = `${process.env.LOGO_BASE_URL}/api/v1.0/einvoices/DocumentUblDatawithuuid?uuid=${uuId}&type=1`;

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${auth.accessToken}`,
                'tenantId': auth.tenantId,
                'apiKey': process.env.LOGO_API_KEY,
                'UserId': auth.userId,
                'UserEmail': process.env.LOGO_USERNAME,
                'UserName': process.env.LOGO_USERNAME,
                'Content-Type': 'application/json'
            }
        });

        // SAFETY: Check if content actually exists
        if (!response.data?.data?.content) {
            console.warn(`⚠️ No content returned for UUID: ${uuId}`);
            return null;
        }

        return response.data.data.content;
    } catch (error) {
        // Log the actual error body from Logo to see if it's "Token Expired" or "Rate Limit"
        console.error(`❌ Logo UBL Fetch Error [${uuId}]:`, error.response?.data || error.message);
        return null;
    }
}


// Add these to logo-api.js

/**
 * Fetches the list of outgoing (sales) invoices.
 * Supports e-Invoice (1), e-Archive (2), and e-Archive Internet (3).
 */
async function getGidenInvoiceList(page = 1, limit = 100) {
    const auth = await login();
    const startDate = "2026-01-01T00:00:00"; // Note the 'T' format required for Outgoing
    const endDate = "2026-04-16T00:00:00"

    try {
        const response = await axios.post(`${process.env.LOGO_BASE_URL}/api/v1.0/invoices/invoices`,
            {
            filters: [
                {
                    columnName: "type",
                    operator: 17, // IN operator
                    value: 'Tümü' // Fetch all types
                },
                {
                    columnName: "date", // Documentation says 'date' for outgoing
                    operator: 5,        // >=
                    value: startDate
                },
                {
                    columnName: "date",
                    operator: 2,        // <=
                    value: endDate
                }
            ],
            sorting: { date: -1 },
            paging: {
                currentPage: page,
                pageSize: limit
            },
            count: true,
            columnNames: null
        }, {
            headers: {
                'Authorization': `Bearer ${auth.accessToken}`,
                'tenantId': auth.tenantId,
                'apiKey': process.env.LOGO_API_KEY,
                'UserId': auth.userId,
                'UserEmail': process.env.LOGO_USERNAME,
                'UserName': process.env.LOGO_USERNAME,
                'Content-Type': 'application/json; charset=utf-8'
            }
        });

        console.log("Giden Invoice KEYS:", Object.keys(response.data.data.data[0]));

        return response.data?.data?.data || [];
    } catch (error) {
        console.error(`❌ Outgoing List Error:`, error.response?.data || error.message);
        return [];
    }
}

/**
 * Fetches the UBL content for a Sales Invoice.
 * Note: Uses invoiceId (the readable number) and type=1.
 */
async function getGidenInvoiceUBL(invoiceId) {
    const auth = await login();
    // type=1 is required for UBL data
    const url = `${process.env.LOGO_BASE_URL}/api/v1.0/einvoices/DocumentUblData?invoiceId=${invoiceId}&type=1`

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${auth.accessToken}`,
                'tenantId': auth.tenantId,
                'apiKey': process.env.LOGO_API_KEY,
                'UserId': auth.userId,
                'UserEmail': process.env.LOGO_USERNAME,
                'UserName': process.env.LOGO_USERNAME,
                'Content-Type': 'application/json'
            }
        });

        return response.data?.data?.content; // Returns Base64 string
    } catch (error) {
        console.error(`❌ Outgoing UBL Error for ${invoiceId}:`, error.response?.data?.message || error.message);
        return null;
    }
}


module.exports = {
    getGidenInvoiceList,
    getGidenInvoiceUBL,
    getGelenInvoiceList,
    getInvoiceUBL,
};