console.log("Key Check:", process.env.SUPABASE_KEY)
require('dotenv').config()

// db-logic.js (Part 1)
const { createClient } = require('@supabase/supabase-js');

// You should initialize your client with your env variables
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

/**
 * Ensures the company exists in the database.
 * Returns the internal UUID (id) of the company.
 */
async function upsertCompany(companyData) {
    try {
        const { data, error } = await supabase
            .from('companies')
            .upsert({
                vkn_tckn: companyData.vkn_tckn,
                name: companyData.name,
                phone: companyData.phone,
                email: companyData.email,
                full_address: companyData.full_address,
                website: companyData.website
            }, {
                onConflict: 'vkn_tckn' // Tells Supabase to check this column for duplicates
            })
            .select('id') // We need the internal ID back
            .single();

        if (error) throw error;

        console.log(`✅ Company synced: ${companyData.name} (ID: ${data.id})`);
        return data.id;

    } catch (error) {
        console.error('❌ Error in upsertCompany:', error.message);
        throw error;
    }
}

/**
 * Saves the main invoice information.
 * Returns the internal UUID (id) of the invoice.
 */
async function upsertInvoice(invoiceData, companyId, direction) {
    try {
        const { data, error } = await supabase
            .from('invoices')
            .upsert({
                efatura_uuid: invoiceData.efatura_uuid,
                invoice_no: invoiceData.invoice_no,
                invoice_date: invoiceData.invoice_date,
                total_amount_tl: invoiceData.total_amount_tl,
                currency: invoiceData.currency,
                direction: direction, // 'IN' or 'OUT'
                company_id: companyId, // The ID from Step 1
                status: invoiceData.status
            }, {
                onConflict: 'efatura_uuid'
            })
            .select('id')
            .single();

        if (error) throw error;

        console.log(`✅ Invoice header synced: ${invoiceData.invoice_no}`);
        return data.id;

    } catch (error) {
        console.error('❌ Error in upsertInvoice:', error.message);
        throw error;
    }
}

/**
 * Inserts the product/service lines for a specific invoice.
 */
async function insertInvoiceItems(invoiceId, itemsArray) {
    try {
        // 1. Clear existing items for this invoice (Optional but recommended for updates)
        await supabase
            .from('invoice_items')
            .delete()
            .eq('invoice_id', invoiceId);

        // 2. Prepare items by adding the parent invoice_id to each one
        const itemsToInsert = itemsArray.map(item => ({
            ...item,
            invoice_id: invoiceId // Link to the header we just created
        }));

        // 3. Bulk Insert
        const { error } = await supabase
            .from('invoice_items')
            .insert(itemsToInsert);

        if (error) throw error;

        console.log(`✅ ${itemsToInsert.length} items synced for invoice ID: ${invoiceId}`);
        return true;

    } catch (error) {
        console.error('❌ Error in insertInvoiceItems:', error.message);
        throw error;
    }
}