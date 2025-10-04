const fs = require('fs');
let content = fs.readFileSync('C:\\Users\\josha\\spec-kit\\date-management-app\\backend\\src\\services\\product.service.ts', 'utf8');

// Update SKU length error message
content = content.replace(
  /errors\.push\(`Row \${recordCount}: SKU too long \(max 100 characters\) - "\${sku\.substring\(0, 50\)}\.\.\."`\);/g,
  'errors.push(`Row ${recordCount}: SKU too long (max 100 characters) - "${sku.substring(0, 50)}...". Please ensure the SKU value is 100 characters or fewer.`);'
);

// Update Name length error message
content = content.replace(
  /errors\.push\(`Row \${recordCount}: Name too long \(max 200 characters\) - "\${name\.substring\(0, 50\)}\.\.\."`\);/g,
  'errors.push(`Row ${recordCount}: Name too long (max 200 characters) - "${name.substring(0, 50)}...". Please ensure the Name value is 200 characters or fewer.`);'
);

// Update Barcode length error message
content = content.replace(
  /errors\.push\(`Row \${recordCount}: Barcode too long \(max 100 characters\) - "\${barcode\.substring\(0, 50\)}\.\.\."`\);/g,
  'errors.push(`Row ${recordCount}: Barcode too long (max 100 characters) - "${barcode.substring(0, 50)}...". Please ensure the Barcode value is 100 characters or fewer.`);'
);

fs.writeFileSync('C:\\Users\\josha\\spec-kit\\date-management-app\\backend\\src\\services\\product.service.ts', content, 'utf8');
console.log('File updated successfully');