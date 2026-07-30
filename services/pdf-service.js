// services/pdf-service.js
// XML (Turkish UBL e-invoice) → PDF via Puppeteer + XSLT

const puppeteer = require('puppeteer');       // full — bundles Chromium ✓


function getChromePath() {
    return process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
}
async function xmlToPdfBuffer(xmlText) {
    const executablePath = getChromePath();
    const browser = await puppeteer.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),   // only set if we have one
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
        const page = await browser.newPage();
        const html = await page.evaluate((xml) => {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xml, 'text/xml');
            const nodes = xmlDoc.getElementsByTagName('cbc:EmbeddedDocumentBinaryObject');
            let base64Xslt = null;
            for (let i = 0; i < nodes.length; i++) {
                const fn = nodes[i].getAttribute('filename') || '';
                if (fn.toLowerCase().endsWith('.xslt')) { base64Xslt = nodes[i].textContent; break; }
            }
            if (!base64Xslt && nodes.length > 0) base64Xslt = nodes[0].textContent;
            if (!base64Xslt) throw new Error('XSLT bulunamadı');
            const decodedXslt = decodeURIComponent(escape(atob(base64Xslt)));
            const xsltDoc = parser.parseFromString(decodedXslt, 'text/xml');
            const proc = new XSLTProcessor();
            proc.importStylesheet(xsltDoc);
            const fragment = proc.transformToFragment(xmlDoc, document);
            return new XMLSerializer().serializeToString(fragment);
        }, xmlText);
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({ format: 'A4', printBackground: true });
        return pdf;
    } finally {
        await browser.close();
    }
}

async function generateAndUploadPdf(supabase, invoiceId, xmlUrl) {
    try {
        const xmlRes = await fetch(xmlUrl);
        if (!xmlRes.ok) throw new Error('XML indirilemedi: ' + xmlRes.status);
        const xmlText = await xmlRes.text();

        const pdfBuffer = await xmlToPdfBuffer(xmlText);
        const fileName = `${invoiceId}.pdf`;

        const { error: uploadError } = await supabase.storage
            .from('invoice-pdfs')
            .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true });
        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
            .from('invoice-pdfs')
            .getPublicUrl(fileName);

        await supabase.from('invoices').update({ pdf_url: publicUrl }).eq('id', invoiceId);
        return publicUrl;
    } catch (err) {
        console.error(`[pdf-service] ${invoiceId} PDF üretilemedi:`, err.message);
        return null;
    }
}

module.exports = { xmlToPdfBuffer, generateAndUploadPdf };
