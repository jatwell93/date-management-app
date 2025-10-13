# Deployment Guide for Date Management Application

## Overview
This document outlines the deployment process for the Date Management Application, including production setup, configuration, and rollback procedures.

## Prerequisites
- Node.js v16 or higher
- PM2 process manager (`npm install -g pm2`)
- Nginx or Apache web server
- SSL certificate for HTTPS
- Database server (SQLite file should be accessible)

## Deployment Process

### 1. Prepare the Environment
1. Clone the repository to the production server:
   ```bash
   git clone <repository-url>
   cd date-management-app
   ```

2. Install backend dependencies:
   ```bash
   cd backend
   npm install --production
   ```

3. Install frontend dependencies and build:
   ```bash
   cd ../frontend
   npm install --production
   npm run build
   ```

### 2. Configure Environment Variables
1. Copy the `.env.example` to `.env`:
   ```bash
   cd ../backend
   cp .env.example .env
   ```

2. Update the `.env` file with production values:
   ```bash
   # Server configuration
   PORT=3001
   NODE_ENV=production
   FRONTEND_URL=https://yourdomain.com
   
   # Security
   JWT_SECRET=your_long_secure_random_secret_here
   ENABLE_HTTPS=true
   SSL_PRIVATE_KEY_PATH=/path/to/ssl/private.key
   SSL_CERT_PATH=/path/to/ssl/certificate.crt
   
   # Database
   DATABASE_PATH=/path/to/database.sqlite
   
   # Backup configuration
   BACKUP_PATH=/path/to/backups/
   BACKUP_RETENTION_DAYS=30
   ```

### 3. Set Up Database
1. Ensure the database file is accessible and has proper permissions
2. Run initial migrations:
   ```bash
   npm run migrate  # This would typically be part of your setup process
   ```

### 4. Configure Reverse Proxy (Nginx Example)
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /path/to/ssl/certificate.crt;
    ssl_certificate_key /path/to/ssl/private.key;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Health check endpoints
    location /health {
        proxy_pass http://localhost:3001/health;
    }
    location /live {
        proxy_pass http://localhost:3001/live;
    }
    location /ready {
        proxy_pass http://localhost:3001/ready;
    }
}
```

### 5. Start the Application with PM2
1. Create a PM2 ecosystem file (`ecosystem.config.js`):
   ```javascript
   module.exports = {
     apps: [{
       name: 'date-management-app',
       script: './dist/index.js',
       instances: 'max',
       exec_mode: 'cluster',
       env: {
         NODE_ENV: 'production',
         PORT: 3001
       }
     }]
   };
   ```

2. Build the backend:
   ```bash
   npm run build
   ```

3. Start the application:
   ```bash
   pm2 start ecosystem.config.js
   ```

4. Set up PM2 to start on boot:
   ```bash
   pm2 startup
   pm2 save
   ```

### 6. Verify Deployment
1. Check application status:
   ```bash
   pm2 status
   ```

2. Check health endpoints:
   - `https://yourdomain.com/health`
   - `https://yourdomain.com/live`
   - `https://yourdomain.com/ready`

3. Verify the application is accessible via web browser

## Rollback Procedures

### Automated Rollback with Git and PM2
1. Create a backup of the current state:
   ```bash
   # Create DB backup
   cp /path/to/database.sqlite /path/to/backups/database-rollback-$(date +%Y%m%d-%H%M%S).sqlite
   
   # Create code backup
   tar -czf backup-$(date +%Y%m%d-%H%M%S).tar.gz .
   ```

2. Identify the last known working commit:
   ```bash
   git log --oneline
   ```

3. Revert to the known working commit:
   ```bash
   git reset --hard <commit-hash>
   ```

4. Update dependencies if needed:
   ```bash
   cd backend
   npm install --production
   cd ../frontend
   npm install --production
   npm run build
   cd ../backend
   npm run build
   ```

5. Restart the application:
   ```bash
   pm2 restart date-management-app
   ```

### Manual Rollback
If the automated process fails:

1. Stop the current application:
   ```bash
   pm2 stop date-management-app
   ```

2. Restore the database from a known good backup:
   ```bash
   cp /path/to/backups/database-good-backup.sqlite /path/to/database.sqlite
   ```

3. Restore the application files from backup:
   ```bash
   # Stop current app
   pm2 stop date-management-app
   
   # Remove current files
   rm -rf *
   
   # Extract the backup
   tar -xzf backup-<timestamp>.tar.gz
   
   # Restart
   pm2 start ecosystem.config.js
   ```

4. Verify the rollback:
   - Check application accessibility
   - Verify data integrity
   - Run health checks

## Post-Deployment Verification Checklist
- [ ] Application is accessible via configured domain
- [ ] Health check endpoints return healthy status
- [ ] Database connection is working
- [ ] SSL certificate is valid and enforced
- [ ] All API endpoints return expected responses
- [ ] Frontend assets load correctly
- [ ] User authentication and authorization work as expected
- [ ] Monitoring and logging are properly configured
- [ ] Backup jobs are scheduled and working

## Troubleshooting Common Issues
1. **Application not starting**:
   - Check logs with `pm2 logs date-management-app`
   - Verify environment variables are set correctly
   - Confirm database file has proper permissions

2. **SSL Certificate errors**:
   - Verify certificate and private key paths in `.env`
   - Check certificate validity dates
   - Confirm file permissions (private key should be 600)

3. **Database connection errors**:
   - Verify `DATABASE_PATH` in `.env`
   - Check if SQLite file has proper read/write permissions
   - Confirm parent directory permissions

## Maintenance Tasks

### Regular Database Maintenance
- Run periodic backups
- Monitor database size growth
- Implement data archival for old records if needed

### Security Updates
- Regularly update dependencies with `npm audit` and `npm audit fix`
- Update Node.js runtime when security patches are available
- Renew SSL certificates before expiration