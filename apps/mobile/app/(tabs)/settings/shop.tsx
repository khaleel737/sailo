import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { captureError } from "@sailo/observability";
import {
  Banner,
  Button,
  Card,
  Chip,
  ErrorState,
  Screen,
  Skeleton,
  Text,
  TextField,
  haptics,
} from "@sailo/design-system/native";
import { useT } from "../../../lib/i18n";
import { reportQueryError, useTRPC } from "../../../lib/query";
import { errorMessage } from "../../../components/states";

/**
 * The shop as a buyer sees it: its name, what it says about itself, and the
 * colour of every button on the storefront.
 *
 * `shop.update` has accepted all of this since it was written and no screen has
 * ever called it. That is the gap this closes — a seller could change their
 * shop's name from a laptop and from nowhere else, which for a shop named in a
 * hurry on the day it opened is the single most likely thing they want to fix.
 *
 * WHAT IS NOT HERE YET, AND WHY
 *
 * The avatar and the logo. `shop.update` takes both as URLs and `uploads.token`
 * already mints permission to put a file in blob storage — the missing piece is
 * `expo-image-picker`, which is a native module and therefore a dev-client
 * rebuild. It is deferred to the same rebuild the product photo work needs
 * rather than taken twice. The fields are absent rather than disabled: a
 * control that cannot work is worse than one that is honestly not there.
 *
 * The handle is absent for a different and permanent reason. Changing it moves
 * the storefront and breaks every link already shared — `shop.update`'s own
 * allowlist leaves it out and says so. It is not a settings edit.
 */

/**
 * A save button, and this time it is not the exception `payments/[type].tsx`
 * had to argue for.
 *
 * The settings screen next door commits every control on the spot, because each
 * one is independent and a batch can be left half-applied. These fields are one
 * thing — a shop's public face — and a seller changing a name and a description
 * together means both or neither. Saving the name the instant they stopped
 * typing would also publish a half-typed name to a live storefront.
 */
type Draft = {
  name: string;
  description: string;
  location: string;
  accentColor: string;
};

/**
 * The accents a seller can pick without a colour wheel.
 *
 * A palette rather than a picker, and the constraint is the point: every one of
 * these clears 4.5:1 against white for the button text the storefront draws on
 * top of it. A free hex field would let a seller choose a yellow that renders
 * their own Order button unreadable, and they would never see it — they are not
 * the ones checking out.
 *
 * The seller's current colour is always offered even when it is not on this
 * list, because it may have been set from the web where the full picker lives;
 * dropping it would silently change their shop the moment they opened this
 * screen and saved anything at all.
 */
const ACCENTS = [
  "#037740",
  "#0B63CE",
  "#6D28D9",
  "#B42318",
  "#B54708",
  "#0F766E",
  "#1A1917",
] as const;

export default function ShopProfile() {
  const { a, t } = useT();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const shop = useQuery(trpc.shop.get.queryOptions());
  const [draft, setDraft] = useState<Draft | null>(null);

  /*
   * The saved values until the seller touches something, then theirs. A
   * refetch — which `refetchOnWindowFocus` fires whenever they leave the app to
   * copy a line of their own bio from somewhere else — must not overwrite what
   * they are part way through typing.
   */
  const current: Draft = useMemo(
    () => ({
      name: shop.data?.name ?? "",
      description: shop.data?.description ?? "",
      location: shop.data?.location ?? "",
      accentColor: shop.data?.accentColor ?? ACCENTS[0],
    }),
    [shop.data],
  );

  const value = draft ?? current;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(current);

  const set = useCallback(
    <K extends keyof Draft>(key: K, next: Draft[K]) =>
      setDraft((held) => ({ ...(held ?? current), [key]: next })),
    [current],
  );

  const save = useMutation(
    trpc.shop.update.mutationOptions({
      onSuccess: async () => {
        haptics.success();
        setDraft(null);
        /* Every screen that renders the shop — Home's share link, Insights'
           currency, the catalogue's prices — reads this same query. */
        await queryClient.invalidateQueries(trpc.shop.pathFilter());
      },
      onError: (error) => {
        haptics.error();
        captureError(error, { scope: "mobile:settings:shop" });
      },
    }),
  );

  const refresh = useCallback(() => void shop.refetch(), [shop.refetch]);

  if (shop.error) {
    reportQueryError(shop.error, { scope: "mobile:settings:shop" });
    return (
      <Screen scroll={false}>
        <ErrorState
          message={errorMessage(shop.error, a.common.couldntLoad)}
          onRetry={refresh}
          retryLabel={t.errors.retry}
          retrying={shop.isFetching}
        />
      </Screen>
    );
  }

  if (shop.isPending) {
    return (
      <Screen>
        <Skeleton shape="card" count={3} />
      </Screen>
    );
  }

  /* The seller's own colour, kept in the list even when it came from the web's
     full picker. See the note on ACCENTS. */
  const swatches = ACCENTS.includes(value.accentColor as (typeof ACCENTS)[number])
    ? ACCENTS
    : [value.accentColor, ...ACCENTS];

  return (
    <Screen onRefresh={refresh} refreshing={shop.isFetching} testID="settings-shop">
      <Card padding="lg">
        <TextField
          label={a.settings.shopName}
          value={value.name}
          onChangeText={(next) => set("name", next)}
          maxLength={120}
        />
        <TextField
          label={a.settings.shopDescription}
          value={value.description}
          onChangeText={(next) => set("description", next)}
          multiline
          maxLength={2000}
        />
        <TextField
          label={a.settings.location}
          hint={a.common.optional}
          placeholder={a.settings.locationPlaceholder}
          value={value.location}
          onChangeText={(next) => set("location", next)}
          maxLength={200}
        />
      </Card>

      <Card padding="lg">
        <Text variant="label" heading>
          {a.settings.accentColour}
        </Text>
        <View style={styles.swatches}>
          {swatches.map((colour) => (
            <Chip
              key={colour}
              /*
               * The hex itself is the label. A name would have to be
               * translated into thirty-five languages for seven colours, and
               * "Emerald" tells a seller less about what their buttons will
               * look like than the swatch beside it already does.
               */
              label={colour.toUpperCase()}
              selected={value.accentColor.toLowerCase() === colour.toLowerCase()}
              onPress={() => set("accentColor", colour)}
            />
          ))}
        </View>
        <Text variant="caption" tone="muted">
          {a.settings.customAccent}
        </Text>
      </Card>

      {/*
        The two things this screen cannot do, said where a seller would look for
        them rather than left as controls that do nothing. `store/index.tsx`
        does the same for product photos, for the same missing dependency.
      */}
      <Banner tone="info" message={a.settings.imagesOnWeb} />

      <Button
        label={a.common.save}
        onPress={() =>
          save.mutate({
            name: value.name.trim(),
            /* Empty is null, not "". The column is nullable and the storefront
               renders the difference: a shop with `""` for a description draws
               an empty paragraph where one with null draws nothing. */
            description: value.description.trim() || null,
            location: value.location.trim() || null,
            accentColor: value.accentColor,
          })
        }
        loading={save.isPending}
        /* Nothing to save is not an error — the button simply is not one. */
        disabled={!dirty || value.name.trim().length === 0}
        fullWidth
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
