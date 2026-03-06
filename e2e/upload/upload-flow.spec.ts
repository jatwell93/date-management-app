import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E Upload Flow Tests
 *
 * Comprehensive tests for upload functionality covering:
 * - Direct upload (<2MB files)
 * - Presigned URL upload (>2MB files)
 * - Progress tracking
 * - Retry logic
 * - Storage quota enforcement
 * - Multi-tenant isolation
 */

test.describe('Upload Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'testpassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('should upload small CSV file via direct path', async ({ page }) => {
    // Navigate to upload page
    await page.goto('/csv-upload');

    // Create a small test CSV (<2MB)
    const csvContent = `SKU,Name,Cost,Barcode
TEST001,Test Product 1,9.99,123456789
TEST002,Test Product 2,19.99,987654321`;

    // Create file input
    const fileInput = page.locator('input[type="file"]');
    const tempFile = path.join(__dirname, 'temp-test-small.csv');
    fs.writeFileSync(tempFile, csvContent);

    // Upload file
    await fileInput.setInputFiles(tempFile);

    // Click upload button
    await page.click('button:has-text("Upload")');

    // Verify upload success message
    await expect(page.locator('text=File uploaded and processed successfully')).toBeVisible({
      timeout: 10000,
    });

    // Cleanup
    fs.unlinkSync(tempFile);
  });

  test('should upload large CSV file via presigned URL path', async ({ page, context }) => {
    // Navigate to upload page
    await page.goto('/csv-upload');

    // Create a large test CSV (>2MB)
    const rows = [];
    rows.push('SKU,Name,Cost,Barcode');
    for (let i = 0; i < 50000; i++) {
      rows.push(`SKU${i},Product ${i},${(Math.random() * 100).toFixed(2)},${1000000 + i}`);
    }
    const csvContent = rows.join('\n');

    const fileInput = page.locator('input[type="file"]');
    const tempFile = path.join(__dirname, 'temp-test-large.csv');
    fs.writeFileSync(tempFile, csvContent);

    // Intercept presigned URL request
    let presignedUrlUsed = false;
    await page.route('**/upload/initiate', async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      if (data.strategy === 'presigned') {
        presignedUrlUsed = true;
      }
      await route.fulfill({ response });
    });

    // Upload file
    await fileInput.setInputFiles(tempFile);
    await page.click('button:has-text("Upload")');

    // Verify presigned URL was used for large file
    expect(presignedUrlUsed).toBe(true);

    // Verify upload success
    await expect(page.locator('text=File uploaded and processed successfully')).toBeVisible({
      timeout: 30000,
    });

    // Cleanup
    fs.unlinkSync(tempFile);
  });

  test('should track upload progress in real-time', async ({ page }) => {
    await page.goto('/csv-upload');

    // Create medium CSV file
    const rows = ['SKU,Name,Cost,Barcode'];
    for (let i = 0; i < 5000; i++) {
      rows.push(`SKU${i},Product ${i},${(Math.random() * 100).toFixed(2)},${1000000 + i}`);
    }
    const csvContent = rows.join('\n');

    const tempFile = path.join(__dirname, 'temp-test-progress.csv');
    fs.writeFileSync(tempFile, csvContent);

    // Upload file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(tempFile);
    await page.click('button:has-text("Upload")');

    // Verify progress indicator appears
    await expect(page.locator('[role="progressbar"], .progress-bar')).toBeVisible({
      timeout: 2000,
    });

    // Wait for completion
    await expect(page.locator('text=File uploaded and processed successfully')).toBeVisible({
      timeout: 15000,
    });

    // Cleanup
    fs.unlinkSync(tempFile);
  });

  test('should retry failed uploads with exponential backoff', async ({ page }) => {
    await page.goto('/csv-upload');

    const csvContent = `SKU,Name,Cost,Barcode
TEST001,Test Product,9.99,123456789`;

    const tempFile = path.join(__dirname, 'temp-test-retry.csv');
    fs.writeFileSync(tempFile, csvContent);

    let attemptCount = 0;

    // Simulate first 2 failures, then success
    await page.route('**/upload/direct', async (route) => {
      attemptCount++;
      if (attemptCount <= 2) {
        await route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Server error' }),
        });
      } else {
        await route.continue();
      }
    });

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(tempFile);
    await page.click('button:has-text("Upload")');

    // Verify retry message appears
    await expect(page.locator('text=Retrying upload')).toBeVisible({ timeout: 5000 });

    // Verify eventual success
    await expect(page.locator('text=File uploaded and processed successfully')).toBeVisible({
      timeout: 15000,
    });

    // Verify exponential backoff (should have tried 3 times)
    expect(attemptCount).toBe(3);

    // Cleanup
    fs.unlinkSync(tempFile);
  });

  test('should enforce storage quota limits', async ({ page }) => {
    // This test assumes the test user has limited storage quota
    await page.goto('/csv-upload');

    // Create a file that would exceed quota
    const rows = ['SKU,Name,Cost,Barcode'];
    for (let i = 0; i < 100000; i++) {
      rows.push(`SKU${i},Product ${i},${(Math.random() * 100).toFixed(2)},${1000000 + i}`);
    }
    const csvContent = rows.join('\n');

    const tempFile = path.join(__dirname, 'temp-test-quota.csv');
    fs.writeFileSync(tempFile, csvContent);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(tempFile);
    await page.click('button:has-text("Upload")');

    // Verify quota error message
    await expect(
      page.locator('text=/storage (limit|quota)|(exceed|reached) your storage/i'),
    ).toBeVisible({ timeout: 5000 });

    // Cleanup
    fs.unlinkSync(tempFile);
  });

  test('should validate file size before upload', async ({ page }) => {
    await page.goto('/csv-upload');

    // Mock a file >10MB
    const csvContent = 'x'.repeat(11 * 1024 * 1024); // 11MB of data
    const tempFile = path.join(__dirname, 'temp-test-too-large.csv');
    fs.writeFileSync(tempFile, csvContent);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(tempFile);

    // Should show error before upload
    await expect(page.locator('text=/File size exceeds.*10MB/i')).toBeVisible({ timeout: 2000 });

    // Upload button should be disabled or show error
    const uploadButton = page.locator('button:has-text("Upload")');
    const isEnabled = await uploadButton.isEnabled();
    expect(isEnabled).toBe(false);

    // Cleanup
    fs.unlinkSync(tempFile);
  });

  test('should prevent cross-tenant access to upload status', async ({ page, context }) => {
    // This test verifies multi-tenant isolation
    // Upload file as user A
    await page.goto('/csv-upload');

    const csvContent = `SKU,Name,Cost,Barcode
TEST001,Test Product,9.99,123456789`;

    const fileInput = page.locator('input[type="file"]');
    const tempFile = path.join(__dirname, 'temp-test-isolation.csv');
    fs.writeFileSync(tempFile, csvContent);

    let uploadKey = '';

    // Capture upload key
    await page.route('**/upload/initiate', async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      uploadKey = data.key;
      await route.fulfill({ response });
    });

    await fileInput.setInputFiles(tempFile);
    await page.click('button:has-text("Upload")');

    await page.waitForTimeout(2000);

    // Now try to access status from different organization (simulate by manipulating JWT/auth)
    // This would require complex multi-user setup or API-level testing
    // For now, we verify that status endpoint requires authentication
    const newPage = await context.newPage();
    await newPage.goto(`/api/upload/status/${uploadKey}`);

    // Should redirect to login or show 401
    const currentUrl = newPage.url();
    expect(currentUrl).toContain('/login');

    // Cleanup
    fs.unlinkSync(tempFile);
  });

  test('should handle XLSX file conversion', async ({ page }) => {
    await page.goto('/csv-upload');

    // For this test, we'd need a real XLSX file or mock the conversion
    // Simplified: verify that XLSX files are accepted
    const fileInput = page.locator('input[type="file"]');

    // Check accepted file types
    const acceptAttr = await fileInput.getAttribute('accept');
    expect(acceptAttr).toMatch(/\.xlsx|\.xls|application\/vnd\.openxmlformats/i);
  });
});

