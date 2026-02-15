# Handheld Troubleshooting Guide

Quick reference for common issues when using the date-management app on pharmacy PDT devices.

---

## Zebra Kiosk / EHS Lockdown (FRED Mobility, Enterprise Home Screen, MDM)

Your Zebra device is likely in **kiosk mode**, which restricts home screen access. This is common in pharmacy environments using FRED Mobility or Zebra EHS.

**Important:** There is no user-accessible "exit" trick without admin authorization. Kiosk mode is designed to block the home screen. Only the **pharmacy IT or device owner** can unlock it or provide an admin PIN.

### Issue: Can't access Android home screen (locked in FRED or EHS)

**Symptoms:**
- Device only shows FRED Mobility or a locked screen
- No navigation bar (triangle/circle/square) at bottom
- Back/Home buttons don't work
- Can't access Settings or DataWedge

**Root Cause:**
- Zebra EHS, FRED Mobility, or another MDM is configured to lock the device
- [Zebra EHS documentation confirms: HOME/BACK can be blocked entirely](https://techdocs.zebra.com/ehs/latest/guide/features/)

**Solution:**

1. **Identify the locking mechanism:**
   - Ask your pharmacy IT: "Is this device using Zebra EHS, FRED Mobility, or another MDM?"
   - OR they can check: **Settings** → **Apps** → **Default apps** → **Home app** (shows the active launcher)

2. **If IT provides admin access, try authorized exit paths:**
   - **EHS Admin Login:** Open launcher menu (three dots) > **Tools** > **Admin Login**, enter the admin PIN, then set **Default Home App** to **Quickstep**
   - **SOTI MobiControl:** Long-press **Back** for 3-5 seconds to reveal admin login (if enabled)
   - **Hidden admin prompt (model-dependent):** Some Zebra devices accept key sequences like `Shift` + `Blue` + `0` or `Shift` + `Blue` + `Up` to show admin login
   - If these are blocked, proceed to the IT unlock request

3. **Request temporary unlock from pharmacy IT:**
   - **For Zebra EHS:** Ask IT to disable kiosk profile or expose Android home screen
   - **For FRED Mobility:** Ask IT to whitelist your app domain in FRED, or temporarily unlock the device
   - **For other MDM:** Ask IT to use their MDM console to exit kiosk mode temporarily
   - See detailed requests in [handheld-devices.md - Special Case: Step 3](handheld-devices.md#step-3-request-it-to-temporarily-unlock-required-for-app-testing)

4. **Alternatively, ask IT to whitelist your app inside the kiosk:**
   - If they don't want to unlock, ask them to add your app URL to the approved list
   - For FRED: Create a browser launcher pointing to your app
   - For EHS: Add your app to the allowed app list
   - This avoids any unlock but requires IT's direct action

### Issue: DataWedge not configured or keyboard output disabled

**Symptoms:**
- Barcode scanner button works (device beeps or vibrates)
- Input does NOT appear in the app
- No DataWedge profile exists, or profile has keyboard disabled

**Root Cause:**
- DataWedge doesn't have an active profile with keyboard output enabled
- Device is locked in kiosk and you can't access Settings to configure it

**Solution:**

1. **Ask pharmacy IT to verify DataWedge setup:**
   ```
   Can you check if DataWedge is configured on this Zebra device?
   1. Open Settings > DataWedge
   2. Is there an active profile (radio button selected)?
   3. In that profile, is Output > Keyboard > Enabled = ON?
   ```

2. **If DataWedge profile exists and keyboard is enabled:**
   - Open your app and test barcode scanning
   - Input should now appear
   - If not, the profile may be using a different output method (not keyboard)

3. **If DataWedge doesn't exist or keyboard is disabled:**
   - IT needs to temporarily unlock the device (see Step 1 above)
   - [Follow DataWedge configuration steps](handheld-devices.md#datawedge-configuration-ui-method)
   - Enable keyboard output
   - Test barcode scanning
   - Lock the device back down

### Issue: Barcode scanning works in FRED but not in our app

**Symptoms:**
- Pharmacy's point-of-sale or other app receives barcode input fine
- Your web app does NOT receive barcode input
- Device is running FRED Mobility

**Root Cause:**
- FRED's kiosk launcher may restrict keyboard input to FRED apps only
- Your web app may not have focus/permission in the browser sandbox

**Solution:**

1. **Verify the app is accessible from FRED:**
   - Is your app whitelisted in FRED's approved domains?
   - Ask IT to check FRED's web launcher / whitelist settings

2. **Test keyboard input focus:**
   - In your web app, make sure an input field has focus (is selected)
   - Scan a barcode
   - Does anything appear? (even in browser console if not in input field)

3. **If DataWedge is working in FRED but not your app:**
   - DataWedge may be outputting to a specific app intent/action instead of keyboard input
   - Ask IT to verify DataWedge profile is set to `Output: Keyboard (HID)` or `Keyboard (Emulation)` (not an app-specific intent)

4. **Last resort: Request DataWedge reconfiguration**
   - Temporarily unlock device and [reconfigure DataWedge](#zebra-tc21-hc--tc26-hc-datawedge) from scratch
   - Ensure **Output > Keyboard > Enabled: ON**

### Issue: CipherLab device locked in kiosk/launcher mode

**Symptoms:**
- Device only shows CipherLab Kiosk or Reader Config interface
- No Android home screen visible
- Back/Home buttons don't work
- Can't access Settings or install apps

**Root Cause:**
- CipherLab kiosk mode is configured by the device admin
- Android navigation is locked or remapped to stay in kiosk

**Solution:**

1. **Check if there's a PIN to unlock:**
   - Try default PIN: `0000`
   - If that works, long-press settings or home to unlock
   - If wrong PIN, contact device owner/admin

2. **Try logout/exit button:**
   - Look for **Logout** or **Exit** in CipherLab UI
   - If available, tap it and see if home screen becomes accessible

3. **If fully locked, contact CipherLab admin:**
   - Ask them to temporarily unlock the device (1-2 hours) for testing, OR
   - Ask them to whitelist your app domain in CipherLab's approved app list
   - Request they create a browser launcher pointing to your app URL
   - See detailed request template in [handheld-devices.md - CipherLab Unlock Request](handheld-devices.md#request-unlock-from-cipherlab-admin)

---

## Setup Issues

### Issue: App won't install on device

**Symptoms:** "Add to Home Screen" option is missing or grayed out

**Causes & Solutions:**

1. **HTTPS is not enabled on production URL**
   - PWAs require HTTPS (not HTTP)
   - Check that your production domain uses HTTPS
   - If self-signed cert, ensure device trusts the certificate
   - **Fix:** Deploy to HTTPS-enabled server (e.g., Cloudflare with HTTPS enabled)

2. **Browser doesn't support PWA installation**
   - Ensure device is using Chrome or a chromium-based browser
   - Older Android devices may not support PWA
   - **Fix:** Update browser to latest version; try Chrome latest stable

3. **Cached old version blocking installation**
   - Browser cache may have old app metadata
   - **Fix:** Open DevTools (F12), **Application** tab, **Service Workers**, clear cache; then refresh

**Quick Test:**
```bash
# Verify production domain has HTTPS and service worker
curl -I https://your-app.example.com
# Look for: "HTTP/2" or "HTTP/1.1" with status 200
```

---

## WiFi & Connectivity Issues

### Issue: Device can't connect to pharmacy WiFi

**Symptoms:** Internet doesn't work; WiFi shows connected but pages won't load

**Causes & Solutions:**

1. **Network credentials are wrong**
   - Pharmacy WiFi often requires username + password (WPA2-Enterprise)
   - Device may have old credentials cached
   - **Fix:** 
     - Go to **Settings** > **Network & Internet** > **WiFi**
     - Long-press the network name > **Forget**
     - Reconnect with correct password

2. **Device is out of range or signal is weak**
   - Barcode scanners have interference that blocks WiFi
   - Device may be in a dead zone
   - **Fix:** Move closer to WiFi router; ensure barcode scanner is not on same frequency as WiFi

3. **ISP or pharmacy router has firewall blocking HTTPS connections**
   - Some enterprise firewalls intercept HTTPS
   - **Fix:** Contact pharmacy IT to whitelist your app domain; ensure HTTPS certificate is trusted

**Quick Test (on device):**
```
Open Chrome
Try visiting any HTTPS website (e.g., google.com)
- If it works, HTTPS is available
- If it fails, WiFi/network issue OR HTTPS is blocked by firewall
```

---

## Barcode Scanning Issues

### Issue: Barcode scanner doesn't work

**Symptoms:** Press scan button, nothing happens OR button works but no text appears in app

**Device-specific fixes:**

**Zebra TC21-HC / TC26-HC:**
1. Verify DataWedge is **Active**:
   - **Settings** > **DataWedge**
   - Look for a profile with a selected **radio button**
   - If none, tap a radio button to activate a profile
   
2. Verify keyboard output is enabled:
   - **DataWedge** > active profile > **Output** > **Keyboard** > toggle **Enabled**
   
3. Restart DataWedge:
   - **Settings** > **Apps** > **DataWedge** > **Force Stop**
   - Wait 3 seconds
   - Try scanning again

**Honeywell CT45 XP:**
1. Verify keyboard output is enabled:
   - **Honeywell Settings** > **Scanner Configuration** > toggle **Enable**
   - Verify **Output format** is `Keyboard ASCII` or `Keyboard HID`
   
2. Unlock settings if needed:
   - If prompted for PIN, enter `1234` (default)
   
3. Restart device:
   - Power off device completely
   - Wait 10 seconds
   - Power on and retry scanning

**CipherLab RS36:**
1. Verify Reader Config has keyboard output enabled:
   - **Reader Config** app > your profile
   - **Output Settings** > toggle **Enable**
   - **Data format** should be `Raw`
   
2. Unlock Reader Config if needed:
   - Default PIN is `0000`
   - If locked, contact CipherLab support for factory reset
   
3. Verify the profile is set as **Default**:
   - Tap your profile > **Set as Default**
   - Restart the app

**All Devices:**
- **Check barcode format:** Ensure you're scanning a supported barcode type (Code128, EAN-13, GS1-128)
- **Check barcode quality:** Damaged or faded barcodes won't scan; try a new barcode
- **Check scanner is enabled:** Physical scanner module may be disabled in device OS settings

---

### Issue: Barcode is incomplete or truncated

**Symptoms:** Scan a barcode that's supposed to be 13 digits, but only get 8–10 digits

**Causes:**

1. **Keystroke delay is too short**
   - Device is sending keystrokes too fast and some are getting lost
   - **Fix (Zebra):**
     - **DataWedge** > active profile > **Output** > **Keyboard**
     - Increase **Keystroke Delay** from 25ms to 50–100ms
   
   - **Fix (Honeywell):**
     - **Honeywell Settings** > **Scanner Configuration**
     - Increase **Output Delay** or **Keystroke Delay** to 50–100ms
   
   - **Fix (CipherLab):**
     - **Reader Config** > profile > **Output Settings**
     - Increase **Message Terminator Delay** to 50–100ms

2. **Browser is dropping fast keyboard events**
   - Rare, but can happen under heavy load
   - **Fix:** Close other browser tabs; restart the app

---

### Issue: Extra characters or symbols in barcode

**Symptoms:** Scan "1234567890" but get "1234567890PQ" or special characters mixed in

**Causes:**

1. **DataWedge is adding prefix/suffix**
   - **Fix (Zebra):**
     - **DataWedge** > active profile > **Output** > **Keyboard**
     - Set **Prefix** and **Suffix** to empty (blank)
   
   - **Fix (Honeywell):**
     - **Honeywell Settings** > **Scanner Configuration**
     - Find **Message Prefix/Suffix** > set both to empty
   
   - **Fix (CipherLab):**
     - **Reader Config** > profile > **Output Settings**
     - Clear any **Prefix** or **Suffix** fields

2. **Barcode transformation is enabled**
   - Device is modifying the barcode (adding checksums, formatting, etc.)
   - **Fix:** Set device output to **Raw** or **Standard** format (not **Formatted**)

---

### Issue: GS1-128 pharmaceutical barcode isn't parsed

**Symptoms:** Scan a pharmaceutical barcode with expiry date, but the **Expiry Date** field doesn't auto-fill

**Causes:**

1. **FNC1 separator characters are being stripped**
   - GS1-128 uses FNC1 (ASCII 29 or GS) to separate fields
   - Some device configs strip these characters
   - **Fix (Zebra):**
     - **DataWedge** > **GS1 Parsing** > toggle **Enable**
     - Or: **Keystroke Output** > **FNC1** > set to **GS** (ASCII 29)
   
   - **Fix (Honeywell):**
     - **Honeywell Settings** > **Scanner Configuration**
     - Find **GS1 Mode** > set to **Enabled** or **Use FNC1**
   
   - **Fix (CipherLab):**
     - **Reader Config** > **Symbology** > select **GS-128** (GS1-128 variant)
     - Ensure **Data format** is `Raw` (not transformed)

2. **Barcode doesn't actually contain GS1 format**
   - Verify the barcode is GS1-128 (not just Code128)
   - GS1-128 barcodes contain Application Identifiers like **(01)** and **(17)**
   - **Fix:** Scan a different GS1-128 barcode to verify; ask pharmacy to confirm barcode format

3. **GS1 parser in app isn't working**
   - Rare, but the front-end GS1 parsing logic may have a bug
   - **Debug:** See [Handheld Debug Guide - Testing GS1-128 Barcode Parsing](handheld-debug-guide.md#testing-gs1-128-barcode-parsing)

---

## Sync Issues

### Issue: Sync fails with "Network Error" or "Offline"

**Symptoms:** Barcode scans, but sync status shows red X or "Sync Failed"; data doesn't appear in the dashboard

**Causes & Solutions:**

1. **Device lost WiFi connection**
   - **Check WiFi status:**
     - Swipe down from top > see if WiFi icon is enabled
     - If not, tap WiFi icon to reconnect
   - **Fix:** Reconnect to pharmacy WiFi; then tap **Sync Now** button to retry

2. **App session expired (need to log back in)**
   - Long scanning sessions may expire auth token
   - **Check:** Look at app, are you still logged in? See your username in toolbar?
   - **Fix:**
     - Tap **Settings** > **Log Out**
     - Log back in with your credentials
     - Then tap **Sync Now** to retry

3. **Server is unreachable or down**
   - Production server may be offline
   - **Check:** On desktop, try opening the app URL in a browser
   - **Fix:** Wait a few minutes and retry; contact admin if server is down

4. **Sync strategy is set to Manual or Batch**
   - Real-time mode syncs every scan immediately
   - Batch mode accumulates scans and syncs every 10 minutes
   - Manual mode only syncs when you tap **Sync Now**
   - **Check sync strategy:**
     - Bottom-right of handheld toolbar, look for **Sync Strategy** selector
     - If set to Batch or Manual, that's why sync is delayed
   - **Fix:** Change to **Real-time** for immediate syncs

**Advanced: Check Network Events**
1. Open DevTools (F12) > **Network** tab
2. Scan a barcode
3. Look for a POST request in the Network tab
4. Click the request to see:
   - **Status:** Should be `200` (success)
   - **Response:** Should show recently scanned items
   - If status is `401`: Session expired—log back in
   - If status is `500`: Server error—contact admin
   - If no request appears: Device WiFi is off or unreachable

---

### Issue: Duplicate scans submitted

**Symptoms:** Scanned once, but product appears twice in inventory

**This is normal behavior.** The app deduplicates within a 2-second window. If two identical scans are submitted >2 seconds apart, both are recorded (in case user intentionally scanned twice).

**If duplicates are unexpected:**
1. Verify your sync strategy is set to **Real-time** (not Manual, which might accumulate)
2. Ensure the 2-second dedup window is active
3. Contact admin if duplicates persist

---

## Performance Issues

### Issue: App is slow or freezing

**Symptoms:** Takes >5 seconds to respond to button taps; app becomes unresponsive after many scans

**Causes & Solutions:**

1. **Too many scans in local queue**
   - After scanning hundreds of items offline, IndexedDB gets large
   - **Fix:** Perform a full sync (tap **Sync Now**); then clear old data (Settings > Clear Cache)

2. **Browser process is using too much memory**
   - Long-running app session may accumulate garbage
   - **Fix:** Close and reopen the app (swipe it away in recents, then tap icon to relaunch)

3. **WiFi is congested**
   - Many connected devices on same network
   - Sync requests are being rate-limited or delayed
   - **Fix:** Move closer to router; use 5GHz band if available; contact IT for network prioritization

4. **Device CPU is maxed out**
   - Running another CPU-intensive app in background
   - **Fix:** Close other apps; use barcode scanning app in isolation

**Quick Performance Test:**
```javascript
// In DevTools Console, measure response time
const start = performance.now();
// [Perform an action: scan barcode, button tap, etc.]
const end = performance.now();
console.log(`Action took ${end - start}ms`);
```

Target: <1000ms per action (1 second)

---

## UI/Display Issues

### Issue: UI is too small or hard to read on 5" screen

**Symptoms:** Buttons are tiny, text is hard to read, touch targets are too close together

**This is a UX bug.** Please report with:
- Device model (Zebra TC21-HC, Honeywell CT45 XP, CipherLab RS36)
- Screen size (diagonal inches + resolution)
- Which component is too small (buttons, text, fields)

**Temporary workarounds:**
1. Zooming in (Ctrl++ on desktop; pinch on device)—may cause layout issues
2. Using landscape orientation if available (toggle in device settings)
3. Switching to desktop version (remove `?forceHandheld=true` from URL)

---

### Issue: Camera scanner not working (QR code feature)

**Symptoms:** If attempting to scan QR codes instead of barcodes, camera doesn't start

**Causes & Solutions:**

1. **Camera permission was denied**
   - Device asked for permission; user tapped "Don't allow"
   - **Fix:**
     - Go **Settings** > **Apps** > **[Your Browser]** > **Permissions** > **Camera**
     - Toggle **Camera** ON
     - Refresh the app

2. **Device doesn't have a forward-facing camera**
   - Some industrial handhelds only have rear-facing barcode scanner, not front-facing camera
   - **This is expected.**—Camera features are optional

3. **Camera is in use by another app**
   - Device may have barcode scanner driver monopolizing camera hardware
   - **Fix:** Close other running apps; restart device if necessary

---

## Authentication Issues

### Issue: "Unauthorized" or "Login required" after scanning

**Symptoms:** Sync fails with 401 error; barcode scans aren't saved

**Causes & Solutions:**

1. **Session token expired**
   - Long scanning session (>30 min) may expire auth token
   - **Fix:**
     - Tap **Settings** > **Log Out**
     - Log back in
     - Continue scanning

2. **Browser cookies were cleared**
   - Clearing browser cache sometimes clears auth cookies
   - **Fix:** Log out and log back in

3. **Account was deactivated or permissions changed**
   - Admin may have revoked access
   - **Fix:** Contact your admin to verify your account is active

---

## Battery & Power Issues

### Issue: Battery drains quickly

**Symptoms:** Battery goes from 100% to 20% in 1–2 hours of scanning

**Expected behavior:** Barcode scanning uses significant power:
- Camera/scanner hardware: 15–25% / hour
- WiFi/sync: 5–10% / hour
- **Expected drain:** 20–30% per 2 hours

**If drain is worse than expected:**

1. **WiFi signal is weak**
   - Device retries WiFi connection repeatedly, draining battery
   - **Fix:** Move closer to router; ensure strong WiFi signal

2. **Screen brightness is at maximum**
   - Pharmacy devices typically run bright for sunlight readability
   - **Fix:** Reduce screen brightness in device settings (Settings > Display > Brightness)

3. **Continuous scanning / app running in background**
   - Real-time sync is enabled and pushing all scans to server
   - **Fix:** Switch to Batch sync mode (10-min intervals) to reduce power usage

**Battery optimization tip:** Use **Batch sync mode** (10-minute intervals) for all-day scanning without needing to charge.

---

## Reporting an Issue

If you encounter a problem not covered here:

1. **Gather debug information:**
   - Device model and OS version (Settings > About)
   - App version (Settings > Handheld Info)
   - Screenshot of the error
   - Browser DevTools Console output (F12 > Console > take screenshot)
   - Network tab screenshot (F12 > Network > perform failing action)

2. **Check the detailed guides:**
   - **[Handheld Device Configuration](handheld-devices.md)** - Per-device setup
   - **[Handheld Debug Guide](handheld-debug-guide.md)** - Advanced troubleshooting
   - **[Handheld Testing Guide](handheld-testing.md)** - Test procedures

3. **Contact support with:**
   - Brief description of the issue
   - Device model, OS version
   - Steps to reproduce the problem
   - Debug logs from DevTools Console
   - Network request details

---

## Quick Reference: Common Fixes

| Issue | Quick Fix |
|-------|-----------|
| **Device won't connect to WiFi** | Forget network, reconnect with correct password |
| **Barcode scanner not working** | Restart DataWedge/Reader Config; verify keyboard output enabled |
| **Barcode incomplete** | Increase device keystroke delay to 50–100ms |
| **GS1 fields not parsed** | Enable FNC1 or GS1 mode in device settings |
| **Sync fails** | Reconnect WiFi, log out and log back in |
| **App freezes** | Close app completely, reopen |
| **UI too small** | Use `?forceHandheld=true` to enable full handheld mode |
| **Battery drains fast** | Reduce screen brightness, switch to Batch sync mode |
| **Session expired** | Log out and log back in |

---

**Last Updated:** February 2026  
**Documentation Version:** 1.0  
**Target App Version:** 1.1.0+ (PDT integration release)
