# Operational Runbooks for Date Management Application

## Overview
This document provides runbooks for common operational scenarios and procedures for the Date Management Application in production.

## Table of Contents
1. [Emergency Response Procedures](#emergency-response-procedures)
2. [Daily Operations](#daily-operations)
3. [Troubleshooting Common Issues](#troubleshooting-common-issues)
4. [Performance Monitoring](#performance-monitoring)
5. [Incident Response](#incident-response)

## Emergency Response Procedures

### Application is Unavailable
1. Check application status:
   ```bash
   pm2 status
   ```

2. If application is not running:
   ```bash
   pm2 start date-management-app
   ```

3. If application is running but not responding:
   ```bash
   # Check logs
   pm2 logs date-management-app --lines 50
   
   # Restart the application
   pm2 restart date-management-app
   ```

4. Check reverse proxy status (Nginx/Apache):
   ```bash
   sudo systemctl status nginx
   # or
   sudo systemctl status apache2
   ```

5. Check system resources:
   ```bash
   top
   df -h  # Check disk space
   free -h  # Check memory
   ```

### Database Connection Issues
1. Check database file accessibility:
   ```bash
   ls -la /path/to/database.sqlite
   ```

2. Check database file permissions:
   ```bash
   stat /path/to/database.sqlite
   ```

3. Check if database is locked:
   ```bash
   # Look for -wal and -shm files
   ls -la /path/to/database*
   # If present, the database might be locked
   ```

4. If database is locked, restart the application:
   ```bash
   pm2 restart date-management-app
   ```

### High Memory/CPU Usage
1. Check current resource usage:
   ```bash
   pm2 monit
   ```

2. Identify problematic processes:
   ```bash
   ps aux | grep node
   ```

3. Restart the application if needed:
   ```bash
   pm2 restart date-management-app
   ```

4. Consider scaling up or optimizing queries if issue persists

## Daily Operations

### Backup Verification
1. Check backup files:
   ```bash
   ls -la /path/to/backups/
   ```

2. Verify backup cron job is running:
   ```bash
   crontab -l
   ```

3. Check backup logs for any errors:
   ```bash
   tail -f /path/to/backup/logs/backup.log
   ```

### Log Monitoring
1. Check application logs:
   ```bash
   pm2 logs date-management-app --lines 100
   ```

2. Check reverse proxy logs:
   ```bash
   sudo tail -f /var/log/nginx/access.log
   sudo tail -f /var/log/nginx/error.log
   # or for Apache:
   sudo tail -f /var/log/apache2/access.log
   sudo tail -f /var/log/apache2/error.log
   ```

### Health Checks
1. Verify health endpoints:
   ```bash
   curl -i https://yourdomain.com/health
   curl -i https://yourdomain.com/live
   curl -i https://yourdomain.com/ready
   ```

2. Check for any alerts in monitoring system:
   - Check database monitoring alerts
   - Review slow query logs
   - Verify system resource utilization

## Troubleshooting Common Issues

### Slow Query Detection
1. Check database monitoring metrics:
   ```bash
   curl -i https://yourdomain.com/health/database-metrics
   ```

2. Review slow query logs in application logs:
   ```bash
   pm2 logs date-management-app | grep "Slow query detected"
   ```

3. Identify and optimize queries causing performance issues

### Authentication Issues
1. Verify JWT secret is correctly set:
   ```bash
   # Check your .env file
   cat .env | grep JWT_SECRET
   ```

2. Check if JWT tokens are properly configured:
   - Token expiration settings
   - Algorithm configuration

3. Clear and regenerate tokens if needed

### Service Worker Cache Issues
1. Clear service worker cache:
   - In browser developer tools, go to Application tab
   - Clear storage/cache for the domain
   - Or force-refresh (Ctrl+Shift+R or Cmd+Shift+R)

2. Check service worker status:
   ```bash
   curl -i https://yourdomain.com/sw.js
   ```

## Performance Monitoring

### Key Metrics to Monitor
- **API Response Times**: Monitor 95th percentile response times
- **Database Performance**: Track slow queries and connection pool metrics
- **System Resources**: CPU, memory, and disk utilization
- **Error Rates**: Monitor HTTP error rates and application errors
- **User Activity**: Track requests per minute and concurrent users

### Database-Specific Metrics
- **Connection Pool**: Monitor utilization against threshold (90%)
- **Slow Queries**: Track queries taking >100ms
- **Table Sizes**: Monitor growth, especially inventory_items table
- **Row Counts**: Track against threshold (100k rows)

### Alert Thresholds
- **High**: >90% connection pool utilization
- **High**: >100 slow queries per minute
- **Medium**: Table size >100MB
- **Medium**: Row count >100k records per table
- **High**: Disk space utilization >85%

## Incident Response

### Incident Classification
- **Critical**: Application completely unavailable
- **High**: Core functionality impaired
- **Medium**: Performance degradation
- **Low**: Minor issues with workarounds available

### Response Procedures
1. **Acknowledge**: Confirm incident received within 15 minutes
2. **Assess**: Determine scope and impact within 30 minutes
3. **Communicate**: Notify stakeholders about issue
4. **Mitigate**: Implement immediate fixes
5. **Resolve**: Apply permanent solution
6. **Review**: Conduct post-incident review

### Communication Template
```
Subject: [PRIORITY] Date Management Application Incident - [DATE]

Status: [Investigating|Identified|Mitigated|Resolved]
Priority: [Critical|High|Medium|Low]
ETA to Resolution: [Time]

Description:
[Clear description of the problem]

Impact:
[Who is affected and how]

Action Taken:
[Steps already taken]

Next Steps:
[Planned actions and timeline]

Updates will be provided every [time interval] or as status changes.
```

## Maintenance Windows
- **Weekly**: Check logs, verify backups, review performance metrics
- **Monthly**: Security updates, dependency updates, database maintenance
- **Quarterly**: System resource review, scaling assessment

## Escalation Contacts
- Primary: [Contact Information]
- Secondary: [Contact Information]
- Vendor Support: [Contact Information if applicable]