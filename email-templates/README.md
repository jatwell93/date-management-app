# Email Templates

Basic HTML email templates for SendGrid integration testing.

## Templates

### 1. Trial Ending Soon (`trial-ending-soon.html`)
Sent when a trial period is about to expire.

**Variables:**
- `{{organizationName}}` - Name of the organization
- `{{daysRemaining}}` - Number of days until trial expires

**Used by:** `EmailService.sendTrialReminderEmail()`

---

### 2. Payment Failed (`payment-failed.html`)
Sent when a subscription payment fails.

**Variables:**
- `{{organizationName}}` - Name of the organization
- `{{invoiceUrl}}` - Stripe hosted invoice URL for payment

**Used by:** `EmailService.sendDunningEmail()`

---

### 3. Downgrade Warning (`downgrade-warning.html`)
Sent when a subscription is downgraded and usage exceeds new limits.

**Variables:**
- `{{organizationName}}` - Name of the organization
- `{{currentUsage}}` - Current number of items/SKUs
- `{{newLimit}}` - New tier limit
- `{{excessItems}}` - Number of items exceeding the limit

**Used by:** `EmailService.sendDowngradeWarningEmail()`

---

## Usage

These templates are for **testing purposes** during development. For production use:

1. Create dynamic templates in your SendGrid dashboard
2. Copy the HTML content from these files
3. Configure template IDs in the EmailService
4. Replace placeholder URLs (yourdomain.com) with actual application URLs
5. Add proper unsubscribe links and legal footer text
6. Test with SendGrid's template testing tools

## Customization

To customize these templates:
- Update colors, fonts, and styling in the `<style>` section
- Replace "yourdomain.com" with your actual domain
- Add your logo/branding
- Include proper legal disclaimers and unsubscribe links
- Consider responsive design improvements for mobile devices

## SendGrid Integration

To use these templates with SendGrid:

1. Go to SendGrid Dashboard → Email API → Dynamic Templates
2. Create a new template for each email type
3. Copy the HTML from these files
4. Set up template variables matching the `{{variable}}` placeholders
5. Test using SendGrid's built-in preview and test features
6. Copy the template IDs and update `backend/src/services/email.service.ts`

**Note:** Replace the inline HTML in `email.service.ts` with template IDs once configured in SendGrid dashboard.
