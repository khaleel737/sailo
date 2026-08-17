"use client";

/**
 * Typing a code in, when the camera cannot read it.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Card, Field, Input } from "@sailo/design-system/web";
import type { CheckinLabels } from "./labels";

/* -------------------------------------------------------------------------- */
/*  Typing a code                                                              */
/* -------------------------------------------------------------------------- */

export function ManualForm({
  labels: a,
  busy,
  onCode,
}: {
  labels: CheckinLabels;
  busy: boolean;
  onCode: (code: string) => void | Promise<void>;
}) {
  const [code, setCode] = useState("");

  return (
    <Card className="p-5">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!code.trim()) return;
          await onCode(code);
          setCode("");
        }}
        className="space-y-4"
      >
        <Field label={a.codeLabel} htmlFor="code" hint={a.scanHint}>
          <Input
            id="code"
            name="code"
            required
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            // A code is base32 with a dash. A numeric keypad is wrong and a
            // full keyboard with autocorrect is worse — iOS will happily
            // "fix" a ticket code into a dictionary word.
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABC12-DE345"
            className="font-mono text-lg uppercase"
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {a.submit}
        </Button>
      </form>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  The list                                                                   */
/* -------------------------------------------------------------------------- */
