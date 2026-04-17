# Handheld PDT Device Configuration Guides

This document provides step-by-step configuration instructions for integrating pharmacy PDT (Portable Data Terminal) devices with the date-management app.

The app supports three major vendor platforms via keyboard wedge barcode input:

- **Zebra TC21-HC / TC26-HC** (most common in pharmacy chains)
- **Honeywell CT45 XP** (alternative enterprise option)
- **CipherLab RS36** (compact, budget-friendly)

---

## General Concepts

### Keyboard Wedge Mode

All three vendors emit barcode scans as rapid keyboard inputs (keystrokes) that simulate a physical keyboard. The app detects hardware scans by:

1. Capturing `keydown` events on the document
2. Timing rapid keystroke sequences (multiple keystrokes within 50ms)
3. Recognizing an `Enter` key press as the barcode end marker
4. Distinguishing hardware input from human typing based on timing thresholds

**Key Parameters:**

- **Timing threshold:** 50ms (hardware scans are much faster than human typing)
- **Deduplication window:** 2 seconds (prevents duplicate submissions on rapid Enter presses)
- **End marker:** Enter/Return key

---

## Special Case: Zebra Devices in Kiosk / EHS Lockdown Mode

### What Is Kiosk / Enterprise Home Screen (EHS)?

Your Zebra device may be **locked to a single app or launcher** by one of these mechanisms:

