import express from 'express';
import { getDb, initDatabase } from './database';
import jwt from 'jsonwebtoken';

const app = express();
const port = 3001;
const JWT_SECRET = 'your_jwt_secret'; // In a real app, use an environment variable

// Middleware
app.use(express.json());

// Initialize database
initDatabase().catch(console.error);

// Routes
app.get('/', (req, res) => {
  res.send('Date Management API is running!');
});

// Auth
app.post('/auth/login', async (req, res) => {
  const { pin } = req.body;

  // In a real app, you'd look up the user by PIN in the database
  if (pin === '1234') {
    const token = jwt.sign({ userId: 1, role: 'manager' }, JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({ token });
  } else {
    res.status(401).json({ error: 'Invalid PIN' });
  }
});


// Products
app.get('/products', async (req, res) => {
  const { barcode } = req.query;

  if (!barcode) {
    return res.status(400).json({ error: 'Barcode is required' });
  }

  try {
    const db = await getDb();
    const product = await db.get('SELECT * FROM products WHERE barcode = ?', barcode);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
}

export default app;