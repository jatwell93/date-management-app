# Backup and Recovery Procedures for Date Management Application

## Overview
This document outlines the backup and recovery procedures for the Date Management Application, ensuring data integrity and availability in case of system failures or data corruption.

## Backup Strategy

### Backup Types
1. **Daily Full Backups**: Complete backup of the database and configuration files
2. **Hourly Transaction Logs**: (If using a database that supports transaction logs)
3. **Weekly Offsite Backups**: Copy of critical data stored at a different location

### Backup Schedule
- **Database backups**: Daily at 2:00 AM (low-traffic time)
- **Configuration backups**: Weekly on Sundays at 1:00 AM
- **Emergency backups**: On-demand before major system changes

### Backup Retention Policy
- **Daily backups**: 30 days
- **Weekly backups**: 3 months
- **Monthly backups**: 1 year

## Backup Procedures

### Automated Database Backups

#### Using Cron Job
1. Create a backup script at `/opt/backup-scripts/backup-db.sh`:
   ```bash
   #!/bin/bash
   # Database backup script for Date Management Application
   
   # Configuration
   DB_PATH="/path/to/database.sqlite"
   BACKUP_DIR="/path/to/backups"
   DATE=$(date +%Y%m%d_%H%M%S)
   BACKUP_NAME="database_backup_$DATE.sqlite"
   
   # Create backup
   cp "$DB_PATH" "$BACKUP_DIR/$BACKUP_NAME"
   
   # Compress backup
   gzip "$BACKUP_DIR/$BACKUP_NAME"
   
   # Remove backups older than retention period (30 days)
   find "$BACKUP_DIR" -name "database_backup_*.sqlite.gz" -mtime +30 -delete
   
   # Log the backup
   echo "$(date): Database backup created - $BACKUP_NAME.gz" >> /var/log/app-backups.log
   ```

2. Make the script executable:
   ```bash
   chmod +x /opt/backup-scripts/backup-db.sh
   ```

3. Set up cron job to run daily:
   ```bash
   # Edit crontab
   crontab -e
   
   # Add line for daily backup at 2:00 AM
   0 2 * * * /opt/backup-scripts/backup-db.sh
   ```

### Configuration Backups
1. Create a configuration backup script:
   ```bash
   #!/bin/bash
   # Configuration backup script
   
   CONFIG_DIR="/path/to/app/config"
   BACKUP_DIR="/path/to/config-backups"
   DATE=$(date +%Y%m%d_%H%M%S)
   
   # Backup configuration files
   tar -czf "$BACKUP_DIR/config_backup_$DATE.tar.gz" -C "$CONFIG_DIR" .
   
   # Remove old config backups (older than 90 days)
   find "$BACKUP_DIR" -name "config_backup_*.tar.gz" -mtime +90 -delete
   ```

### Offsite Backup Procedures
1. Set up secure offsite backup using rsync or cloud storage:
   ```bash
   # Example using rsync to remote server
   rsync -avz /path/to/backups/ user@remote-server:/remote/backup/path/
   
   # Or using AWS S3
   aws s3 sync /path/to/backups/ s3://your-bucket-name/backups/ --delete
   ```

## Recovery Procedures

### Full Database Recovery

#### From Daily Backup
1. **Ensure Application is Stopped**:
   ```bash
   pm2 stop date-management-app
   ```

2. **Verify Backup Files**:
   ```bash
   ls -la /path/to/backups/
   # Find the appropriate backup file for recovery
   ```

3. **Stop All Processes Accessing the Database**:
   ```bash
   # Check for any processes using the database
   lsof /path/to/database.sqlite
   ```

4. **Backup Current Database (for safety)**:
   ```bash
   cp /path/to/database.sqlite /path/to/database.sqlite.emergency-backup-$(date +%Y%m%d-%H%M%S)
   ```

5. **Restore Database from Backup**:
   ```bash
   # Decompress and restore the backup
   gunzip -c /path/to/backups/database_backup_<date>.sqlite.gz > /tmp/restored_db.sqlite
   
   # Replace the database file
   mv /tmp/restored_db.sqlite /path/to/database.sqlite
   ```

6. **Set Proper Permissions**:
   ```bash
   chown user:user /path/to/database.sqlite
   chmod 644 /path/to/database.sqlite
   ```

7. **Start the Application**:
   ```bash
   pm2 start date-management-app
   ```