1. **Zebra Enterprise Home Screen (EHS)** — [Official Zebra docs](https://techdocs.zebra.com/ehs/latest/guide/features/)
   - Native Zebra kiosk manager that restricts devices to approved apps only
   - Can block HOME/BACK buttons entirely
   - Configured via MDM (Mobile Device Management) profile

2. **FRED Mobility launcher** — [FRED login docs](https://webhelp.fred.com.au/fredoffice/MOB/new-mobility-login-logout.htm)
   - Retail/pharmacy-specific kiosk platform that locks the device to FRED's interface
   - Only allows launching FRED apps or whitelisted domains
   - Owned and controlled by the pharmacy (or their FRED reseller)

3. **Other MDM systems** — SOTI, MobileIron, Miradore, or custom kiosk
   - Each has its own way of locking and unlocking devices
   - [Miradore example: Temporarily exiting home screen mode](https://www.miradore.com/knowledge/android/temporarily-exiting-the-home-screen-in-the-home-screen-only-or-kiosk-mode-with-multiple-apps-configuration-type/)

**The situation:** You cannot "trick" your way out of kiosk mode. If the device is locked, there is no generic home button combination or back gesture that will work. [Zebra explicitly designs EHS to prevent this](https://techdocs.zebra.com/ehs/latest/guide/features/).

---

### Step 1: Confirm What's Actually Locking Your Device

Before attempting anything, **ask your pharmacy IT team or device owner:**

> "Are these Zebra handhelds configured with Zebra EHS, another MDM (SOTI/MobileIron/Miradore), or FRED Mobility as the default launcher? I need to know so I can request the right unlock."

If they're unsure, they can check:

1. Open **Settings** → **Apps** → **Default apps** → **Home app**
   - If you see `Enterprise Home Screen`, `EHS`, or a similar name: it's Zebra EHS
   - If you see `FRED Mobility`: it's FRED Mobility
   - If you see something else: it's another MDM system

2. [Check Zebra EHS documentation](https://techdocs.zebra.com/ehs/4-0/guide/features/) to see if navigation bar is hidden
   - If the **bottom navigation bar (triangle, square, circle) is completely gone**, kiosk is fully locked
   - If it's still visible, you may have partial access

---

### Step 2: Try User-Level Options (May Work If Kiosk Is Partially Locked)

If your pharmacy IT hasn't explicitly locked down ALL navigation:

**In FRED Mobility itself:**

1. Look for a **Logout** or **Exit** button in FRED's menu
2. [Check FRED webhelp for logout steps](https://webhelp.fred.com.au/fredoffice/MOB/new-mobility-login-logout.htm)
3. After logout, see if an **"Exit to Android" or "Back to Home"** option appears
4. If successful, you'll see the Android home screen

**Authorized admin exit (EHS/SOTI only, if IT provides access):**

1. If the kiosk launcher shows a menu (often three dots), open **Tools** or **Admin Login**
2. Enter the admin PIN provided by pharmacy IT
3. Once in admin mode, open **Settings** and switch the default home app to **Quickstep**
4. Press Home to return to the native Android launcher

**If the admin menu is hidden (model-dependent):**

- Some Zebra configs allow an admin prompt using hardware keys (examples reported in the field: `Shift` + `Blue` + `0`, `Shift` + `Blue` + `Up`, `Shift` + `Blue` + `Space`)
- These sequences are often disabled in strict kiosk mode and require an admin PIN
- Do not attempt without authorization from the device owner

**SOTI MobiControl (if in use):**

- Long-press **Back** for 3-5 seconds to reveal an admin login prompt
- Some builds allow a swipe-up gesture to show the Android nav bar
- These require admin credentials and may be disabled by policy

**Physical/soft keys (if partially accessible):**

1. If you can see the **navigation bar** (triangle/circle/square) at the bottom:
   - Long-press **Home** (circle) or **Back** (triangle) to bring up recent apps
   - If recent apps opens, you may be able to exit FRED

2. On some older FRED Mobility devices (legacy Windows/Android hybrids):
   - Try **blue/Function key + Talk/Start key** to access the start menu
   - ([Legacy FRED manual example](https://webhelp.fred.com.au/fredoffice/archive/Fred-Mobility-MC55A-User-Manual.pdf))

3. If **no navigation bar is visible at all**: kiosk is fully locked — skip to Step 3

---

### Step 3: Request IT to Temporarily Unlock (Required for App Testing)

If Steps 1 and 2 don't work, you need **pharmacy IT or device admin assistance**. Here's what to ask them:

#### Request Option A: Disable Kiosk Profile Temporarily

**If using Zebra EHS:**

```
Can you please:
1. Disable the EHS profile temporarily so the standard Android launcher is visible, OR
2. Remove FRED Mobility from the EHS allowed app list so we can access the home screen?

We need about 1-2 hours to test a web app on the device.
Once testing is done, you can re-enable kiosk mode.

Reference: https://techdocs.zebra.com/ehs/4-0/guide/features/
```

**If using another MDM (Miradore, SOTI, MobileIron, etc.):**

```
Can you please:
1. Use your MDM console to temporarily "exit kiosk mode" on one device, OR
2. Use the "Temporarily exit home screen" feature (if available) with a PIN?

We need about 1-2 hours to test a web app.

Reference: https://www.miradore.com/knowledge/android/temporarily-exiting-the-home-screen-in-the-home-screen-only-or-kiosk-mode-with-multiple-apps-configuration-type/
```

**If using FRED Mobility:**

```
Can you please:
1. Give us temporary access to the standard Android home screen on one device, so we can install a web app (or access Chrome)?
2. OR: Create a browser/web launcher inside FRED pointing to: [your-app-url]

We need about 1-2 hours for initial testing.

Reference: https://webhelp.fred.com.au/fredoffice/MOB/new-mobility-login-logout.htm
```

#### Request Option B: Whitelist Your App Domain in FRED

If your pharmacy uses FRED and doesn't want to unlock the device:

```
Can you please:
1. Whitelist the domain "[your-app-url]" in FRED's approved app list?
2. Create a web app launcher button or bookmark in FRED pointing to that URL?

This way, users can launch our web app directly from FRED without exiting kiosk mode.
No unlock needed — just a whitelist and launcher setup.
```

---

### Step 4: Configuring DataWedge on Kiosk-Locked Devices

Once you have temporary home screen access (or the app is whitelisted in FRED):

**DataWedge likely already exists**, since most pharmacy kiosks use barcode scanning:

1. Check if DataWedge has a profile:
   - Long-press **Settings** button (or open Settings app)
   - Look for **DataWedge**
   - If a profile exists with keyboard output enabled, **you're done** — scan a barcode and test

2. If DataWedge is missing or needs config:
   - [Follow the DataWedge configuration steps below](#datawedge-configuration-ui-method)
   - This requires temporary access to Android settings (ask IT for ~10 minutes)

3. If DataWedge is configured but keyboard output is disabled:
   - Open **Settings** → **DataWedge** → active profile
   - Go to **Output** → **Keyboard**
   - Toggle **Enabled: ON**
   - Barcode input should now work

4. Verify by testing:
   - Open your app in a browser
   - Scan a test barcode
   - The barcode should appear in an input field
   - If nothing appears, keyboard output may still be disabled or the profile isn't active

---

### Admin-Only Controls (EHS and MDM)

Use these only if you are the device owner or have explicit IT authorization.

**Disable EHS kiosk mode via broadcast (device owner / MDM only):**

```java
// Zebra EHS broadcast (requires admin privileges)
Intent intent = new Intent("com.symbol.enterprisehomescreen.actions.MODIFY_KIOSK_MODE");
intent.putExtra("enable", false);
sendBroadcast(intent);
```

**EHS config file override (device owner / MDM only):**

- If you manage `enterprisehomescreen.xml` under `/enterprise/usr/`, set `<kiosk_mode_enabled>` to `0`
- Redeploy the config via your MDM and reboot the device

---

## Zebra TC21-HC / TC26-HC (DataWedge)

### Overview

Zebra devices use **DataWedge**, a native Android keyboard emulation engine that can be configured via:

- **DataWedge UI** (built-in Settings app)
- **Profile configuration files** (MDM deployment)
- **Keystroke output** (default for browser apps)

### Hardware Setup

1. **Enable barcode scanner:**
   - Power on the device
   - Long-press the **Scan button** (physical button on device grip) to enable the barcode scanner module

2. **Connect to WiFi:**
   - Tap **Settings** > **Network & Internet** > **WiFi**
   - Select your pharmacy network
   - Moneyed up and authenticated (pharmacy IT manages this)

### DataWedge Configuration (UI Method)

1. **Open DataWedge app:**
   - Tap **Settings** > **DataWedge**
   - (If not present, ask your Zebra representative for MDM profile)

2. **Create a new Profile:**
   - Tap the **+** button to create a profile
   - Name it: `DMA Pharmacy` or `[Pharmacy Name] Profile`

3. **Configure keyboard output:**
   - In the profile, select **Input > Scanner**
   - Set **Scanner selection:** `Built-in Scanner`
   - Set **Symbology:** `Code128` (or `All` if scanning multiple barcode types)

4. **Configure keyboard wedge (output):**
   - Select **Output > Keyboard**
   - Toggle **Enabled:** ON
   - Set **Output mode:** `Keyboard (HID)` or `Keyboard (Emulation)` (both work)
   - Leave **Prefix/Suffix:** blank (no extra characters before/after barcode)

5. **Configure data formatting:**
   - Select **Keystroke Output**
   - Ensure **UPC-A/EAN-13:** Use (01) prefix for GS1 barcodes (optional, depends on your barcode format)
   - **Important:** Disable any checksum verification or transformation—pass raw barcode data as-is

6. **Activate the profile:**
   - Tap the **Radio button** next to your profile name to activate it
   - Confirm the profile is now the active DataWedge profile

7. **Test the configuration:**
   - Open the date-management app in the browser
   - Point the barcode scanner at a test barcode
   - Verify the barcode appears in the input field
   - Look for `Enter` key at the end of the scan (may appear as a cursor movement or submission)

### Troubleshooting: Zebra TC21-HC

| Issue                   | Symptom                                                         | Solution                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No barcode input**    | Scan button doesn't respond or app doesn't receive keystrokes   | 1. Verify DataWedge profile is **Active** (radio button selected)<br>2. Restart DataWedge app (`Settings > Apps > DataWedge > Force Stop` then reopen)<br>3. Re-scan test barcode after reboot<br>4. Check Zebra MDM logs if device is enterprise-managed |
| **Partial barcode**     | Only first few characters received                              | Increase keyboard output delay in DataWedge settings (try 100ms intervals)                                                                                                                                                                                |
| **Duplicate scans**     | Same barcode submitted twice on one scan                        | Normal behavior—app deduplicates within 2-second window                                                                                                                                                                                                   |
| **Wrong characters**    | Barcode has symbols or special chars instead of numbers/letters | Disable barcode transformation in DataWedge; set output to "Raw" or "Standard" (not "Formatted")                                                                                                                                                          |
| **GS1 separators lost** | FNC1 characters stripped (118 in ASCII)                         | DataWedge may strip control chars; ensure profile outputs raw bytes without interpretation                                                                                                                                                                |

---

## Honeywell CT45 XP (Enterprise Mobility)

### Overview

Honeywell devices use the **Honeywell Settings** app to configure keyboard output. The configuration is similar to Zebra but accessed through a different UI.

### Hardware Setup

1. **Enable barcode scanner:**
   - Power on the device
   - Press the **Scan button** (physical button) once to enable barcode mode

2. **Connect to WiFi:**
   - Long-press the **Settings icon** (gear)
   - Tap **Network > WiFi**
   - Select your pharmacy network

### Configuration (Honeywell Settings)

1. **Open Honeywell Settings:**
   - Long-press the **Settings icon** (home screen)
   - Tap **Honeywell Input Module** or **Scan Manager**
   - (May require password; default is often `1234` or printed on device)

2. **Enable Keyboard Output:**
   - Select **Scanner Configuration**
   - Set **Output format:** `Keyboard (HID)` or `ASCII Keyboard`
   - Set **Barcode type:** `All` or the specific types you're scanning (EAN-13, Code128, GS1-128)

3. **Disable Prefix/Suffix:**
   - Find **Message Prefix/Suffix** settings
   - Disable both (leave empty) to output raw barcode only

4. **Configure End-of-Barcode Character:**
   - Look for **Terminator** or **Message Terminator**
   - Set to **Enter** (may be labeled `CR` for Carriage Return, ASCII 13)
   - This signals the app that the barcode has ended

5. **Apply and test:**
   - Tap **Apply** or **Save**
   - Open the date-management app
   - Scan a test barcode and verify it appears in the input field

### Troubleshooting: Honeywell CT45 XP

| Issue                       | Symptom                                                        | Solution                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Settings locked**         | Cannot access Honeywell Settings app                           | Default password is often `1234` or printed on back of device; contact Honeywell MDM team if locked out                                                                        |
| **No keyboard output**      | Scan button works (device beeps) but app doesn't receive input | 1. Verify **Keyboard Output** is **Enabled** in settings<br>2. Restart the device (`Settings > About > Power Off` then power on)<br>3. Re-run Honeywell Settings after restart |
| **Barcode incomplete**      | Missing trailing characters                                    | Ensure **Message Terminator** is set to **Enter** and delay is adequate (try 50ms)                                                                                             |
| **App doesn't detect scan** | Barcode appears in app but doesn't trigger submit              | This may be expected—handheld detection waits for Enter key to confirm barcode end                                                                                             |

---

## CipherLab RS36 (Reader Config)

### Overview: Launcher Restrictions

CipherLab devices may run **custom launcher software** or **kiosk mode** that restricts home screen access. Unlike standard Android, RS36 devices in enterprise deployments may have:

- Custom launcher replacing Android home screen
- Reader Config app pinned as the only accessible application
- Settings locked with a PIN
- Android home button (back/home) remapped or disabled

This is similar to Zebra EHS/FRED Mobility—if kiosk is enabled, there is no user-level exit without the device admin's help.

### Accessing Home Screen on CipherLab (Kiosk Mode)

**If CipherLab is in full kiosk lockdown:**

There is **no user-level workaround**. Kiosk mode is designed to prevent what you're trying to do. However, you can try:

1. **Try the back button:**
   - Press the physical back button repeatedly
   - Some CipherLab launchers allow navigation back to home
   - If unsuccessful for 5-10 attempts, the launcher is fully locked

2. **Check for a home button:**
   - Look for a "Home" or house icon on any visible menu bars
   - Tap it to return to home screen
   - May require a PIN if home screen access is restricted (default is often `0000`)

3. **Look for a logout option:**
   - If you're in a CipherLab Kiosk interface, check for **Logout** or **Exit** button
   - After logout, the home screen may become accessible

4. **If none of that works:**
   - Device is in full kiosk mode
   - Only the **CipherLab admin or IT team** can unlock it
   - See **Request Unlock** below

### Request Unlock from CipherLab Admin

If the device is locked by your IT team or CipherLab admin:

```
Can you please:
1. Temporarily unlock the home screen for app testing (approximately 1-2 hours), OR
2. Whitelist the domain "[your-app-url]" in CipherLab's approved application list?
3. Create a browser launcher or web app shortcut pointing to our app?

We need to test a new web application. Once done, you can re-lock the device.
```

Alternatively:

```
Can you provide the PIN to temporarily access home screen settings?
(If default PIN 0000 doesn't work.)
```

### Installing App on CipherLab (Kiosk vs Unlocked)

**Option 1: Via Home Screen (If Unlocked or PIN Available)**

1. Unlock home screen or use PIN to access settings
2. Open Play Store or Chrome
3. Navigate to your app URL
4. For quick access, add a home screen shortcut or bookmark
5. Re-lock the device after testing

**Option 2: IT-Managed Installation (Recommended)**

- Ask your CipherLab admin to:
  1. Add your app domain to the whitelist, OR
  2. Create a web launcher / browser shortcut pointing to your app
  3. Make the launcher accessible to users
- This avoids unlocking the device entirely

### Configuring CipherLab for Barcode Input

**If using Reader Config:**

1. **Open Reader Config:**
   - Check if Reader Config is accessible
   - Open a profile you created earlier (see **[Configuration (Reader Config App)](#configuration-reader-config-app)** above)
   - Verify keyboard output is enabled

2. **If Reader Config is locked:**
   - It may have a default PIN (`0000`)
   - If that doesn't work, your IT team must unlock it

3. **Test keyboard output:**
   - Scan a barcode
   - Check if input appears in your app
   - If not, Reader Config settings may be misconfigured or keyboard output disabled

---

### Hardware Setup

1. **Enable barcode scanner:**
   - Power on the device
   - Tap the **Menu** button > **Scanner** to enable the built-in barcode scanner

2. **Connect to WiFi:**
   - Tap **Menu** > **Network** > **WiFi**
   - Select your pharmacy network

### Configuration (Reader Config App)

1. **Install Reader Config (if not present):**
   - Open the **Play Store**
   - Search for `CipherLab Reader Config`
   - Tap **Install**

2. **Open Reader Config:**
   - Tap the **Reader Config** app icon
   - You may need to authenticate with a PIN (default is `0000`)

3. **Create a new profile:**
   - Tap **+** to create a profile
   - Name it: `DMA Pharmacy` or your pharmacy name

4. **Configure keyboard output:**
   - Under **Output Settings**, select **Keyboard (USB)** or **Keyboard (Serial)**
   - Ensure **Enable** is toggled ON
   - Set **Data format:** `Raw` (no transformations)

5. **Configure barcode parameters:**
   - Under **Barcode Settings**, select **Symbology**
   - Choose the barcode types your pharmacy uses (e.g., `EAN-13`, `Code128`, `GS1-128`)
   - Leave **Prefix/Suffix** blank

6. **Set end-of-message terminator:**
   - Find **Message Terminator** or **EOL Character**
   - Set to **CR** (Carriage Return / Enter, ASCII 13)

7. **Activate the profile:**
   - Tap **Save** and then make this profile **Default**
   - You may need to restart the app or device

8. **Test the configuration:**
   - Open the date-management app in the browser
   - Point the barcode scanner at a test barcode
   - Verify the barcode is received in the app input field

### Troubleshooting: CipherLab RS36

| Issue                         | Symptom                                                         | Solution                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reader Config locked**      | Cannot open or modify settings                                  | Default PIN is `0000`; if changed, contact CipherLab support or use factory reset                                                                     |
| **Keyboard output disabled**  | Scan works (device confirms) but app doesn't receive keystrokes | 1. Verify **Keyboard Output** is **Enabled**<br>2. Check **Data format** is set to `Raw` (not `Formatted`)<br>3. Restart device and Reader Config app |
| **Barcode truncated**         | Missing the last few characters                                 | Increase **Message Terminator Delay** (try 100ms) in Reader Config                                                                                    |
| **App doesn't register scan** | Keystrokes arrive but timing is off                             | Verify Enter key is set as terminator; the app waits for Enter to confirm barcode end (50ms threshold)                                                |

---

## GS1-128 Barcode Support

If your pharmacy uses **GS1-128 barcodes** (pharmaceutical industry standard with expiry dates, lot numbers, etc.):

### What is GS1-128?

GS1-128 is a structured barcode format using **Application Identifiers (AIs)** to encode multiple fields in one scan:

- **(01)** — GTIN-14 (product number)
- **(10)** — Batch/lot number
- **(17)** — Expiry date (YYMMDD format)
- **(21)** — Serial number

Example: `0193939393141710B256092121B256` decodes to:

- GTIN: `937939393141`
- Batch: `256`
- Expiry: `2021-09-21`
- Serial: `256`

### Device Configuration for GS1-128

**Zebra DataWedge:**

- Set **Symbology** to `Code128` (GS1-128 is a variant)
- Enable **GS1 Parsing** (if available) to auto-extract AIs
- Leave **FNC1 character** as default (device outputs ASCII 29 or custom char)

**Honeywell:**

- Set **Barcode type** to `GS1-128` or `Code128` with GS1 mode enabled
- Configure **AID Mode** if available

**CipherLab:**

- In **Symbology**, select `GS-128` specifically
- The app's GS1 parser will extract individual fields

---

## Testing Your Configuration

### Step-by-Step Test Procedure

1. **Test Simple Barcodes (EAN-13):**
   - Scan a standard UPC or EAN-13 barcode (on any product)
   - Expected: Raw 13-digit code appears in app input field
   - If successful, move to GS1 testing

2. **Test GS1-128 Barcodes:**
   - Scan a pharmaceutical GS1-128 barcode
   - Expected: App displays parsed data (GTIN, expiry, batch, serial)
   - If expiry date field auto-fills, GS1 parsing is working

3. **Test Keyboard Timing:**
   - In the app, enable **Debug Mode** (`?forceHandheld=debug` URL param)
   - Scan a barcode
   - Check browser console for raw keyboard events and timing logs
   - Verify scan took <100ms (hardware scan should be very fast)

4. **Test Offline Sync:**
   - Disconnect WiFi
   - Scan a barcode
   - Verify it's queued locally
   - Reconnect WiFi and tap **Sync Now**
   - Verify data syncs to server

---

## Support and Contact

If you encounter issues not covered here:

1. **Check the Debug Guide:** [handheld-debug-guide.md](handheld-debug-guide.md)
2. **Vendor Support:**
   - Zebra: `https://support.zebra.com/` (DataWedge docs)
   - Honeywell: `https://hsmftp.honeywell.com/` (settings guides)
   - CipherLab: `https://www.cipherlab.com/en/products/` (product manuals)
3. **In-App Troubleshooting:**
   - Tap **Settings > Handheld Developer Tools** (if enabled) to inspect keyboard events
   - Check browser Network tab to see if scans are reaching the server

---

## Summary Table

| Vendor    | Device            | Input Method | Config Tool        | Keyboard Output | Status       |
| --------- | ----------------- | ------------ | ------------------ | --------------- | ------------ |
| Zebra     | TC21-HC / TC26-HC | Scan button  | DataWedge UI       | Keyboard HID    | ✅ Supported |
| Honeywell | CT45 XP           | Scan button  | Honeywell Settings | Keyboard ASCII  | ✅ Supported |
| CipherLab | RS36              | Scan button  | Reader Config app  | Keyboard USB    | ✅ Supported |

---

**Last Updated:** February 2026  
**Documentation Version:** 1.0  
**Target App Version:** 1.1.0+ (PDT integration release)
