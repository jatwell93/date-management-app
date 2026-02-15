# Handheld Debugging Guide

**Special note for Pharmacy IT:** If your Zebra/CipherLab devices are running **FRED Mobility** or other kiosk software, see [handheld-devices.md - Special Case: FRED Mobility](handheld-devices.md#special-case-zebra-devices-running-fred-mobility-kiosk-lockdown) for home screen access and launcher configuration.

---

## Quick Start: Enable Debug Mode

The easiest way to debug handheld scanning is to enable **Debug Mode** from your browser:

1. **Open the date-management app**
2. **Add debug parameter to URL:**
   ```
   https://app.example.com/?debug=handheld
   ```
3. **Open browser DevTools:**
   - Press `F12` or right-click > **Inspect**
   - Go to **Console** tab
4. **Scan a barcode:**
   - You should see log messages showing raw keystroke timing and barcode assembly
   - Example:
     ```
     [HW-SCAN] Keystroke received: 'e', timing: 2ms
     [HW-SCAN] Keystroke received: 'a', timing: 3ms
     ...
     [HW-SCAN] Enter detected, barcode complete: 'ean1234567890'
     ```

---

## Testing Keyboard Input Without a Physical Device

### Test in Desktop Browser (Simulation)

1. **Force handheld mode on desktop:**
   - Open the app with: `?forceHandheld=true`
   - The app will now use handheld UI (full-screen scanner, larger buttons)

2. **Simulate keyboard input:**
   - Open DevTools Console (F12)
   - Run this JavaScript snippet to trigger a simulated hardware scan:
   ```javascript
   // Simulate a scan of barcode "1234567890"
   const barcode = '1234567890';
   const delay = 10; // 10ms between keystrokes (hardware speed)
   
   let charIndex = 0;
   const scanInterval = setInterval(() => {
     if (charIndex < barcode.length) {
       const key = barcode.charCodeAt(charIndex);
       const event = new KeyboardEvent('keydown', {
         keyCode: key,
         key: barcode[charIndex],
         bubbles: true
       });
       document.dispatchEvent(event);
       charIndex++;
     } else {
       // Send Enter key at the end
       const enterEvent = new KeyboardEvent('keydown', {
         keyCode: 13,
         key: 'Enter',
         bubbles: true
       });
       document.dispatchEvent(enterEvent);
       clearInterval(scanInterval);
     }
   }, delay);
   ```

3. **Verify scan is received:**
   - Check the app input field—barcode should appear
   - Check console logs for debug output

---

## Debugging by Device Type

### Zebra TC21-HC / TC26-HC (DataWedge)

#### Issue: No keyboard input received

1. **Check DataWedge is running:**
   - Tap **Settings** > **Apps** > **DataWedge** > **App info**
   - Verify app is **Installed** and **Running**
   - If disabled, tap **Enable**

2. **Verify keyboard profile is active:**
   - Tap **Settings** > **DataWedge**
   - Look for a profile marked with a **radio button** (active indicator)
   - If no active profile, tap the radio button next to your profile name

3. **Check keyboard output mode:**
   - In the active profile, go **Output** > **Keyboard**
   - Verify **Enabled** toggle is **ON**
   - Verify **Output mode** is `Keyboard (HID)` or `Keyboard (Emulation)`
   - Try switching to the other mode if one doesn't work

4. **Restart DataWedge:**
   - Tap **Settings** > **Apps** > **DataWedge**
   - Tap **Force Stop**
   - Wait 3 seconds, then open the date-management app again
   - Attempt a scan

5. **Check scan button is enabled:**
   - On the device, press the **Scan button** once
   - You should hear a beep and see a brief icon
   - If nothing happens, the scanner hardware may be disabled

#### Issue: Barcode is truncated or incomplete

1. **Increase keyboard delay:**
   - In DataWedge > active profile > **Output** > **Keyboard**
   - Look for **Keystroke Delay** or **Output Delay**
   - Increase from default (25ms) to 50ms or 100ms
   - Test again

2. **Check barcode symbology:**
   - Verify the barcode format is enabled in DataWedge
   - Example: scanning Code128 requires `Code128` symbology to be active
   - Go **DataWedge** > **Input** > **Scanner** > **Symbology**
   - Enable the formats your pharmacy uses

3. **Disable barcode transformation:**
   - Go **DataWedge** > **Keystroke Output** > **Data Formatting**
   - Set to `Raw` or `Standard` (not `Formatted`)
   - This prevents DataWedge from modifying the barcode

#### Issue: GS1-128 characters stripped

1. **Enable FNC1 character output:**
   - In DataWedge, find **GS1 Settings** or **FNC1**
   - Ensure FNC1 is **Enabled** (required for GS1-128)
   - Set **FNC1 Output Character** to `GS` (ASCII 29) or `Tab` (ASCII 9)
   - The app's GS1 parser will handle the rest

2. **Verify raw barcode content:**
   - Scan a test GS1-128 barcode
   - Check DevTools Console for raw barcode string
   - If the string contains control characters (e.g., special symbols), that's correct—they're FNC1 separators

---

### Honeywell CT45 XP (Enterprise Mobility)

#### Issue: Settings app locked

1. **Unlock with default PIN:**
   - Open **Honeywell Settings** app
   - If prompted for PIN, enter: `1234` (default)
   - If that fails, try: `0000`
   - Contact your Honeywell MDM administrator if still locked

2. **Verify keyboard output mode:**
   - **Honeywell Settings** > **Scanner Configuration**
   - Set **Output format** to `Keyboard (HID)` or `ASCII Keyboard`
   - Toggle **Enable** to ON
   - Tap **Apply**

#### Issue: Incomplete barcode

1. **Check message terminator:**
   - In **Scanner Configuration**, find **Message Terminator**
   - Ensure it's set to **CR** (Carriage Return / Enter)
   - If missing, add it: **CR**
   - Increase **Delay** to 50–100ms

2. **Verify connection to browser:**
   - Restart the device
   - Open the date-management app
   - Open DevTools and scan a barcode
   - Look for keyboard events in Console

---

### CipherLab RS36 (Reader Config)

#### Issue: Reader Config app locked or missing

1. **Unlock with default PIN:**
   - Open **Reader Config** app
   - If prompted, enter: `0000` (default)
   - If locked, perform a **Factory Reset** (contact CipherLab support)

2. **Reinstall if missing:**
   - Open **Play Store**
   - Search: `CipherLab Reader Config`
   - Tap **Install**

#### Issue: Barcode truncated

1. **Check message terminator:**
   - **Reader Config** > your profile > **Output Settings**
   - Find **Message Terminator** or **EOL Character**
   - Set to **CR** (Carriage Return)
   - Increase delay if needed (try 100ms)

2. **Disable data transformations:**
   - Set **Data format** to `Raw`
   - Uncheck any "Formatting" or "Transformation" options

---

## Inspecting Raw Keyboard Events

To see exactly what the device is sending to the browser, use this DevTools snippet:

```javascript
// Log all keyboard events (press Ctrl+Shift+K in console to stop)
let keylogEnabled = true;
let scanBuffer = '';

document.addEventListener('keydown', (e) => {
  if (!keylogEnabled) return;
  
  if (e.key === 'Enter') {
    console.log(`[SCAN-END] Complete: "${scanBuffer}"`);
    scanBuffer = '';
  } else {
    scanBuffer += e.key;
    console.log(`[KEY] char="${e.key}", code=${e.keyCode}, timing=${Date.now()}`);
  }
});

console.log('Keyboard logging started. Scan a barcode, then run: keylogEnabled = false');
```

**Output example:**
```
[KEY] char="1", code=49, timing=1708034520123
[KEY] char="2", code=50, timing=1708034520129
[KEY] char="3", code=51, timing=1708034520134
[KEY] char="4", code=52, timing=1708034520139
[SCAN-END] Complete: "1234"
```

If the timing between keystrokes is >50ms, the app will treat it as human typing (not a hardware scan).

---

## Testing GS1-128 Barcode Parsing

If your pharmacy uses GS1-128 barcodes with expiry dates, batch numbers, etc.:

### Verify GS1 Parsing is Working

1. **Scan a GS1-128 barcode:**
   - Point device at a pharmaceutical barcode containing **(17)** (expiry date)
   - Open DevTools Console
   - Check for logs like:
     ```
     [GS1-PARSE] Parsed: {
       gtin: "937939393141",
       batch: "256",
       expiryDate: "2021-09-21",
       serial: "256"
     }
     ```

2. **Verify expiry date auto-population:**
   - On the **Scan Page**, look for the **Expiry Date** field
   - After scanning a GS1-128 barcode, this field should auto-fill with the parsed expiry date
   - If it's empty or wrong, check:
     - The barcode actually contains a **(17)** AI
     - The format is YYMMDD (example: `210921` = September 21, 2021)

3. **Test GS1 parser directly:**
   ```javascript
   // Import the GS1 parser (assumes it's exported globally or in a test utility)
   const { parseGS1Barcode } = window; // or require from test utils
   
   // Test with a sample GS1-128 barcode
   const result = parseGS1Barcode('0193939393141710B256092121B256');
   console.log('Parsed:', result);
   ```

   Expected output:
   ```javascript
   {
     gtin: "937939393141",
     batch: "256",
     expiryDate: "2021-09-21",
     serial: "256"
   }
   ```

---

## Network Inspection: Verify Sync

After a scan, the app should sync the inventory data to the server. To verify:

1. **Open DevTools Network tab:**
   - Press F12 > **Network** tab
   - Refresh the app

2. **Perform a scan:**
   - Scan a barcode in the handheld app
   - Look for a network request in the Network tab (typically a POST to `/api/inventory` or `/api/scans`)

3. **Check sync status:**
   - The **Sync Status** indicator (bottom-right of handheld UI) should show:
     - `Syncing...` while upload is in progress
     - `Synced` when successful
     - `Sync Failed` if the request failed

4. **Debug failed syncs:**
   - Check **Network** tab for the failed request
   - Click the request to see:
     - Response status (should be 200 for success, 401 for auth issues, 500 for server errors)
     - Response JSON details
   - Common failures:
     - **401 Unauthorized:** App session expired; log out and log back in
     - **400 Bad Request:** Malformed barcode or missing required fields
     - **500 Server Error:** Contact backend support

---

## Performance: Measuring Sync Time

To measure how long syncs are taking:

1. **Monitor sync strategy:**
   - **Real-time mode:** Should sync <2 seconds per barcode (from hardware input to server response)
   - **Batch mode:** Accumulates 10 minutes of scans, then syncs all at once
   - **Manual mode:** Only syncs when user taps **Sync Now** button

2. **Check browser DevTools Performance tab:**
   - Open **Performance** tab
   - Start recording
   - Scan a barcode
   - Stop recording
   - Look for network timeline—should show single POST request taking <2s

3. **Enable server-side logging (if admin):**
   - Ask a backend admin to check server logs for this user's sync requests
   - Look for timing details (how long the server took to process)

---

## Test Data: Barcode Fixtures

Use these barcodes to test different scanner capabilities:

### EAN-13 (Standard UPC)
```
5901234123457    (7-digit)
978020137962     (ISBN-10 style, valid EAN-13)
```

### Code128
```
GS1 PHARMACY 2026  (simple text)
LOT-B256-EXP-2026  (with dashes and letters)
```

### GS1-128 (Pharmaceutical)
```
0137939393141710B256092121B256
```
Parses to:
- **GTIN:** 937939393141
- **Batch:** B256
- **Expiry:** Sept 21, 2021
- **Serial:** B256

---

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| **No keyboard events appear in console** | Device keyboard output is disabled or misconfigured | Check device settings (DataWedge/Honeywell/Reader Config); verify keyboard output is enabled |
| **Events appear but barcode incomplete** | Keystroke delay too short | Increase device keystroke delay to 50–100ms |
| **App doesn't detect as handheld** | Desktop or screen size doesn't match handheld thresholds | Use `?forceHandheld=true` URL parameter to force handheld mode; verify screen ≤600×800px |
| **GS1 parsing returns empty fields** | FNC1 characters not included in barcode | Ensure device outputs FNC1 character (usually ASCII 29 or GS); check device GS1 settings |
| **Sync fails immediately after scan** | Network issue or authentication expired | Check WiFi connection, verify device can reach server, log out and log back in if session expired |
| **Duplicate scans submitted** | User scanned twice or Enter key repeated | This is normal—app deduplicates within 2-second window (only submits once) |
| **Slow sync (>5 seconds per barcode)** | Network congestion or server overload | Check device WiFi signal strength; try batch or manual sync mode; contact admin if persistent |

---

## Advanced: Manual Keyboard Event Injection

If you need to test the app's keyboard handling without a real device:

```javascript
// Helper function to simulate a complete barcode scan
function simulateScan(barcode, delayBetweenChars = 10) {
  return new Promise((resolve) => {
    let i = 0;
    
    const scanInterval = setInterval(() => {
      if (i < barcode.length) {
        const char = barcode[i];
        const event = new KeyboardEvent('keydown', {
          key: char,
          code: `Key${char.toUpperCase()}`,
          keyCode: char.charCodeAt(0),
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(event);
        i++;
      } else {
        // Send Enter to end the scan
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(enterEvent);
        clearInterval(scanInterval);
        resolve();
      }
    }, delayBetweenChars);
  });
}

// Usage:
// simulateScan('1234567890', 10); // Scan with 10ms delay
// simulateScan('0137939393141710B256092121B256', 10); // GS1-128 barcode
```

---

## Getting Help

If none of the above solutions work:

1. **Check the Device Config Guide:** [handheld-devices.md](handheld-devices.md)
2. **Gather debug information:**
   - Device model (Zebra TC21-HC, Honeywell CT45 XP, CipherLab RS36)
   - App version (bottom of **Settings** page)
   - Browser and version (Chrome, Firefox, Safari)
   - Screenshot of DevTools Console output
   - Network request details (status, response)

3. **Contact support with:**
   - Description of the issue (what were you trying to do?)
   - Device type and OS version
   - Debug logs from DevTools Console
   - Network request screenshot from DevTools

---

**Last Updated:** February 2026  
**Documentation Version:** 1.0  
**Target App Version:** 1.1.0+ (PDT integration release)
