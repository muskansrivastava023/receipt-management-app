const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid'); 

process.env.PATH = `C:\\Program Files\\ImageMagick-6.9.13-Q8;` + process.env.PATH;
console.log("Updated Node.js process PATH:", process.env.PATH); // for debugging

// --- Database Setup ---
const DB_PATH = path.join(__dirname, 'receipts.db');
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Could not connect to database', err);
    } else {
        console.log('Connected to SQLite database.');
        // Create tables if they don't exist
        db.serialize(() => {
            db.run(`
                CREATE TABLE IF NOT EXISTS receipt_file (
                    id TEXT PRIMARY KEY,
                    file_name TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    is_valid INTEGER DEFAULT 0,
                    invalid_reason TEXT,
                    is_processed INTEGER DEFAULT 0,
                    receipt_id TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    FOREIGN KEY (receipt_id) REFERENCES receipt(id)
                )
            `);
            db.run(`
                CREATE TABLE IF NOT EXISTS receipt (
                    id TEXT PRIMARY KEY,
                    file_id TEXT NOT NULL UNIQUE,
                    merchant_name TEXT,
                    total_amount REAL,
                    purchase_date TEXT,
                    raw_text TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    FOREIGN KEY (file_id) REFERENCES receipt_file(id)
                )
            `);
        });
    }
});

// --- Multer Storage Configuration ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Ensure temp_images directory exists for pdf2pic
const tempImageDir = path.join(__dirname, 'temp_images');
if (!fs.existsSync(tempImageDir)) {
    fs.mkdirSync(tempImageDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const fileExtension = path.extname(file.originalname);
        const uniqueFilename = `${uuidv4()}${fileExtension}`; // Use UUID as the filename
        cb(null, uniqueFilename);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed!'), false);
        }
    }
});

// --- Initialize Express App ---
const app = express();
const PORT = 3000;

app.use(express.json()); // For parsing application/json bodies

// --- Import and Use Routes ---
// Import the function that creates the router, passing db and upload middleware
const receiptRoutes = require('./routes/receiptRoutes')(db, upload);
app.use('/', receiptRoutes);

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});