const fs = require('fs');
const path = require('path');
// Use the compiled version of the service
const { ProductService } = require('./backend/dist/services/product.service');

// Create a test CSV with various errors to validate our improved error handling
const testCSVContent = `SKU,Name,Cost,Barcode
TEST001,Product 1,12.99,1234567890123
,Product 2,15.99,1234567890124
TEST003,Product 3,invalid_cost,1234567890125
TEST004,Product 4 with a very long name that exceeds the maximum allowed length for testing purposes,20.99,1234567890126
TEST005,A,B,C
TEST006,Product 6,18.99,123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890
TEST007,Product 7,-5.99,1234567890127
TEST008,Product 8,12.99,
TEST009,Product 9,$12.99,1234567890129`;

// Write the test CSV to a temporary file
const testCSVPath = path.join(__dirname, 'test_csv_with_errors.csv');
fs.writeFileSync(testCSVPath, testCSVContent);

console.log('Testing CSV error handling functionality...');

// Initialize the product service and test CSV processing
const productService = new ProductService();

productService.processCSVUpload(testCSVPath)
  .then(result => {
    console.log('\nCSV Processing Results:');
    console.log(`Imported: ${result.imported}`);
    console.log(`Updated: ${result.updated}`);
    console.log(`Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log('\nError details:');
      result.errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
    }
    
    // Clean up the test file
    fs.unlinkSync(testCSVPath);
    console.log('\nTest completed successfully!');
  })
  .catch(error => {
    console.error('Error during CSV processing:', error);
    
    // Clean up the test file
    if (fs.existsSync(testCSVPath)) {
      fs.unlinkSync(testCSVPath);
    }
  });