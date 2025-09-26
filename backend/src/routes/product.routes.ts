import { Router, Request, Response } from "express";
import { ProductService } from "../services/product.service";
import { Product } from "../models/product.model";
import { authenticateToken } from "../middleware/auth.middleware";

const router = Router();
const productService = new ProductService();

// GET /products - Get all products
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const products = await productService.getAllProducts();
    res.json(products);
  } catch (_error) {
    // console.error("Get products error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /products/:id - Get a specific product by ID
router.get("/:id", authenticateToken, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const product = await productService.getProductById(id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(product);
  } catch (_error) {
    // console.error("Get product error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /products/by-barcode/:barcode - Get a specific product by barcode
router.get(
  "/by-barcode/:barcode",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const barcode = req.params.barcode;
      const product = await productService.getProductByBarcode(barcode);

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      res.json(product);
    } catch (_error) {
      // console.error("Get product by barcode error:", _error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// POST /products - Create a new product
router.post("/", authenticateToken, async (req: Request, res: Response) => {
  const { barcode, sku, name, costPrice } = req.body;
  if (!barcode || !sku || !name || costPrice === undefined) {
    return res.status(400).json({ message: "Missing required product fields" });
  }

  try {
    const newProduct = await productService.createProduct({
      barcode,
      sku,
      name,
      costPrice,
    } as Omit<Product, "id" | "createdAt" | "updatedAt">);
    res.status(201).json(newProduct);
  } catch (_error) {
    // console.error("Create product error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// PUT /products/:id - Update a product
router.put("/:id", authenticateToken, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { barcode, sku, name, costPrice } = req.body;

    // Build update object
    const updateData: Partial<Omit<Product, "id" | "createdAt" | "updatedAt">> =
      {};
    if (barcode !== undefined) updateData.barcode = barcode;
    if (sku !== undefined) updateData.sku = sku;
    if (name !== undefined) updateData.name = name;
    if (costPrice !== undefined) updateData.costPrice = costPrice;

    const updatedProduct = await productService.updateProduct(id, updateData);

    if (!updatedProduct) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(updatedProduct);
  } catch (_error) {
    // console.error("Update product error:", _error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /products/:id - Delete a product
router.delete(
  "/:id",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await productService.deleteProduct(id);

      if (!deleted) {
        return res.status(404).json({ message: "Product not found" });
      }

      res.json({ message: "Product deleted successfully" });
    } catch (_error) {
      // console.error("Delete product error:", _error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

export default router;
