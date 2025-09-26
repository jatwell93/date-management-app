export interface User {
  id: number;
  pin: string;
  role: "Manager" | "Team Member";
  created_at: string;
  updated_at: string;
}
