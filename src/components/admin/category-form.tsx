"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus } from "lucide-react";
import { createCategory } from "@/lib/actions/products";
import { Alert, Button, Input } from "@/components/ui";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="shrink-0">
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Plus className="size-4" />
      )}
      Add
    </Button>
  );
}

export function CategoryForm() {
  const [state, action] = useActionState(createCategory, { ok: false });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      {state.error ? <Alert>{state.error}</Alert> : null}
      <div className="flex gap-2">
        <Input
          name="name"
          required
          maxLength={60}
          placeholder="Mugs, Prints, Consulting…"
          aria-label="Category name"
        />
        <Submit />
      </div>
    </form>
  );
}
