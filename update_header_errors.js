const fs = require('fs');
let content = fs.readFileSync('C:\\Users\\josha\\spec-kit\\date-management-app\\backend\\src\\services\\product.service.ts', 'utf8');

// Update header validation error messages to be more informative
content = content.replace(
  /errors\.push\(`Missing required column header for SKU \(acceptable alternatives: (.+)\)`\);/g,
  'errors.push(`Missing required column header for SKU. Acceptable alternatives: $1. Column headers are case-insensitive and leading/trailing spaces are ignored.`);'
);

content = content.replace(
  /errors\.push\(`Missing required column header for Name \(acceptable alternatives: (.+)\)`\);/g,
  'errors.push(`Missing required column header for Name. Acceptable alternatives: $1. Column headers are case-insensitive and leading/trailing spaces are ignored.`);'
);

content = content.replace(
  /errors\.push\(`Missing required column header for Cost \(acceptable alternatives: (.+)\)`\);/g,
  'errors.push(`Missing required column header for Cost. Acceptable alternatives: $1. Column headers are case-insensitive and leading/trailing spaces are ignored.`);'
);

content = content.replace(
  /errors\.push\(`Missing required column header for Barcode \(acceptable alternatives: (.+)\)`\);/g,
  'errors.push(`Missing required column header for Barcode. Acceptable alternatives: $1. Column headers are case-insensitive and leading/trailing spaces are ignored.`);'
);

fs.writeFileSync('C:\\Users\\josha\\spec-kit\\date-management-app\\backend\\src\\services\\product.service.ts', content, 'utf8');
console.log('File updated successfully');