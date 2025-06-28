Features:-
1. PDF Upload: Upload receipt files in PDF format.
2. PDF Validation: Verify if an uploaded file is a valid PDF.
3. OCR Data Extraction: Utilize Tesseract OCR and ImageMagick to extract text from PDF receipts.
4. Data Parsing: Simple regex-based parsing for merchant name, total amount, and purchase date.
5. Database Storage: Store receipt metadata and extracted data in an SQLite database.
6. Modular Design: Organized into routes and services for better maintainability.

Dependencies:-
1. System Dependencies
2. Node.js: Version 14.x or higher.
3. npm: Node Package Manager (comes with Node.js).
4. SQLite Browser (Optional but Recommended): For easy inspection of the receipts.db database (e.g., DB Browser for SQLite).
5. ImageMagick 6.x: Essential for converting PDFs to images, which Tesseract then processes.
    Crucial: During installation, ensure you select:
    "Install legacy utilities (e.g. convert)": This provides the convert.exe command required.
    "Add application directory to your system PATH": This ensures the convert.exe command is accessible.
Note: ImageMagick 7.x changes the convert command to magick. This project specifically uses convert.exe from the 6.x series due to compatibility issues encountered with pdf2pic and gm packages. The process.env.PATH modification in index.js helps ensure the correct convert.exe is found.

6. Node.js Package Dependencies
7. Install these using npm:
    express: Fast, unopinionated, minimalist web framework for Node.js.
    sqlite3: Asynchronous, non-blocking SQLite3 bindings for Node.js.
    multer: Middleware for handling multipart/form-data, primarily used for uploading files.
    uuid: For generating unique IDs (UUIDs) for files and receipts.
    tesseract.js: Pure JavaScript OCR engine, a port of Tesseract OCR.
    fs/promises: Node.js built-in module for file system operations using Promises (used for unlink).
    child_process: Node.js built-in module for spawning child processes (used to execute ImageMagick's convert.exe).
    pdf-parse: For validating PDF file structure.

Setup and Running the Project:-
1. Prerequisites:-
A. Ensure you have Node.js, npm, and ImageMagick 6.x (with convert.exe and PATH configured) installed as described in the Dependencies section.
B. Installation
C. Clone the repository (if applicable, or create the files as instructed previously).
D. Navigate to the project root directory in your terminal.
E. Install Node.js dependencies: npm install
F. Create necessary directories: The application will automatically create uploads/ for storing PDF files and temp_images/ for temporary image files generated during OCR. However, you can create them manually beforehand if preferred: mkdir uploads, mkdir temp_images
G. Database Initialization: The receipts.db SQLite database and its tables (receipt_file, receipt) will be automatically created the first time you run index.js.

2. To start the server:-
node index.js

3. API Usage
The API runs on http://localhost:3000.
A. Upload Receipt (POST /upload)
Example Request:
curl -X POST -F "receiptFile=@./path/to/your_receipt.pdf" http://localhost:3000/upload
----Success response-
{
    "message": "Receipt uploaded and metadata saved successfully.",
    "fileId": "8fff6008-8bb2-4302-ad7d-80b6bbe90804",
    "fileName": "your_receipt.pdf",
    "filePath": "C:\\Users\\YourUser\\receipt-management-app\\uploads\\8fff6008-8bb2-4302-ad7d-80b6bbe90804.pdf"
}
----Error response-
{
    "message": "No file uploaded."
}
----Or if not a PDF:
{
    "message": "Internal server error during upload.",
    "error": "Only PDF files are allowed!"
}

B. Validate Receipt (POST /validate)
Example Request:
curl -X POST -H "Content-Type: application/json" -d '{"fileId": "8fff6008-8bb2-4302-ad7d-80b6bbe90804"}' http://localhost:3000/validate\

----Example Success Response (Valid PDF):
{
    "message": "File validated successfully.",
    "fileId": "8fff6008-8bb2-4302-ad7d-80b6bbe90804",
    "isValid": true,
    "invalidReason": null
}
----Example Success Response (Invalid PDF):
{
    "message": "File validated successfully.",
    "fileId": "8fff6008-8bb2-4302-ad7d-80b6bbe90804",
    "isValid": false,
    "invalidReason": "Cannot read property 'length' of undefined" // Or other PDF parsing error
}
----Example Error Response:
{
    "message": "File not found.",
    "error": "Error message"
}

C. Process Receipt (POST /process)
Example Request:
curl -X POST -H "Content-Type: application/json" -d '{"fileId": "8fff6008-8bb2-4302-ad7d-80b6bbe90804"}' http://localhost:3000/process
----Example Success Response:
{
    "message": "Receipt processed and data saved successfully.",
    "receiptId": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
    "extractedData": {
        "merchantName": "Grocery Store A",
        "totalAmount": "45.75",
        "purchaseDate": "2024-05-23"
    }
}
----Example Error Response:
{
    "message": "File is not marked as valid. Please validate it first.",
    "invalidReason": "Error parsing PDF"
}
----Or for ImageMagick/OCR issues:
{
    "message": "Internal server error during processing.",
    "error": "OCR processing or PDF conversion failed: PDF conversion failed: Error: Command failed: convert ..."
}

4. Database Schema
The project uses a SQLite database (receipts.db) with two main tables:
    receipt_file table
    receipt table

