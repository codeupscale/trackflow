"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EmployeeDetailRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/hr/employees");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="flex items-center gap-2 text-muted-foreground">
        <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
        Redirecting...
      </div>
    </div>
  );
}
