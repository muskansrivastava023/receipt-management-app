const path = require('path');
const fs = require('fs');
const { createWorker } = require('tesseract.js');
const { fromPath } = require('pdf2pic');
const { v4: uuidv4 } = require('uuid');

// --- OCR Processing Function ---
async function processReceiptWithOCR(filePath) {
    let worker;
    let tempImagePath = null;
    try {
        worker = await createWorker('eng');

        // Configure pdf2pic options
        const options = {
            density: 300,
            saveFilename: uuidv4(),
            savePath: path.join(__dirname, '../temp_images'), 
            format: 'png',
            width: 1654,
            height: 2339,
            command: 'magick' // full path to avoid name conflict
        };

        // Create the temporary images directory if it doesn't exist
        const tempImageDir = options.savePath;
        if (!fs.existsSync(tempImageDir)) {
            fs.mkdirSync(tempImageDir);
        }

        const convert = fromPath(filePath, options);
        const pageToConvertAsImage = 1;
        const result = await convert(pageToConvertAsImage);

        tempImagePath = result.path;

        if (!fs.existsSync(tempImagePath)) {
            throw new Error(`Temporary image file not found at ${tempImagePath}`);
        }

        const { data: { text } } = await worker.recognize(tempImagePath);
        console.log('--- Extracted Raw Text ---');
        console.log(text);
        console.log('--------------------------');

        // --- Regex for data extraction (keep your existing regexes) ---
        // Date Regexes (add more patterns if needed)
        const dateRegexes = [
            /(\d{2}\/\d{2}\/\d{4})/, // MM/DD/YYYY
            /(\d{4}-\d{2}-\d{2})/,   // YYYY-MM-DD
            /(\d{2}\/\d{2}\/\d{2})/, // MM/DD/YY
            /(\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s\d{2,4})/, // DD Mon YYYY/YY
            /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s\d{1,2},\s\d{4})/, // Mon DD, YYYY
            /(\d{1,2}\/\d{1,2}\/\d{2,4})/, // D/M/YY or DD/MM/YYYY
            /(\d{2}\s?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s?\d{4})/, // DD Mon YYYY
            /(\d{1,2}(?:st|nd|rd|th)?\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s\d{4})/, // DDth Mon YYYY
            /(\d{1,2}:\d{2}\s(?:AM|PM|am|pm))\s(\d{2}\/\d{2}\/\d{4})/ // Time Date pattern, e.g., 08:15 AM 05/24/2024
        ];


        // Looks for the first significant line, or specific keywords
        const merchantRegex = /^(.*?)(?:Receipt|Invoice|Bill|Store|Shop|Market|Restaurant|Cafe|Bar)/im;

        // Total Amount Regex (looking for common patterns like Total, Grand Total, etc., followed by a number)
        const totalRegex = /(?:TOTAL|TOTAL DUE|AMOUNT DUE|GRAND TOTAL|BALANCE|NET AMOUNT|SUM|TOTAL PAID)[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/im;


        let purchasedAt = null;
        for (const regex of dateRegexes) {
            const match = text.match(regex);
            if (match) {
                // If the last regex is matched, parse the date from the second capture group
                let dateString = regex === dateRegexes[dateRegexes.length - 1] ? match[2] : match[1];
                const parsedDate = new Date(dateString);
                if (!isNaN(parsedDate.getTime())) { // Check if it's a valid date
                    purchasedAt = parsedDate.toISOString();
                    break;
                }
            }
        }

        let merchantName = null;
        const merchantMatch = text.match(merchantRegex);
        if (merchantMatch) {
            merchantName = merchantMatch[1].trim();
        } else {
            const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            if (lines.length > 0) {
                merchantName = lines[0]; // Fallback to the first non-empty line
            }
        }

        let totalAmount = null;
        const totalMatch = text.match(totalRegex);
        if (totalMatch) {
            totalAmount = parseFloat(totalMatch[1].replace(/[^0-9.]/g, ''));
        }

        return { rawText: text, purchasedAt, merchantName, totalAmount };

    } catch (error) {
        console.error('Error during OCR processing or PDF conversion:', error);
        throw error;
    } finally {
        if (worker) {
            await worker.terminate();
        }
        if (tempImagePath && fs.existsSync(tempImagePath)) {
            fs.unlinkSync(tempImagePath);
            console.log(`Cleaned up temporary image: ${tempImagePath}`);
        }
    }
}

module.exports = { processReceiptWithOCR }; 