8. **Verify Recovery**:
   - Check application logs for errors
   - Perform basic functionality tests
   - Verify data integrity by comparing records

### Partial Data Recovery

#### Recovering Specific Records
1. **Identify the Backup with Required Data**:
   - Check multiple backup points to find when the data was in the correct state

2. **Create a Temporary Database Instance**:
   ```bash
   cp /path/to/backups/database_backup_<date>.sqlite.gz /tmp/recovery_db.gz
   gunzip -c /tmp/recovery_db.gz > /tmp/recovery_db.sqlite
   ```

3. **Extract Specific Data**:
   ```bash
   # Use SQLite command line to extract specific records
   sqlite3 /tmp/recovery_db.sqlite ".mode insert; .output recovery.sql; SELECT * FROM inventory_items WHERE id = <id>;"
   ```

4. **Import Data to Production**:
   ```bash
   # Apply extracted data to production database
   sqlite3 /path/to/database.sqlite < recovery.sql
   ```

### Configuration Recovery
1. **Stop the Application**:
   ```bash
   pm2 stop date-management-app
   ```

2. **Restore Configuration Files**:
   ```bash
   # Extract configuration backup
   tar -xzf /path/to/config-backups/config_backup_<date>.tar.gz -C /path/to/app/config/
   ```

3. **Verify Configuration**:
   - Check environment variables
   - Verify API keys and sensitive data

4. **Restart the Application**:
   ```bash
   pm2 start date-management-app
   ```

## Recovery Testing

### Regular Testing Schedule
- **Quarterly**: Full recovery simulation
- **Monthly**: Verify backup integrity
- **Weekly**: Check backup logs and file sizes

### Testing Procedures
1. **Verify Backup Integrity**:
   ```bash
   # Check if backup files can be uncompressed
   gunzip -t /path/to/backups/database_backup_*.sqlite.gz
   
   # Check if SQLite database is valid
   sqlite3 /path/to/test_db.sqlite "PRAGMA integrity_check;"
   ```

2. **Perform Test Recovery**:
   - Restore backup to a separate test environment
   - Verify all data is present and correct
   - Test application functionality with restored data

3. **Document Test Results**:
   - Record any issues encountered during testing
   - Update procedures as needed
   - Document recovery time for planning purposes

## Disaster Recovery Plan

### Complete System Failure
1. **Provision New Infrastructure** (if needed)
2. **Install Application Dependencies**
3. **Restore Latest Database Backup**
4. **Restore Latest Configuration Backup**
5. **Deploy Latest Application Code**
6. **Configure Reverse Proxy and SSL Certificates**
7. **Start Application Services**
8. **Verify Functionality**

### Recovery Time Objectives (RTO)
- **Minor data loss (last hour)**: < 2 hours
- **Daily data loss**: < 4 hours
- **Complete system failure**: < 24 hours

### Recovery Point Objectives (RPO)
- **Maximum acceptable data loss**: 24 hours of data

## Security Considerations
- **Encrypt backup files**: Use encryption to protect sensitive data in backups
- **Secure backup transmission**: Use secure protocols (SFTP, SSL) for offsite backups
- **Restrict backup access**: Limit who can access backup files
- **Audit backup activities**: Log all backup and restore operations

## Monitoring and Alerts
1. **Backup Success/Failure**: Alert on backup job completion status
2. **Storage Space**: Monitor available space for backups
3. **Backup File Size**: Alert if backup size is unexpectedly small
4. **Retention Policy Compliance**: Alert if old backups are not being cleaned up

### Example Monitoring Script
```bash
#!/bin/bash
# Backup monitoring script

BACKUP_DIR="/path/to/backups"
ALERT_EMAIL="admin@domain.com"
BACKUP_AGE=1  # Hours

# Check if today's backup exists
TODAY_BACKUP=$(find "$BACKUP_DIR" -name "database_backup_$(date +%Y%m%d)*.sqlite.gz" -mmin -$((BACKUP_AGE * 60)))

if [ -z "$TODAY_BACKUP" ]; then
    # Send alert
    echo "ALERT: Today's backup was not created or is older than $BACKUP_AGE hour(s)" | \
    mail -s "Backup Alert - Date Management App" "$ALERT_EMAIL"
fi
```

## Contact Information
- **Primary Contact**: [Contact Information]
- **Backup Administrator**: [Contact Information]
- **Vendor Support**: [Contact Information if applicable]