const fs = require('fs');
let content = fs.readFileSync('C:\\Users\\josha\\spec-kit\\date-management-app\\backend\\src\\services\\product.service.ts', 'utf8');
content = content.replace(
  /errors\.push\(`Row \${recordCount}: Invalid cost value - "\${costStr}"\. Must be a positive number\.`\);/g,
  'errors.push(`Row ${recordCount}: Invalid cost value - "${costStr}". Cost must be a positive number. Acceptable formats include: \'12.99\', \'$12.99\', \'€15.50\', \'1,234.56\', \'1.234,56\' (European format).`);'
);
fs.writeFileSync('C:\\Users\\josha\\spec-kit\\date-management-app\\backend\\src\\services\\product.service.ts', content, 'utf8');
console.log('File updated successfully');