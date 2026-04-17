const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
    ignoreAttributes: false, // Important: unitCode and currencyID are attributes
    attributeNamePrefix: "",
    parseAttributeValue: true
});

function parseUblFromBase64(base64Content) {
    try {
        const zipBuffer = Buffer.from(base64Content, 'base64');
        const zip = new AdmZip(zipBuffer);
        const xmlEntry = zip.getEntries().find(e => e.entryName.endsWith('.xml'));
        if (!xmlEntry) return null;

        const xmlText = xmlEntry.getData().toString('utf8');
        const jsonObj = parser.parse(xmlText);

        // In your XML, the root is 'Invoice'
        return jsonObj.Invoice;
    } catch (error) {
        console.error("Parser Error:", error.message);
        return null;
    }
}

module.exports = { parseUblFromBase64 };