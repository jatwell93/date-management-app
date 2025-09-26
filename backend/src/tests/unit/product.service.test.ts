import { ProductService } from "../../services/product.service";
import { getDb } from "../../database";

// Mock the database module
jest.mock("../../database", () => ({
  getDb: jest.fn(),
}));

describe("ProductService", () => {
  let productService: ProductService;
  interface MockDatabase {
    get: jest.Mock;
    run: jest.Mock;
  }
  let mockDb: MockDatabase;

  beforeEach(() => {
    productService = new ProductService();
    mockDb = {
      get: jest.fn(),
      run: jest.fn(),
    };
    (getDb as jest.Mock).mockResolvedValue(mockDb);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return a product by barcode", async () => {
    const mockProduct = {
      id: 1,
      barcode: "123",
      sku: "SKU1",
      name: "Product 1",
      cost_price: 10.0,
      created_at: "now",
      updated_at: "now",
    };
    mockDb.get.mockResolvedValue(mockProduct);

    const product = await productService.getProductByBarcode("123");

    expect(product).toEqual(mockProduct);
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(mockDb.get).toHaveBeenCalledWith(
      "SELECT * FROM products WHERE barcode = ?",
      "123",
    );
  });

  it("should return null if product not found by barcode", async () => {
    mockDb.get.mockResolvedValue(undefined);

    const product = await productService.getProductByBarcode("non_existent");

    expect(product).toBeNull();
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(mockDb.get).toHaveBeenCalledWith(
      "SELECT * FROM products WHERE barcode = ?",
      "non_existent",
    );
  });

  it("should create a new product", async () => {
    const newProductData = {
      barcode: "456",
      sku: "SKU2",
      name: "Product 2",
      cost_price: 20.0,
    };
    mockDb.run.mockResolvedValue({ lastID: 2 });

    const createdProduct = await productService.createProduct(newProductData);

    expect(createdProduct).toEqual(
      expect.objectContaining({
        id: 2,
        ...newProductData,
      }),
    );
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(mockDb.run).toHaveBeenCalledWith(
      "INSERT INTO products (barcode, sku, name, cost_price) VALUES (?, ?, ?, ?)",
      newProductData.barcode,
      newProductData.sku,
      newProductData.name,
      newProductData.cost_price,
    );
  });
});
