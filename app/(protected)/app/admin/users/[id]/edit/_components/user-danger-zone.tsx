"use client";

import * as React from "react";
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
  const archiveRef = React.useRef<HTMLFormElement | null>(null);
  const restoreRef = React.useRef<HTMLFormElement | null>(null);
  const deleteRef = React.useRef<HTMLFormElement | null>(null);

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
          {/* Real forms live in normal DOM (not inside dialog portal) */}
          <form ref={archiveRef} action={archiveUser}>
            <input type="hidden" name="userId" value={userId} />
          </form>

          <form ref={restoreRef} action={restoreUser}>
            <input type="hidden" name="userId" value={userId} />
          </form>

          <form ref={deleteRef} action={deleteUser}>
            <input type="hidden" name="userId" value={userId} />
          </form>

          {!isArchived ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Archive user</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive this user?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This blocks login and access to /app immediately.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      archiveRef.current?.requestSubmit();
                    }}
                  >
                    Archive
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                restoreRef.current?.requestSubmit();
              }}
            >
              Restore user
            </Button>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
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
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    deleteRef.current?.requestSubmit();
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