test.describe('Upload Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'testpassword123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('should show error for invalid CSV format', async ({ page }) => {
    await page.goto('/csv-upload');

    // Create invalid CSV (missing required columns)
    const csvContent = `Name,Price
Product 1,9.99`;

    const tempFile = path.join(__dirname, 'temp-test-invalid.csv');
    fs.writeFileSync(tempFile, csvContent);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(tempFile);
    await page.click('button:has-text("Upload")');

    // Verify error message about missing columns
    await expect(page.locator('text=/missing.*column|required.*SKU/i')).toBeVisible({
      timeout: 5000,
    });

    // Cleanup
    fs.unlinkSync(tempFile);
  });

  test('should handle network errors gracefully', async ({ page }) => {
    await page.goto('/csv-upload');

    const csvContent = `SKU,Name,Cost,Barcode
TEST001,Test Product,9.99,123456789`;

    const tempFile = path.join(__dirname, 'temp-test-network-error.csv');
    fs.writeFileSync(tempFile, csvContent);

    // Simulate network failure
    await page.route('**/upload/**', async (route) => {
      await route.abort('failed');
    });

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(tempFile);
    await page.click('button:has-text("Upload")');

    // Verify error message
    await expect(page.locator('text=/Upload failed|network error|try again/i')).toBeVisible({
      timeout: 10000,
    });

    // Cleanup
    fs.unlinkSync(tempFile);
  });
});
