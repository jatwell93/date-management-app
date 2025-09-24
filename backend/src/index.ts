import express from 'express';
import { getDb, initDatabase } from './database';

const app = express();
const port = 3001;

// Middleware
app.use(express.json());

// Initialize database
initDatabase().catch(console.error);

// Routes
app.get('/', (req, res) => {
  res.send('Date Management API is running!');
});

// Get all dates
app.get('/dates', async (req, res) => {
  try {
    const db = await getDb();
    const dates = await db.all('SELECT * FROM dates');
    res.json(dates);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dates' });
  }
});

// Get a specific date by ID
app.get('/dates/:id', async (req, res) => {
  try {
    const db = await getDb();
    const date = await db.get('SELECT * FROM dates WHERE id = ?', req.params.id);
    
    if (!date) {
      return res.status(404).json({ error: 'Date not found' });
    }
    
    res.json(date);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch date' });
  }
});

// Create a new date
app.post('/dates', async (req, res) => {
  try {
    const { date, title, description } = req.body;
    const db = await getDb();
    
    const result = await db.run(
      'INSERT INTO dates (date, title, description) VALUES (?, ?, ?)',
      [date, title, description]
    );
    
    res.status(201).json({ id: result.lastID, date, title, description });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create date' });
  }
});

// Update a date
app.put('/dates/:id', async (req, res) => {
  try {
    const { date, title, description } = req.body;
    const db = await getDb();
    
    const result = await db.run(
      'UPDATE dates SET date = ?, title = ?, description = ? WHERE id = ?',
      [date, title, description, req.params.id]
    );
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Date not found' });
    }
    
    res.json({ id: req.params.id, date, title, description });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update date' });
  }
});

// Delete a date
app.delete('/dates/:id', async (req, res) => {
  try {
    const db = await getDb();
    
    const result = await db.run('DELETE FROM dates WHERE id = ?', req.params.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Date not found' });
    }
    
    res.json({ message: 'Date deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete date' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});