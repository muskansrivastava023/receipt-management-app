const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer'); // Added for file uploads
const { v4: uuidv4 } = require('uuid'); // Added for generating unique IDs
const pdf = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Database Setup ---
const DB_PATH = path.join(__dirname, 'receipts.db'); // Path to our SQLite database
let db; // Database instance

// Function to initialize the database
function initDb() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
                reject(err);
            } else {
                console.log('Connected to the SQLite database.');
                // Create tables if they don't exist
                db.serialize(() => {
                    db.run(`CREATE TABLE IF NOT EXISTS receipt_file (
                        id TEXT PRIMARY KEY,
                        file_name TEXT NOT NULL,
                        file_path TEXT NOT NULL UNIQUE,
                        is_valid INTEGER DEFAULT 0, -- 0 for false, 1 for true
                        invalid_reason TEXT,
                        is_processed INTEGER DEFAULT 0, -- 0 for false, 1 for true
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );`, (err) => {
                        if (err) {
                            console.error('Error creating receipt_file table:', err.message);
                            reject(err);
                        } else {
                            console.log('receipt_file table checked/created.');
                        }
                    });

                    db.run(`CREATE TABLE IF NOT EXISTS receipt (
                        id TEXT PRIMARY KEY,
                        purchased_at TEXT,
                        merchant_name TEXT,
                        total_amount REAL,
                        file_path TEXT NOT NULL UNIQUE, -- Link to the actual file
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY (file_path) REFERENCES receipt_file(file_path)
                    );`, (err) => {
                        if (err) {
                            console.error('Error creating receipt table:', err.message);
                            reject(err);
                        } else {
                            console.log('receipt table checked/created.');
                            resolve(); // Resolve the promise once both tables are checked/created
                        }
                    });
                });
            }
        });
    });
}

// --- Multer Storage Configuration ---
const UPLOAD_DIR = path.join(__dirname, 'uploads'); // Ensure this directory exists

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Ensure the upload directory exists
        if (!fs.existsSync(UPLOAD_DIR)) {
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        }
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = uuidv4(); // Generate a unique ID for the filename
        const fileExtension = path.extname(file.originalname); // Get original extension
        cb(null, `${uniqueSuffix}${fileExtension}`); // Store with unique name
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        // Only allow PDF files
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            // If the file is not a PDF, return an error
            const error = new Error('Only PDF files are allowed!');
            error.code = 'FILE_TYPE_ERROR'; // Custom error code
            cb(error, false);
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10 MB file size limit
    }
});

// --- Middleware ---
app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded

// --- Routes ---
app.get('/', (req, res) => {
    res.send('Welcome to the Receipt Management API!');
});

// API: Upload a receipt
app.post('/upload', upload.single('receiptFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }

    const fileId = uuidv4(); // Generate ID for the database entry
    const fileName = req.file.originalname;
    const filePath = req.file.path; // Multer saves the file and gives us the path

    const now = new Date().toISOString(); // Current timestamp in ISO format

    // Insert into receipt_file table
    const insertSql = `INSERT INTO receipt_file (id, file_name, file_path, is_valid, is_processed, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(insertSql,
        [fileId, fileName, filePath, 0, 0, now, now], // is_valid and is_processed are 0 (false) initially
        function(err) {
            if (err) {
                console.error('Error inserting receipt_file into DB:', err.message);
                // If DB insertion fails, attempt to delete the uploaded file to clean up
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting uploaded file after DB error:', unlinkErr);
                });
                return res.status(500).json({ message: 'Failed to save receipt metadata.', error: err.message });
            }
            res.status(201).json({
                message: 'Receipt uploaded and metadata saved successfully.',
                fileId: fileId,
                fileName: fileName,
                filePath: filePath
            });
        }
    );
});

// API: Validate a receipt
app.post('/validate', async (req, res) => {
    const { fileId } = req.body; // Expecting fileId in the request body

    if (!fileId) {
        return res.status(400).json({ message: 'fileId is required for validation.' });
    }

    try {
        // 1. Retrieve file_path from database
        const selectSql = `SELECT file_path FROM receipt_file WHERE id = ?`;
        const row = await new Promise((resolve, reject) => {
            db.get(selectSql, [fileId], (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        if (!row) {
            return res.status(404).json({ message: 'File not found in database.' });
        }

        const filePath = row.file_path;

        // 2. Check if file exists on disk
        if (!fs.existsSync(filePath)) {
            // Update DB to reflect file missing, then return error
            const updateMissingSql = `UPDATE receipt_file SET is_valid = 0, invalid_reason = ?, updated_at = ? WHERE id = ?`;
            await new Promise((resolve, reject) => {
                db.run(updateMissingSql, ['File not found on disk', new Date().toISOString(), fileId], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            return res.status(404).json({ message: 'Associated file not found on server disk.' });
        }

        let isValid = 1; // Assume valid unless proven otherwise
        // Default invalid reason to null
        let invalidReason = null;
        let pdfDataBuffer;

        try {
            pdfDataBuffer = fs.readFileSync(filePath);
            await pdf(pdfDataBuffer); // Attempt to parse the PDF
            // If parsing succeeds, it's a valid PDF
            console.log(`File ${fileId} is a valid PDF.`);
        } catch (pdfErr) {
            isValid = 0; // Set to invalid
            invalidReason = `PDF parsing failed: ${pdfErr.message.substring(0, 200)}`; // Truncate long error messages
            console.warn(`File ${fileId} is invalid:`, pdfErr.message);
        }

        // 3. Update the receipt_file table with validation status
        const updateSql = `UPDATE receipt_file SET is_valid = ?, invalid_reason = ?, updated_at = ? WHERE id = ?`;
        await new Promise((resolve, reject) => {
            db.run(updateSql, [isValid, invalidReason, new Date().toISOString(), fileId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        res.status(200).json({
            message: 'Receipt validated successfully.',
            fileId: fileId,
            isValid: isValid === 1,
            reason: invalidReason
        });

    } catch (error) {
        console.error('Error validating receipt:', error);
        res.status(500).json({ message: 'Internal server error during validation.', error: error.message });
    }
});

// --- Error Handling for Multer and other specific errors ---
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ message: 'File too large. Max 10MB allowed.' });
        }
        // Handle other Multer errors if needed
    } else if (err.code === 'FILE_TYPE_ERROR') { // Custom error code from our fileFilter
        return res.status(415).json({ message: err.message });
    }
    // For any other unexpected errors
    console.error('Unhandled application error:', err);
    res.status(500).json({ message: 'An unexpected server error occurred.', error: err.message });
});


// Start the server after database initialization
initDb()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Access it at: http://localhost:${PORT}`);
        });
    })
    .catch(err => {
        console.error('Failed to initialize database, server not started:', err);
        process.exit(1); // Exit process if DB fails to init
    });

// Export the database instance for use in other modules (e.g., routes, controllers)
module.exports = { app, db };