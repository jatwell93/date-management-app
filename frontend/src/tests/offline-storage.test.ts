import { offlineStorage } from "../lib/offline-storage";

describe("offlineStorage", () => {
  beforeEach(async () => {
    await offlineStorage.clear();
  });

  it("should set and get an item", async () => {
    await offlineStorage.setItem("testKey", { value: "testValue" });
    const item = await offlineStorage.getItem("testKey");
    expect(item).toEqual({ value: "testValue" });
  });

  it("should return null for a non-existent item", async () => {
    const item = await offlineStorage.getItem("nonExistentKey");
    expect(item).toBeNull();
  });

  it("should remove an item", async () => {
    await offlineStorage.setItem("testKey", "testValue");
    await offlineStorage.removeItem("testKey");
    const item = await offlineStorage.getItem("testKey");
    expect(item).toBeNull();
  });

  it("should clear all items", async () => {
    await offlineStorage.setItem("key1", "value1");
    await offlineStorage.setItem("key2", "value2");
    await offlineStorage.clear();
    const keys = await offlineStorage.keys();
    expect(keys).toEqual([]);
  });

  it("should return all keys", async () => {
    await offlineStorage.setItem("key1", "value1");
    await offlineStorage.setItem("key2", "value2");
    const keys = await offlineStorage.keys();
    expect(keys).toEqual(["key1", "key2"]);
  });
});
