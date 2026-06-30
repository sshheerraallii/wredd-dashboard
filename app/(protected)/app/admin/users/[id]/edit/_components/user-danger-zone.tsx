"use client";

import * as React from "react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { archiveUser, restoreUser, deleteUser } from "../../../actions/archive";

export function UserDangerZone({
  userId,
  isArchived,
  isSuperAdmin,
}: {
  userId: string;
  isArchived: boolean;
  isSuperAdmin: boolean;
}) {
  const [pending, start] = useTransition();

  function runArchive() {
    start(async () => {
      const fd = new FormData();
      fd.set("userId", userId);
      await archiveUser(fd);
    });
  }

  function runRestore() {
    start(async () => {
      const fd = new FormData();
      fd.set("userId", userId);
      await restoreUser(fd);
    });
  }

  function runDelete() {
    start(async () => {
      const fd = new FormData();
      fd.set("userId", userId);
      await deleteUser(fd);
    });
  }

  return (
    <div className="mt-10 rounded-xl border p-4">
      <div className="text-sm font-medium">Danger zone</div>
      <div className="mt-1 text-xs text-muted-foreground">
        Archive disables access immediately (recommended). Delete is permanent and will be blocked if
        the user has linked data.
      </div>

      {isSuperAdmin ? (
        <div className="mt-4 text-xs text-muted-foreground">
          SUPER_ADMIN cannot be archived or deleted.
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!isArchived ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={pending}>Archive user</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive this user?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This blocks login and access to /app immediately.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction disabled={pending} onClick={runArchive}>
                    {pending ? "Archiving…" : "Archive"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={runRestore}
            >
              {pending ? "Restoring…" : "Restore user"}
            </Button>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                disabled={pending}
                className="border-destructive text-destructive hover:text-destructive"
              >
                Delete permanently
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
                <AlertDialogDescription>
                  This cannot be undone. If the user has linked assignments/messages/payments,
                  deletion will be blocked and you should archive instead.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <AlertDialogAction disabled={pending} onClick={runDelete}>
                  {pending ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
