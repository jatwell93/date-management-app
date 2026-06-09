# CSV Upload Format Documentation

This document specifies the format and requirements for uploading product data via CSV files to the inventory management system.

## Required Columns

Your CSV file must contain the following four columns. You can use alternative names for these columns as specified below.

### 1. SKU (Stock Keeping Unit)

**Required Column Names:**

- `SKU`
- `Item Code`
- `Reorder Number`
- `Product Code`
- `Item Number`

### 2. Name

**Required Column Names:**

- `Name`
- `Item Description`
- `Product Name`
- `Description`
- `Item Name`

### 3. Cost

**Required Column Names:**

- `Cost`
- `Cost Price`
- `Unit Cost`
- `Item Cost`
- `Cost ex`
- `Price`
- `Unit Price`
- `Cost inc`
- `Selling Price`
- `Retail Price`

### 4. Barcode

**Required Column Names:**

- `Barcode`
- `Alias`
- `EAN`
- `UPC`
- `GTIN`
- `Product Barcode`
- `Barcode Number`

## Column Name Rules

- **Case Insensitive**: Column names are not case-sensitive (e.g., `sku`, `SKU`, and `Sku` are all valid).
- **Whitespace Ignored**: Leading and trailing spaces in column names are ignored.
- **Alternative Names**: Any of the alternative names listed above for each required field are acceptable.

## Data Format Requirements

### SKU Field

- **Length**: Maximum 100 characters
- **Type**: Text or alphanumeric

### Name Field

- **Length**: Maximum 200 characters
- **Type**: Text

### Cost Field

The system supports multiple formats for cost values:

#### Numeric Values

- Basic numbers: `12.99`, `100`, `0.99`, `1000.00`
- With thousands separators: `1,234.56`, `12,345.67`, `1,000,000.99`

#### European Number Format

- Uses dots for thousands separators and commas for decimal: `1.234,56`, `12.345,67`, `1.000.000,99`

#### Currency Symbols

- Currency symbols at the beginning: `$12.34`, `€15.50`, `£12.34`, `¥1234`
- Currency symbols at the end: `12.34$`, `12.34€`, `1234¥`
- Common supported currency symbols:
  - Dollar: `$`
  - Euro: `€`
  - Pound: `£`
  - Yen: `¥`
  - Rupee: `₹`
  - Ruble: `₽`
  - Shekel: `₪`
  - Won: `₩`
  - Naira: `₦`
  - Colon: `₡`
  - Dong: `₫`
  - Hryvnia: `₴`
  - And others: `¢`, `Є`, `₵`, `₸`, `₼`, `₾`, `₯`

#### Currency Abbreviations

- Currency codes: `USD 12.34`, `EUR 12.34`, `GBP 12.34`, `AUD 12.34`, `CAD 12.34`, `JPY 1234`, `RMB 12.34`, `Rp 1.234,56`

#### Complex Currency Representations

- Combining abbreviations with symbols: `AUD$ 1,234.56`, `CAD $1,234.56`
- With spaces: `€ 1.234,56` (spaces are automatically trimmed)

### Barcode Field

- **Length**: Maximum 100 characters
- **Type**: Text or numeric

## Example CSV File

```csv
SKU,Product Name,Cost,Barcode
PROD001,Widget A,$12.99,1234567890123
PROD002,Widget B,€15.50,1234567890124
PROD003,Widget C,GBP 20.75,1234567890125
PROD004,Widget D,¥1000,1234567890126
PROD005,Widget E,AUD$ 35.99,1234567890127
```

Or with alternative headers:

```csv
Item Code,Item Description,Unit Price,GTIN
PROD001,Widget A,12.99,1234567890123
PROD002,Widget B,15.50,1234567890124
PROD003,Widget C,20.75,1234567890125
```

## Error Handling

If your CSV file has issues, the system will return specific error messages:

- **Missing Required Field**: "Row X: Missing required field - [FIELD NAME]. Please ensure the column exists and contains a value."
- **Invalid Cost Value**: "Row X: Invalid cost value - "[VALUE]". Cost must be a positive number. Acceptable formats include: '12.99', '$12.99', '€15.50', '1,234.56', '1.234,56' (European format)."
- **Field Too Long**: "Row X: [FIELD NAME] too long (max [N] characters) - "[VALUE]...". Please ensure the [FIELD NAME] value is [N] characters or fewer."
- **Missing Column Header**: "Missing required column header for [FIELD NAME]. Acceptable alternatives: [LIST OF ALTERNATIVES]. Column headers are case-insensitive and leading/trailing spaces are ignored."
- **Unexpected Columns**: "Row X: Unexpected columns found - [COLUMN NAMES]"

## Technical Notes

- The system processes CSV files using the `csv-parse` library with options for automatic column detection and empty line skipping.
- All data is validated before being saved to the database.
- Products are identified by SKU or barcode - if a product with the same identifier already exists, it will be updated; otherwise, a new product is created.
- Files are automatically cleaned up after processing.
