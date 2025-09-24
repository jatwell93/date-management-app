
#!/bin/bash

# Define paths
DB_FILE="../src/database.sqlite"
BACKUP_DIR="../backups"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Create a timestamped backup file name
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
BACKUP_FILE="$BACKUP_DIR/backup-$TIMESTAMP.sql"

# Dump the database to the backup file
sqlite3 "$DB_FILE" .dump > "$BACKUP_FILE"

# Check if the dump was successful
if [ $? -eq 0 ]; then
  echo "Database backup successful: $BACKUP_FILE"
else
  echo "Error: Database backup failed"
  exit 1
fi

# Optional: Clean up old backups (e.g., older than 7 days)
# find "$BACKUP_DIR" -name "*.sql" -mtime +7 -delete
# echo "Old backups cleaned up."

exit 0
