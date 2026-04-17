# Reverse Proxy Configuration for Production

## Nginx Setup

1. Install Nginx:

   ```bash
   # On Ubuntu/Debian
   sudo apt update
   sudo apt install nginx

   # On CentOS/RHEL
   sudo yum install nginx
   # or
   sudo dnf install nginx

   # On Windows (using Windows Subsystem for Linux or native installation)
   # Download from https://nginx.org/en/download.html
   ```

2. Copy the provided `nginx.conf` file to your nginx configuration directory:

   ```bash
   sudo cp nginx.conf /etc/nginx/sites-available/date-management-app
   sudo ln -s /etc/nginx/sites-available/date-management-app /etc/nginx/sites-enabled/
   ```

3. Update the configuration file paths:
   - Modify `/path/to/frontend/build` to point to your actual frontend build directory
   - Ensure the backend server address matches your production backend server

4. Test the nginx configuration:

   ```bash
   sudo nginx -t
   ```

5. Restart Nginx to apply changes:
   ```bash
   sudo systemctl restart nginx
   # or on older systems:
   sudo service nginx restart
   ```

## Apache Setup (Alternative)

If you prefer Apache, use the following `.htaccess` or VirtualHost configuration:

```apache
<VirtualHost *:80>
    ServerName your-domain.com

    # Proxy API requests to backend
    ProxyPreserveHost On
    ProxyPass /auth http://localhost:30002/auth
    ProxyPassReverse /auth http://localhost:30002/auth

    ProxyPass /products http://localhost:30002/products
    ProxyPassReverse /products http://localhost:30002/products

    ProxyPass /inventory-items http://localhost:30002/inventory-items
    ProxyPassReverse /inventory-items http://localhost:30002/inventory-items

    ProxyPass /store-areas http://localhost:30002/store-areas
    ProxyPassReverse /store-areas http://localhost:30002/store-areas

    ProxyPass /reports http://localhost:30002/reports
    ProxyPassReverse /reports http://localhost:30002/reports

    ProxyPass /dashboard http://localhost:30002/dashboard
    ProxyPassReverse /dashboard http://localhost:30002/dashboard

    ProxyPass /users http://localhost:30002/users
    ProxyPassReverse /users http://localhost:30002/users

    ProxyPass /health http://localhost:30002/health
    ProxyPassReverse /health http://localhost:30002/health

    # Serve static files
    DocumentRoot /path/to/frontend/build
    <Directory /path/to/frontend/build>
        Options Indexes FollowSymLinks
        AllowOverride None
        Require all granted
    </Directory>

    # Handle client-side routing
    RewriteEngine On
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule ^ /index.html [L]
</VirtualHost>
```

## SSL/HTTPS Setup

To enable SSL/HTTPS (recommended for production):

1. Obtain an SSL certificate (free from Let's Encrypt or purchased)

2. Update the nginx configuration to include SSL:

   ```nginx
   server {
       listen 443 ssl http2;
       server_name your-domain.com;

       ssl_certificate /path/to/your/certificate.crt;
       ssl_certificate_key /path/to/your/private.key;

       # SSL security settings
       ssl_protocols TLSv1.2 TLSv1.3;
       ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
       ssl_prefer_server_ciphers off;
       ssl_session_cache shared:SSL:10m;

       # Include the rest of the configuration from above
       # ...
   }

   # Redirect HTTP to HTTPS
   server {
       listen 80;
       server_name your-domain.com;
       return 301 https://$server_name$request_uri;
   }
   ```

3. Use certbot (from Let's Encrypt) to automate SSL setup:
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

## Notes

- Ensure your backend server is running and accessible from the proxy server
- The proxy configuration assumes your backend API runs on localhost:30002 (as defined in your .env)
- Update file paths and server names according to your production environment
- Consider using environment variables to toggle between development and production configurations
- Monitor logs regularly for any issues: `/var/log/nginx/date-management-app.access.log` and `/var/log/nginx/date-management-app.error.log`
