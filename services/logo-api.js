const axios = require('axios');
require('dotenv').config();

// ─── auth cache ──────────────────────────────────────────────────────────────
// Token is valid for 1 day — we cache for 23 hours to be safe
let authCache = null;
const AUTH_TTL_MS = 23 * 60 * 60 * 1000; // 23 hours

async function login() {
    const now = Date.now();

    // Return cached token if still valid
    if (authCache && authCache.expiresAt > now) {
        return authCache;
    }

    const url = `${process.env.LOGO_BASE_URL}/api/v1.0/user/integrationLogin`;

    const response = await axios.post(url, {
        username: process.env.LOGO_USERNAME,
        password: process.env.LOGO_PASSWORD
    }, {
        headers: {
            'ApiKey': process.env.LOGO_API_KEY,
            'Content-Type': 'application/json'
        }
    });

    const data = response.data.data;

    authCache = {
        accessToken: data.accessToken,
        tenantId:    data.tenantId,
        userId:      data.userId,
        baseUrl:     data.baseUrl,
        expiresAt:   now + AUTH_TTL_MS,
    };

    console.log('🔐 Logo auth token refreshed.');
    return authCache;
}

// ─── date helpers ────────────────────────────────────────────────────────────

// Full historical start date — used on first run
const FULL_SYNC_START = '2020-01-01T00:00:00';

// 48 hours ago — used on subsequent hourly runs
function getLast48Hours() {
    const d = new Date(Date.now() - 48 * 60 * 60 * 1000);
    return d.toISOString().substring(0, 19);
}

function getNow() {
    return new Date().toISOString().substring(0, 19);
}

// ─── gelen ──────────────────────────────────────────────────────────────────

// getGelenInvoiceList fetches incoming invoice list
// startDate: pass FULL_SYNC_START for initial load, getLast48Hours() for hourly
async function getGelenInvoiceList(page = 1, limit = 100, startDate = FULL_SYNC_START) {
    const auth = await login();
    const endDate = getNow();

    try {
        const response = await axios.post(
            `${process.env.LOGO_BASE_URL}/api/v1.0/einvoices/myInvoicesList`,
            {
                filters: [
                    { columnName: 'issueDate', operator: 5, value: startDate },
                    { columnName: 'issueDate', operator: 2, value: endDate  }
                ],
                sorting: { issueDate: -1 },
                paging: { currentPage: page, pageSize: limit },
                count: true
            },
            {
                headers: {
                    'Authorization': `Bearer ${auth.accessToken}`,
                    'tenantId':      auth.tenantId,
                    'ApiKey':        process.env.LOGO_API_KEY,
                    'UserId':        auth.userId,
                    'UserEmail':     process.env.LOGO_USERNAME,
                    'UserName':      process.env.LOGO_USERNAME,
                    'Content-Type':  'application/json;charset=utf-8'
                }
            }
        );

        return response.data?.data?.data || [];
    } catch (error) {
        console.error(`❌ Gelen list error (page ${page}):`, error.response?.data || error.message);
        return [];
    }
}

// getInvoiceUBL fetches the UBL content for a Gelen invoice by UUID
async function getInvoiceUBL(uuId) {
    const auth = await login();
    const url = `${process.env.LOGO_BASE_URL}/api/v1.0/einvoices/DocumentUblDatawithuuid?uuid=${uuId}&type=1`;

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${auth.accessToken}`,
                'tenantId':      auth.tenantId,
                'ApiKey':        process.env.LOGO_API_KEY,
                'UserId':        auth.userId,
                'UserEmail':     process.env.LOGO_USERNAME,
                'UserName':      process.env.LOGO_USERNAME,
                'Content-Type':  'application/json;charset=utf-8'
            }
        });

        if (!response.data?.data?.content) {
            console.warn(`⚠️ No content returned for UUID: ${uuId}`);
            return null;
        }

        return response.data.data.content;
    } catch (error) {
        console.error(`❌ Gelen UBL fetch error [${uuId}]:`, error.response?.data || error.message);
        return null;
    }
}

// ─── giden ──────────────────────────────────────────────────────────────────

// getGidenInvoiceList fetches outgoing invoice list
// startDate: pass FULL_SYNC_START for initial load, getLast48Hours() for hourly
async function getGidenInvoiceList(page = 1, limit = 100, startDate = FULL_SYNC_START) {
    const auth = await login();
    const endDate = getNow();

    try {
        const response = await axios.post(
            `${process.env.LOGO_BASE_URL}/api/v1.0/invoices/invoices`,
            {
                filters: [
                    { columnName: 'type',   operator: 17, value: 'Tümü' },
                    { columnName: 'date',   operator: 5,  value: startDate },
                    { columnName: 'date',   operator: 2,  value: endDate  }
                ],
                sorting: { date: -1 },
                paging: { currentPage: page, pageSize: limit },
                count: true,
                columnNames: null
            },
            {
                headers: {
                    'Authorization': `Bearer ${auth.accessToken}`,
                    'tenantId':      auth.tenantId,
                    'ApiKey':        process.env.LOGO_API_KEY,
                    'UserId':        auth.userId,
                    'UserEmail':     process.env.LOGO_USERNAME,
                    'UserName':      process.env.LOGO_USERNAME,
                    'Content-Type':  'application/json; charset=utf-8'
                }
            }
        );

        return response.data?.data?.data || [];
    } catch (error) {
        console.error(`❌ Giden list error:`, error.response?.data || error.message);
        return [];
    }
}

// getGidenInvoiceUBL fetches the UBL content for a Giden invoice by internal id
async function getGidenInvoiceUBL(invoiceId) {
    const auth = await login();
    const url = `${process.env.LOGO_BASE_URL}/api/v1.0/einvoices/DocumentUblData?invoiceId=${invoiceId}&type=1`;

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${auth.accessToken}`,
                'tenantId':      auth.tenantId,
                'ApiKey':        process.env.LOGO_API_KEY,
                'UserId':        auth.userId,
                'UserEmail':     process.env.LOGO_USERNAME,
                'UserName':      process.env.LOGO_USERNAME,
                'Content-Type':  'application/json'
            }
        });

        return response.data?.data?.content || null;
    } catch (error) {
        console.error(`❌ Giden UBL fetch error [${invoiceId}]:`, error.response?.data?.message || error.message);
        return null;
    }
}

