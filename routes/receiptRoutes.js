const express = require('express');
const router = express.Router(); // Create an Express router
const path = require('path');
const fs = require('fs');
const pdf = require('pdf-parse');
const { processReceiptWithOCR } = require('../services/ocrService'); // Import the OCR service


module.exports = (db, upload) => {

    // --- /upload API Route ---
    router.post('/upload', upload.single('receiptFile'), async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded.' });
        }

        const fileId = req.file.filename.split('.')[0]; // Multer filename is already UUID, use it as fileId
        const originalFileName = req.file.originalname;
        const filePath = req.file.path;

        let dbRunPromise = (sql, params = []) => {
            return new Promise((resolve, reject) => {
                db.run(sql, params, function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, changes: this.changes });
                });
            });
        };

        try {
            const insertSql = `
                INSERT INTO receipt_file (id, file_name, file_path, is_valid, invalid_reason, is_processed, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const now = new Date().toISOString();
            await dbRunPromise(insertSql, [
                fileId,
                originalFileName,
                filePath,
                0, // is_valid (default to false, will be updated by /validate)
                null, // invalid_reason
                0, // is_processed (default to false, will be updated by /process)
                now,
                now
            ]);

            res.status(200).json({
                message: 'Receipt uploaded and metadata saved successfully.',
                fileId: fileId,
                fileName: originalFileName,
                filePath: filePath
            });

        } catch (error) {
            console.error('Error uploading file or saving metadata:', error);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            res.status(500).json({ message: 'Internal server error during upload.', error: error.message });
        }
    });

    // --- /validate API Route ---
    router.post('/validate', async (req, res) => {
        const { fileId } = req.body;

        if (!fileId) {
            return res.status(400).json({ message: 'fileId is required.' });
        }

        let dbGetPromise = (sql, params = []) => {
            return new Promise((resolve, reject) => {
                db.get(sql, params, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        };

        let dbRunPromise = (sql, params = []) => {
            return new Promise((resolve, reject) => {
                db.run(sql, params, function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes });
                });
            });
        };

        try {
            const fileRecord = await dbGetPromise('SELECT * FROM receipt_file WHERE id = ?', [fileId]);

            if (!fileRecord) {
                return res.status(404).json({ message: 'File not found.' });
            }

            const dataBuffer = fs.readFileSync(fileRecord.file_path);
            let isValid = false;
            let invalidReason = null;

            try {
                const data = await pdf(dataBuffer); // pdf-parse checks for valid PDF structure
                isValid = true;
                console.log(`File ${fileRecord.file_name} is a valid PDF.`);
            } catch (validationError) {
                isValid = false;
                invalidReason = validationError.message;
                console.error(`File ${fileRecord.file_name} is NOT a valid PDF:`, validationError.message);
            }

            const updateSql = `
                UPDATE receipt_file
                SET is_valid = ?, invalid_reason = ?, updated_at = ?
                WHERE id = ?
            `;
            const now = new Date().toISOString();
            await dbRunPromise(updateSql, [isValid ? 1 : 0, invalidReason, now, fileId]);

            res.status(200).json({
                message: `File validated successfully.`,
                fileId: fileId,
                isValid: isValid,
                invalidReason: invalidReason
            });

        } catch (error) {
            console.error('Error during validation:', error);
            res.status(500).json({ message: 'Internal server error during validation.', error: error.message });
        }
    });

    // --- /process API Route ---
    router.post('/process', async (req, res) => {
        const { fileId } = req.body;

        if (!fileId) {
            return res.status(400).json({ message: 'fileId is required.' });
        }

        let dbGetPromise = (sql, params = []) => {
            return new Promise((resolve, reject) => {
                db.get(sql, params, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        };

        let dbRunPromise = (sql, params = []) => {
            return new Promise((resolve, reject) => {
                db.run(sql, params, function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes });
                });
            });
        };

        try {
            const fileRecord = await dbGetPromise('SELECT * FROM receipt_file WHERE id = ?', [fileId]);

            if (!fileRecord) {
                return res.status(404).json({ message: 'File not found.' });
            }
            if (!fileRecord.is_valid) {
                return res.status(400).json({ message: 'File is not marked as valid. Please validate it first.', invalidReason: fileRecord.invalid_reason });
            }
            if (fileRecord.is_processed) {
                return res.status(200).json({ message: 'File has already been processed.', receiptId: fileRecord.receipt_id });
            }

            // Use the centralized OCR processing function
            const { rawText, purchasedAt, merchantName, totalAmount } = await processReceiptWithOCR(fileRecord.file_path);

            const receiptId = uuidv4(); // Generate a new UUID for the receipt entry
            const insertReceiptSql = `
                INSERT INTO receipt (id, file_id, merchant_name, total_amount, purchase_date, raw_text, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const now = new Date().toISOString();

            await dbRunPromise(insertReceiptSql, [
                receiptId,
                fileId,
                merchantName,
                totalAmount,
                purchasedAt,
                rawText,
                now,
                now
            ]);

            // Update the receipt_file record
            const updateFileSql = `
                UPDATE receipt_file
                SET is_processed = ?, receipt_id = ?, updated_at = ?
                WHERE id = ?
            `;
            await dbRunPromise(updateFileSql, [1, receiptId, now, fileId]);


            res.status(200).json({
                message: 'Receipt processed and data saved successfully.',
                receiptId: receiptId,
                extractedData: {
                    merchantName: merchantName,
                    totalAmount: totalAmount,
                    purchaseDate: purchasedAt
                }
            });

        } catch (error) {
            console.error('Error during processing:', error);
            res.status(500).json({ message: 'Internal server error during processing.', error: error.message });
        }
    });

     // --- /receipts (GET) - Lists all receipts ---
    router.get('/receipts', async (req, res) => {
        let dbAllPromise = (sql, params = []) => {
            return new Promise((resolve, reject) => {
                db.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        };

        try {
            const receipts = await dbAllPromise('SELECT * FROM receipt');
            res.status(200).json({
                message: 'All receipts retrieved successfully.',
                receipts: receipts
            });
        } catch (error) {
            console.error('Error retrieving all receipts:', error);
            res.status(500).json({ message: 'Internal server error.', error: error.message });
        }
    });

    // --- /receipts/{id} (GET) - Retrieves details of a specific receipt ---
    router.get('/receipts/:id', async (req, res) => {
        const receiptId = req.params.id; 

        let dbGetPromise = (sql, params = []) => {
            return new Promise((resolve, reject) => {
                db.get(sql, params, (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        };

        try {
            const receipt = await dbGetPromise('SELECT * FROM receipt WHERE id = ?', [receiptId]);

            if (!receipt) {
                return res.status(404).json({ message: 'Receipt not found.' });
            }

            res.status(200).json({
                message: 'Receipt details retrieved successfully.',
                receipt: receipt
            });
        } catch (error) {
            console.error(`Error retrieving receipt ${receiptId}:`, error);
            res.status(500).json({ message: 'Internal server error.', error: error.message });
        }
    });


    return router; 
};