-- Create uploads table to track file uploads for quota calculation
-- This table records metadata about all uploaded files including size, user, and date

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  content_type TEXT,
  status TEXT DEFAULT 'completed', -- 'uploaded', 'completed', 'failed', 'deleted'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(file_key)
);

-- Index for efficient quota calculation (group by user, filter by status and created_at)
CREATE INDEX IF NOT EXISTS idx_uploads_user_created ON uploads(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);
CREATE INDEX IF NOT EXISTS idx_uploads_created ON uploads(created_at);