// ─── status re-check helpers ─────────────────────────────────────────────────

// Used by daily cron to re-check a single Gelen invoice status by UUID
// Returns the current statusCode and status string from Logo API
async function getGelenInvoiceStatus(uuid) {
    const auth = await login();

    try {
        const response = await axios.post(
            `${process.env.LOGO_BASE_URL}/api/v1.0/einvoices/myInvoicesList`,
            {
                filters: [{ columnName: 'uuId', operator: 0, value: uuid }],
                paging: { currentPage: 1, pageSize: 1 },
                count: false
            },
            {
                headers: {
                    'Authorization': `Bearer ${auth.accessToken}`,
                    'tenantId':      auth.tenantId,
                    'ApiKey':        process.env.LOGO_API_KEY,
                    'UserId':        auth.userId,
                    'UserEmail':     process.env.LOGO_USERNAME,
                    'UserName':      process.env.LOGO_USERNAME,
                    'Content-Type':  'application/json;charset=utf-8'
                }
            }
        );

        const inv = response.data?.data?.data?.[0];
        if (!inv) return null;

        return {
            statusCode:  inv.statusCode,
            status:      inv.status,
            rejectNot:   inv.rejectNot || null,
        };
    } catch (error) {
        console.error(`❌ Gelen status check error [${uuid}]:`, error.response?.data || error.message);
        return null;
    }
}

// Used by daily cron to re-check a single Giden invoice reply status by invoiceNumber
async function getGidenInvoiceStatus(invoiceNumber) {
    const auth = await login();

    try {
        const response = await axios.post(
            `${process.env.LOGO_BASE_URL}/api/v1.0/invoices/invoices`,
            {
                filters: [{ columnName: 'invoiceNumber', operator: 0, value: invoiceNumber }],
                paging: { currentPage: 1, pageSize: 1 },
                count: false,
                columnNames: null
            },
            {
                headers: {
                    'Authorization': `Bearer ${auth.accessToken}`,
                    'tenantId':      auth.tenantId,
                    'ApiKey':        process.env.LOGO_API_KEY,
                    'UserId':        auth.userId,
                    'UserEmail':     process.env.LOGO_USERNAME,
                    'UserName':      process.env.LOGO_USERNAME,
                    'Content-Type':  'application/json; charset=utf-8'
                }
            }
        );

        const inv = response.data?.data?.data?.[0];
        if (!inv) return null;

        return {
            eStatus:           inv.eStatus,
            eStatusDescription: inv.eStatusDescription,
            eReplyDescription: inv.eReplyDescription,
            eReplayText:       inv.eReplayText,
            isCancelled:       inv.isCancelled,
        };
    } catch (error) {
        console.error(`❌ Giden status check error [${invoiceNumber}]:`, error.response?.data || error.message);
        return null;
    }
}

module.exports = {
    login,
    getGelenInvoiceList,
    getInvoiceUBL,
    getGidenInvoiceList,
    getGidenInvoiceUBL,
    getGelenInvoiceStatus,
    getGidenInvoiceStatus,
    FULL_SYNC_START,
    getLast48Hours,
};