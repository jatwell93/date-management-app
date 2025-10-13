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
import { apiService } from "../lib/api.service";

interface StoreArea {
  id: number;
  name: string;
  subDepartment?: string; // New field for sub-departments
  lastChecked?: string; // Changed from last_checked to lastChecked to match backend model
}

interface StoreAreaManagementPageProps {
  token: string | null;
}

export function StoreAreaManagementPage({
  token,
}: StoreAreaManagementPageProps) {
  const [storeAreas, setStoreAreas] = useState<StoreArea[]>([]);
  const [newAreaName, setNewAreaName] = useState<string>("");
  const [newSubDepartmentName, setNewSubDepartmentName] = useState<string>(""); // New state
  const [editingArea, setEditingArea] = useState<StoreArea | null>(null);
  const [editedAreaName, setEditedAreaName] = useState<string>("");
  const [editedSubDepartmentName, setEditedSubDepartmentName] =
    useState<string>(""); // New state
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchStoreAreas = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiService.get<StoreArea[]>("/store-areas", token);
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
      await apiService.post(
        "/store-areas",
        {
          name: newAreaName,
          subDepartment: newSubDepartmentName,
        },
        token,
      );
      setSuccessMessage("Store area added successfully!");
      setNewAreaName("");
      setNewSubDepartmentName(""); // Clear sub-department input
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
    newSubDepartmentName,
    fetchStoreAreas,
    setError,
    setSuccessMessage,
    setNewAreaName,
    setNewSubDepartmentName,
  ]);

  const handleEditArea = useCallback(async () => {
    if (!token || !editingArea || !editedAreaName.trim()) {
      setError("Store area name cannot be empty.");
      return;
    }
    try {
      await apiService.put(
        `/store-areas/${editingArea.id}`,
        {
          name: editedAreaName,
          subDepartment: editedSubDepartmentName,
        },
        token,
      );
      setSuccessMessage("Store area updated successfully!");
      setEditingArea(null);
      setEditedAreaName("");
      setEditedSubDepartmentName(""); // Clear sub-department input
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
    editedSubDepartmentName,
    fetchStoreAreas,
    setError,
    setSuccessMessage,
    setEditingArea,
    setEditedAreaName,
    setEditedSubDepartmentName,
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
        await apiService.delete(`/store-areas/${id}`, token);
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
            <p className="text-inventory-error-500 text-sm text-center mt-4">
              Error: {error}
            </p>
          )}
          {successMessage && (
            <p className="text-inventory-success-500 text-sm text-center mt-4">
              {successMessage}
            </p>
          )}

          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">Add New Store Area</h3>
            <div className="flex space-x-2 mb-2">
              <Input
                type="text"
                placeholder="Area Name"
                value={newAreaName}
                onChange={(e) => setNewAreaName(e.target.value)}
                className="flex-grow"
              />
              <Input
                type="text"
                placeholder="Sub-Department (Optional)"
                value={newSubDepartmentName}
                onChange={(e) => setNewSubDepartmentName(e.target.value)}
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
                  <TableHead>Sub-Department</TableHead> {/* New TableHead */}
                  <TableHead>Last Checked</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {storeAreas.map((area) => (
                  <TableRow key={area.id}>
                    <TableCell>{area.id}</TableCell>
                    <TableCell>{area.name}</TableCell>

                    <TableCell>{area.subDepartment || "N/A"}</TableCell>
                    <TableCell>
                      {area.lastChecked
                        ? new Date(area.lastChecked).toLocaleString()
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
                              setEditedSubDepartmentName(
                                area.subDepartment || "",
                              ); // Initialize sub-department
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
                            <div className="grid grid-cols-4 items-center gap-4">
                              {" "}
                              {/* New input for sub-department */}
                              <Label
                                htmlFor="editedSubDepartmentName"
                                className="text-right"
                              >
                                Sub-Department
                              </Label>
                              <Input
                                id="editedSubDepartmentName"
                                value={editedSubDepartmentName}
                                onChange={(e) =>
                                  setEditedSubDepartmentName(e.target.value)
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
