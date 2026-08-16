import { useCallback, useMemo, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { captureError } from "@sailo/observability";
import { interpolate } from "@sailo/i18n/native";
import {
  Banner,
  Button,
  ErrorState,
  GroupedList,
  Screen,
  Section,
  Skeleton,
  Switch,
  Text,
  TextField,
  haptics,
} from "@sailo/design-system/native";
import { useT } from "../../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../../lib/query";
import { errorMessage } from "../../../../components/states";

/**
 * One rail's settings — the screen that unbreaks a shop.
 *
 * A SAVE BUTTON, WHERE SETTINGS HAS NONE
 *
 * `(tabs)/settings/index.tsx` argues that a settings screen batching changes
 * behind a save button is one that can be left in a state the seller believes
 * they set and did not, and every control there commits on the spot. This
 * screen deliberately does the opposite, because the unit of change here is not
 * a control — it is a *rail*. The switch and the fields are one decision: the
 * server refuses to enable a rail whose required fields are blank, so a toggle
 * that committed on its own would be refused for a field the seller was still
 * typing into.
 *
 * WHY THE REFUSAL IS RENDERED RATHER THAN PREVENTED
 *
 * The form could grey the switch out until the fields are full, and does not.
 * `saveRail` is the authority on what "configured" means — it reads the same
 * `PAYMENT_METHOD_DEFS` the storefront does — and a client that guessed the
 * rule would eventually guess differently. So the switch is always tappable,
 * the server answers, and the answer is shown against the fields it names.
 */
export default function RailSettings() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const { a, t } = useT();
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const rails = useQuery(trpc.payments.rails.queryOptions());
  const rail = useMemo(
    () => rails.data?.rails.find((row) => row.type === type),
    [rails.data?.rails, type],
  );

  /*
   * The draft, seeded once the rail arrives and owned by this screen after
   * that. Keyed on the rail's own identity so that a refetch landing mid-edit
   * — which `refetchOnWindowFocus` will do the moment the seller switches apps
   * to copy their bank details — cannot overwrite what they have typed.
   */
  const [draft, setDraft] = useState<{ config: Record<string, string>; label: string } | null>(
    null,
  );
  const [enabled, setEnabled] = useState<boolean | null>(null);
  /** The field keys the server refused for, so the message sits on them. */
  const [missing, setMissing] = useState<readonly string[]>([]);

  const config = draft?.config ?? (rail?.config as Record<string, string> | undefined) ?? {};
  const label = draft?.label ?? rail?.label ?? "";
  const isEnabled = enabled ?? rail?.isEnabled ?? false;

  const setField = useCallback(
    (key: string, value: string) =>
      setDraft((current) => ({
        config: { ...(current?.config ?? config), [key]: value },
        label: current?.label ?? label,
      })),
    [config, label],
  );

  const save = useMutation(
    trpc.payments.saveRail.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        setMissing([]);
        /* The list behind this screen counts usable rails in its banner, so it
           has to be re-read rather than left showing the old count. */
        await queryClient.invalidateQueries(trpc.payments.rails.pathFilter());
        router.back();
      },
      onError: (error) => {
        const refused = unconfigured(error);
        if (refused) {
          /* Not reported: this is the server correctly refusing input, the same
             judgement `reportQueryError` makes about a 4xx. */
          haptics.error();
          setMissing(refused);
          return;
        }
        haptics.error();
        captureError(error, { scope: "mobile:payments:saveRail" });
      },
    }),
  );

  if (rails.error) {
    reportQueryError(rails.error, { scope: "mobile:payments:rail" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(rails.error, a.payments.stripeErrorTitle)}
          onRetry={() => void rails.refetch()}
          retryLabel={t.errors.retry}
          retrying={rails.isFetching}
        />
      </Screen>
    );
  }

  if (rails.isPending) {
    return (
      <Screen>
        <Skeleton shape="card" count={2} />
      </Screen>
    );
  }

  if (!rail) {
    return (
      <Screen scroll={false}>
        <ErrorState message={a.common.couldntLoad} onRetry={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen
      /*
       * The save is pinned, and this screen is why `Screen` grew a footer.
       *
       * It is a form with two text fields: tapping either raises the keyboard
       * over the bottom half of the page, and the button that commits the edit
       * was the last thing in the scroll — so the seller's move was to dismiss
       * the keyboard, scroll, and only then save. In the footer it rides the
       * keyboard's own frame (`keyboard.ts`), so it is above the thumb that is
       * still typing.
       */
      footer={
        <Button
          label={a.common.save}
          variant="primary"
          size="lg"
          fullWidth
          loading={save.isPending}
          onPress={() =>
            save.mutate({
              type: rail.type,
              config,
              isEnabled,
              label: label.trim() || null,
            })
          }
        />
      }
      testID={`rail-${rail.type}`}
    >
      {/* The rail's own name, once it is known. Declared here rather than in
          the stack layout so the header does not flash a placeholder before
          the query lands. */}
      <Stack.Screen options={{ title: rail.name }} />

      {/*
        The description reads on the page, not inside a card.
        A `Card` around a single paragraph of explanatory prose is a border
        drawn around a sentence — it says "this is one thing, raised above the
        page" about something that is neither. This screen had three of them,
        which is how it came to look like a stack of empty boxes.
      */}
      <Text variant="callout" tone="muted">
        {rail.description}
      </Text>

      {/*
        The currency refusal, stated before the form rather than after a failed
        save. A seller in Jordan filling in a Venmo handle is doing work that
        cannot come to anything, and the dictionary string names their currency
        as well as the supported ones — "PayPal settles in 22 currencies" reads
        as trivia and "your shop is in JOD" reads as the reason.
      */}
      {!rail.available ? (
        <Banner
          tone="neutral"
          message={interpolate(a.payments.currencyOnly, {
            method: rail.name,
            currency: rails.data?.currency ?? "",
            currencies: (rail.currencies ?? []).join(", "),
          })}
          testID="rail-unavailable"
        />
      ) : null}

      {missing.length > 0 ? (
        <Banner tone="danger" message={a.payments.fillInFirst} testID="rail-refused" />
      ) : null}

      {rail.fields.length > 0 ? (
        /* A `Section`, not a `Card`. Every `TextField` already draws its own
           border and its own label; a card around a column of them is a
           surface inside a surface, and it insets the fields from the page by
           a different amount than everything else on the screen. */
        <Section>
          {rail.fields.map((field) => (
            <TextField
              key={field.key}
              label={field.label}
              hint={field.hint}
              placeholder={field.placeholder}
              value={config[field.key] ?? ""}
              onChangeText={(value) => setField(field.key, value)}
              multiline={field.multiline}
              /* The server named this field; the message goes on it rather
                 than only in the banner above. */
              error={missing.includes(field.key) ? a.payments.fillInFirst : undefined}
            />
          ))}
        </Section>
      ) : null}

      {/* Same again: a field draws its own edge, so a card around one is two
          borders and two insets for a single input. */}
      <Section>
        <TextField
          label={a.payments.buttonText}
          hint={interpolate(a.payments.buttonTextHint, { name: rail.name })}
          placeholder={rail.name}
          value={label}
          onChangeText={(value) => setDraft({ config, label: value })}
        />
      </Section>

      <GroupedList>
        <Switch
          value={isEnabled}
          onValueChange={setEnabled}
          label={a.payments.showOnShop}
          /* Disabled only where switching it on could never work — a currency
             the rail cannot settle. Not disabled for "unconfigured", because
             the server owns that rule and this screen must not guess it. */
          disabled={!rail.available}
          hint={rail.available ? undefined : a.payments.unavailableHere}
        />
      </GroupedList>

    </Screen>
  );
}

/**
 * The blank field keys out of a refusal, or null if this was a real failure.
 *
 * `saveRail` answers `unconfigured:phone,handle` — the fact in the code and the
 * wording left to whoever is drawing the screen, which is the convention
 * `products.save` set. Parsed rather than pattern-matched on a sentence,
 * because a sentence is exactly what changes when somebody translates it.
 */
function unconfigured(error: unknown): readonly string[] | null {
  if (!(error instanceof TRPCClientError)) return null;
  const message = String(error.message ?? "");
  if (!message.startsWith("unconfigured:")) return null;
  return message.slice("unconfigured:".length).split(",").filter(Boolean);
}
