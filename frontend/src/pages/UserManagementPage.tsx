import React, { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

interface User {
  id: number;
  pin: string; // In a real app, this would not be exposed
  role: "Manager" | "Team Member";
}

interface UserManagementPageProps {
  token: string | null;
}

export function UserManagementPage({ token }: UserManagementPageProps) {
  const form = useForm<{
    pin: string;
    role: "Manager" | "Team Member";
    selectedUserForEdit: string;
    selectedUserForDelete: string;
  }>();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const fetchUsers = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch("http://localhost:3001/users", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error("Failed to fetch users");
      }
      const data: User[] = await response.json();
      setUsers(data);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
    }
  }, [token, setUsers, setError]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]); // Re-fetch users if token changes

  const onCreateSubmit = useCallback(
    async (data: { pin: string; role: "Manager" | "Team Member" }) => {
      setError(null);
      setSuccess(null);
      if (!token) {
        setError("Not authenticated.");
        return;
      }
      try {
        const response = await fetch("http://localhost:3001/users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to create user");
        }

        setSuccess("User created successfully!");
        form.reset();
        fetchUsers(); // Refresh user list after creation
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("An unknown error occurred");
        }
      }
    },
    [token, fetchUsers, setError, setSuccess, form],
  );

  const onEditSubmit = useCallback(
    async (data: { role: "Manager" | "Team Member" }) => {
      setError(null);
      setSuccess(null);
      if (!token || selectedUserId === null) {
        setError("Not authenticated or no user selected.");
        return;
      }
      try {
        const response = await fetch(
          `http://localhost:3001/users/${selectedUserId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ role: data.role }),
          },
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to update user");
        }

        setSuccess("User updated successfully!");
        fetchUsers(); // Refresh user list after update
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("An unknown error occurred");
        }
      }
    },
    [token, selectedUserId, fetchUsers, setError, setSuccess],
  );

  const onResetPin = useCallback(async () => {
    setError(null);
    setSuccess(null);
    if (!token || selectedUserId === null) {
      setError("Not authenticated or no user selected.");
      return;
    }
    if (
      !window.confirm("Are you sure you want to reset the PIN for this user?")
    ) {
      return;
    }
    try {
      const response = await fetch(
        `http://localhost:3001/users/${selectedUserId}/reset-pin`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to reset PIN");
      }

      setSuccess("User PIN reset successfully!");
      fetchUsers(); // Refresh user list after PIN reset
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
    }
  }, [token, selectedUserId, fetchUsers, setError, setSuccess]);

  const onDeleteUser = useCallback(async () => {
    setError(null);
    setSuccess(null);
    const userToDeleteId = form.getValues("selectedUserForDelete");
    if (!token || !userToDeleteId) {
      setError("Not authenticated or no user selected for deletion.");
      return;
    }
    if (!window.confirm("Are you sure you want to delete this user?")) {
      return;
    }
    try {
      const response = await fetch(
        `http://localhost:3001/users/${userToDeleteId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to delete user");
      }

      setSuccess("User deleted successfully!");
      form.reset({
        selectedUserForDelete: "",
      });
      fetchUsers(); // Refresh user list after deletion
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
    }
  }, [token, form, fetchUsers, setError, setSuccess]);

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">
        User Management (Managers Only)
      </h1>

      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Current Users</h2>
        {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
        {users.length === 0 ? (
          <p>No users found.</p>
        ) : (
          <ul>
            {users.map((user) => (
              <li key={user.id} className="mb-1">
                ID: {user.id}, Role: {user.role}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Create New User</h2>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onCreateSubmit)}
            className="space-y-4 md:w-1/2 lg:w-1/3"
          >
            <FormField
              control={form.control}
              name="pin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>PIN</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Enter user PIN"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Manager">Manager</SelectItem>
                      <SelectItem value="Team Member">Team Member</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            {success && <p className="text-green-500 text-sm">{success}</p>}
            <Button type="submit" className="w-full">
              Create User
            </Button>
          </form>
        </Form>
      </div>

      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Edit Existing User</h2>
        <Form {...form}>
          <div className="space-y-4 md:w-1/2 lg:w-1/3">
            <FormField
              control={form.control}
              name="selectedUserForEdit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select User to Edit</FormLabel>
                  <Select
                    onValueChange={(value: string) => {
                      field.onChange(value);
                      setSelectedUserId(Number(value));
                      const userToEdit = users.find(
                        (u) => u.id === Number(value),
                      );
                      if (userToEdit) {
                        form.setValue("role", userToEdit.role);
                      }
                    }}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a user" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={String(user.id)}>
                          ID: {user.id}, Role: {user.role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <form onSubmit={form.handleSubmit(onEditSubmit)}>
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Manager">Manager</SelectItem>
                        <SelectItem value="Team Member">Team Member</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {error && <p className="text-red-500 text-sm">{error}</p>}
              {success && <p className="text-green-500 text-sm">{success}</p>}
              <Button type="submit" className="w-full mt-4">
                Update User
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full mt-2"
                onClick={onResetPin}
              >
                Reset PIN
              </Button>
            </form>
          </div>
        </Form>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Delete User</h2>
        <Form {...form}>
          <div className="space-y-4 md:w-1/2 lg:w-1/3">
            <FormField
              control={form.control}
              name="selectedUserForDelete"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select User to Delete</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a user" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={String(user.id)}>
                          ID: {user.id}, Role: {user.role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
            {success && (
              <p className="text-green-500 text-sm mt-2">{success}</p>
            )}
            <Button
              variant="destructive"
              className="w-full"
              onClick={onDeleteUser}
            >
              Delete User
            </Button>
          </div>
        </Form>
      </div>
    </div>
  );
}
