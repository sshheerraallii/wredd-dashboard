"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DepartmentMultiSelect from "../../[id]/edit/_components/department-multiselect";
import { createUser } from "../actions";

type Dept = { id: string; name: string };

export default function CreateUserForm({ departments }: { departments: Dept[] }) {
  const router = useRouter();
  const [departmentIds, setDepartmentIds] = React.useState<string[]>([]);
  const [role, setRole] = React.useState<string>("REMOTE_WORKER");
  const [workerType, setWorkerType] = React.useState<string>("REMOTE_VIDEO_EDITOR");

  return (
    <form
      className="space-y-6"
      action={async (fd) => {
        fd.set("role", role);
        fd.set("workerType", workerType);
        fd.set("departmentIds", JSON.stringify(departmentIds));
        await createUser(fd);
        router.push("/app/admin/users?ok=User%20created");
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium">Full name</label>
          <Input name="fullName" placeholder="e.g., Ali Khan" required />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Username</label>
          <Input name="username" placeholder="e.g., ali" required />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium">Email</label>
          <Input name="email" type="email" placeholder="e.g., ali@wredd.com" required />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium">Password</label>
          <Input name="password" type="password" minLength={6} required />
          <p className="text-xs text-muted-foreground">
            This is only for admin-created accounts. Invite-based users set their own password.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Role</label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger>
              <SelectValue placeholder="Select role" />
            </SelectTrigger>
            <SelectContent>
              {/* SUPER_ADMIN intentionally NOT available */}
              <SelectItem value="MANAGER">MANAGER</SelectItem>
              <SelectItem value="BUSINESS_DEVELOPER">BUSINESS_DEVELOPER</SelectItem>
              <SelectItem value="REMOTE_WORKER">REMOTE_WORKER</SelectItem>
              <SelectItem value="ONSITE_EMPLOYEE">ONSITE_EMPLOYEE</SelectItem>
            </SelectContent>
          </Select>

          <p className="text-xs text-muted-foreground">
            SUPER_ADMIN is protected and cannot be created from the app.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Worker type</label>
          <Select value={workerType} onValueChange={setWorkerType}>
            <SelectTrigger>
              <SelectValue placeholder="Select worker type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ONSITE_VIDEO_EDITOR">ONSITE_VIDEO_EDITOR</SelectItem>
              <SelectItem value="REMOTE_VIDEO_EDITOR">REMOTE_VIDEO_EDITOR</SelectItem>
              <SelectItem value="ONSITE_ANIMATOR">ONSITE_ANIMATOR</SelectItem>
              <SelectItem value="REMOTE_ANIMATOR">REMOTE_ANIMATOR</SelectItem>
              <SelectItem value="WEB_DEVELOPMENT">WEB_DEVELOPMENT</SelectItem>
              <SelectItem value="OPERATIONS">OPERATIONS</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium">Departments</label>
          <DepartmentMultiSelect
            departments={departments}
            value={departmentIds}
            onChange={setDepartmentIds}
          />
          <p className="text-xs text-muted-foreground">
            Department membership controls visibility for UNASSIGNED projects.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit">Create</Button>
        <Button type="button" variant="secondary" onClick={() => router.push("/app/admin/users")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
