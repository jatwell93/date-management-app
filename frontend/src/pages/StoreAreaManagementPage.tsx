import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "../components/ui/dialog";

interface StoreArea {
  id: number;
  name: string;
  last_checked: string | null;
}

interface StoreAreaManagementPageProps {
  token: string | null;
}

export function StoreAreaManagementPage({
  token,
}: StoreAreaManagementPageProps) {
  const [storeAreas, setStoreAreas] = useState<StoreArea[]>([]);
  const [newAreaName, setNewAreaName] = useState<string>("");
  const [editingArea, setEditingArea] = useState<StoreArea | null>(null);
  const [editedAreaName, setEditedAreaName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchStoreAreas = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch("http://localhost:3001/store-areas", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error("Failed to fetch store areas");
      }
      const data = await response.json();
      setStoreAreas(data);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
    }
  }, [token, setStoreAreas, setError]);

  useEffect(() => {
    fetchStoreAreas();
  }, [fetchStoreAreas]);

  const handleAddArea = useCallback(async () => {
    if (!token || !newAreaName.trim()) {
      setError("Store area name cannot be empty.");
      return;
    }
    try {
      const response = await fetch("http://localhost:3001/store-areas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newAreaName }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to add store area");
      }
      setSuccessMessage("Store area added successfully!");
      setNewAreaName("");
      fetchStoreAreas();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
      setSuccessMessage(null);
    }
  }, [
    token,
    newAreaName,
    fetchStoreAreas,
    setError,
    setSuccessMessage,
    setNewAreaName,
  ]);

  const handleEditArea = useCallback(async () => {
    if (!token || !editingArea || !editedAreaName.trim()) {
      setError("Store area name cannot be empty.");
      return;
    }
    try {
      const response = await fetch(
        `http://localhost:3001/store-areas/${editingArea.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ name: editedAreaName }),
        },
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to update store area");
      }
      setSuccessMessage("Store area updated successfully!");
      setEditingArea(null);
      setEditedAreaName("");
      fetchStoreAreas();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
      setSuccessMessage(null);
    }
  }, [
    token,
    editingArea,
    editedAreaName,
    fetchStoreAreas,
    setError,
    setSuccessMessage,
    setEditingArea,
    setEditedAreaName,
  ]);

  const handleDeleteArea = useCallback(
    async (id: number) => {
      if (
        !token ||
        !window.confirm("Are you sure you want to delete this store area?")
      ) {
        return;
      }
      try {
        const response = await fetch(
          `http://localhost:3001/store-areas/${id}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to delete store area");
        }
        setSuccessMessage("Store area deleted successfully!");
        fetchStoreAreas();
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("An unknown error occurred");
        }
        setSuccessMessage(null);
      }
    },
    [token, fetchStoreAreas, setError, setSuccessMessage],
  );

  return (
    <div className="container mx-auto p-4">
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="text-center">Store Area Management</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="text-red-500 text-sm text-center mt-4">
              Error: {error}
            </p>
          )}
          {successMessage && (
            <p className="text-green-500 text-sm text-center mt-4">
              {successMessage}
            </p>
          )}

          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">Add New Store Area</h3>
            <div className="flex space-x-2">
              <Input
                type="text"
                placeholder="New Area Name"
                value={newAreaName}
                onChange={(e) => setNewAreaName(e.target.value)}
                className="flex-grow"
              />
              <Button onClick={handleAddArea}>Add Area</Button>
            </div>
          </div>

          <h3 className="text-lg font-semibold mb-2">Existing Store Areas</h3>
          {storeAreas.length === 0 ? (
            <p className="text-center text-gray-500">No store areas found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Last Checked</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {storeAreas.map((area) => (
                  <TableRow key={area.id}>
                    <TableCell>{area.id}</TableCell>
                    <TableCell>{area.name}</TableCell>
                    <TableCell>
                      {area.last_checked
                        ? new Date(area.last_checked).toLocaleString()
                        : "N/A"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mr-2"
                            onClick={() => {
                              setEditingArea(area);
                              setEditedAreaName(area.name);
                            }}
                          >
                            Edit
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Edit Store Area</DialogTitle>
                          </DialogHeader>
                          <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                              <Label
                                htmlFor="editedAreaName"
                                className="text-right"
                              >
                                Name
                              </Label>
                              <Input
                                id="editedAreaName"
                                value={editedAreaName}
                                onChange={(e) =>
                                  setEditedAreaName(e.target.value)
                                }
                                className="col-span-3"
                              />
                            </div>
                          </div>
                          <DialogFooter>
                            <Button onClick={handleEditArea}>
                              Save changes
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteArea(area.id)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
