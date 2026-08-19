import { useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Platform, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { variantLabel, } from "@sailo/core/variants";
import { interpolate } from "@sailo/i18n/native";
import { textToPrice } from "@sailo/core/currency";
import {
  Banner,
  Button,
  Card,
  GroupedList,
  ListRow,
  Segmented,
  Sheet,
  Switch,
  Text,
  TextField,
  haptics,
} from "@sailo/design-system/native";
import { pickAndUploadImage } from "../../lib/uploads";
import { KIND_OPTIONS, useStoreCopy, whenLabel } from "./copy";
import {
  draftFrom,
  refusalText,
  toSaveInput,
  type Draft,
} from "./draft";
import { reportQueryError, useTRPC } from "../../lib/query";
import type { ProductDetail, } from "../../lib/models";

/**
 * The product editor, shared by the list screen's "new product" sheet and the
 * detail screen's edit sheet.
 *
 * Five hundred lines, and they were inside `app/(tabs)/store/index.tsx` — the
 * *list* screen — with `store/[id].tsx` importing them back out of it. One
 * route file importing another is not a style problem: it means opening the
 * detail screen loads the list screen's module, and it means the editor's
 * dependencies are indistinguishable from the list's.
 *
 * It is here rather than beside either screen because Expo Router would make a
 * file under `app/` into a route. See `./copy` for the mechanics.
 */

export function ProductEditor({
  visible,
  product,
  currency,
  onClose,
  onSaved,
}: {
  visible: boolean;
  /** `null` creates. Anything else is a full read from `products.get`. */
  product: ProductDetail | null;
  currency: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { a, locale, s } = useStoreCopy();

  const [draft, setDraft] = useState<Draft>(() => draftFrom(product, currency, locale));
  const [dirty, setDirty] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  /*
   * Re-seeded when the sheet opens, not on every render. Reopening on a product
   * the seller just edited has to show what is now stored; a sheet that kept
   * its old draft would silently re-submit a stale price over a newer one.
   */
  useEffect(() => {
    if (!visible) return;
    setDraft(draftFrom(product, currency, locale));
    setDirty(false);
    setRefused(null);
  }, [visible, product, currency, locale]);

  /* Open only while the seller is choosing — a mounted picker on Android is
     a dialog, and one that never closes is a screen nobody can leave. */
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);


  const edit = useCallback((patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  }, []);

  /*
   * Uploaded on pick, appended to the draft, saved with everything else.
   *
   * The bytes cannot wait for Save — they have to be somewhere before there is
   * a URL to store — so the upload happens now and the *reference* happens on
   * Save. `lib/uploads.ts` has the argument for why this posts to a route
   * rather than using `uploads.token`.
   */
  const addPhoto = useCallback(async () => {
    setUploadError(null);
    setUploading(true);
    try {
      const result = await pickAndUploadImage();
      if (result.ok) {
        edit({ imageUrls: [...draft.imageUrls, result.url] });
        return;
      }
      /* Cancelling is not a failure and gets no message — the seller closed a
         picker they opened. */
      if (result.reason !== "cancelled") {
        setUploadError(s.uploadFailed[result.reason] ?? s.uploadFailed.failed);
      }
    } finally {
      setUploading(false);
    }
  }, [draft.imageUrls, edit, s]);

  const setVariant = useCallback(
    (id: string, patch: Partial<Draft["variants"][string]>) => {
      setDraft((current) => {
        const existing = current.variants[id];
        if (!existing) return current;
        return {
          ...current,
          variants: { ...current.variants, [id]: { ...existing, ...patch } },
        };
      });
      setDirty(true);
    },
    [],
  );

  const save = useMutation(
    trpc.products.save.mutationOptions({
      onSuccess: (result) => {
        // Publishing or unpublishing changes what a buyer can see, which is
        // worth confirming through the hand as well as the screen.
        haptics.success();
        /*
         * The whole namespace rather than the one page. A saved product changes
         * its own row, the page it sits on, and — for a new one — every
         * filtered list that should now contain it. `shop` and `analytics` go
         * with it because the Home checklist counts products: a draft still
         * ticks the `product` step, and a seller who just added their first one
         * must not have to pull to refresh to watch it tick.
         */
        void queryClient.invalidateQueries(trpc.products.pathFilter());
        void queryClient.invalidateQueries(trpc.shop.pathFilter());
        void queryClient.invalidateQueries(trpc.analytics.pathFilter());
        setDirty(false);
        onSaved(result.id);
      },
      onError: (error) => {
        reportQueryError(error, { scope: "mobile:store:save" });
        setRefused(refusalText(error, s));
      },
    }),
  );

  /*
   * A digital product's files are invisible to this screen, and `saveProduct`
   * rebuilds the file set from what it is handed — so saving one here would
   * delete every download the seller sells. Refused as a rendered state with
   * somewhere to go, rather than as a Save button that quietly destroys data.
   */
  const refusesDigital = product?.kind === "digital";

  /*
   * A digital product created here would have no files, and this screen has no
   * way to add one — so it would be publishable, orderable, and deliver
   * nothing. Warned rather than removed from the picker: "you cannot sell
   * downloads from the phone" is a different and wronger message than "finish
   * this one on the web", and the seller may well want the row to exist now.
   */
  const newDigital = !product && draft.kind === "digital";

  const canSave =
    !refusesDigital &&
    draft.title.trim().length > 0 &&
    textToPrice(draft.price, currency, locale) !== null &&
    !save.isPending;

  const close = useCallback(() => {
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert(s.unsavedTitle, s.unsavedBody, [
      { text: s.keepEditing, style: "cancel" },
      { text: s.discard, style: "destructive", onPress: onClose },
    ]);
  }, [dirty, onClose, s]);

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={product ? a.products.edit : s.newTitle}
      size="large"
      dismissible={!dirty}
    >
      {refusesDigital || newDigital ? (
        <Card variant="outlined">
          <Text tone="warning">{refusesDigital ? s.digitalOnWeb : s.digitalNeedsFiles}</Text>
        </Card>
      ) : null}

      {refused ? (
        <Card variant="outlined">
          <Text tone="danger">{refused}</Text>
        </Card>
      ) : null}

      {product ? null : <Text tone="muted">{a.products.newSubtitle}</Text>}

      {/*
        The type, chosen once. `Draft.kind` explains why it does not change
        after: each kind reads different columns, and switching one for another
        would leave a live subscription billing against a product that no
        longer knows it is one.

        A new product gets the control; an existing one gets the sentence.
        Neither gets a disabled control, which would read as a thing the seller
        might be allowed to do later.
      */}
      {product ? (
        <Text variant="caption" tone="muted">
          {a.productForm.kindFixed}
        </Text>
      ) : (
        <Segmented
          options={KIND_OPTIONS(a)}
          value={draft.kind}
          onChange={(next) => edit({ kind: next })}
          accessibilityLabel={a.productForm.kind}
        />
      )}

      <TextField
        label={a.productForm.titleLabel}
        placeholder={a.productForm.titlePlaceholder}
        value={draft.title}
        onChangeText={(title) => edit({ title })}
        maxLength={200}
        autoFocus={!product}
        disabled={refusesDigital}
      />

      <TextField
        label={a.productForm.descriptionLabel}
        placeholder={a.productForm.descriptionPlaceholder}
        value={draft.description}
        onChangeText={(description) => edit({ description })}
        multiline
        maxLength={10_000}
        disabled={refusesDigital}
      />

      <TextField
        label={interpolate(a.productForm.price, { currency })}
        value={draft.price}
        onChangeText={(price) => edit({ price })}
        keyboard="decimal"
        disabled={refusesDigital}
      />

      <TextField
        label={a.productForm.compareAt}
        value={draft.compareAt}
        onChangeText={(compareAt) => edit({ compareAt })}
        keyboard="decimal"
        disabled={refusesDigital}
      />

      <TextField
        label={a.productForm.tags}
        hint={a.productForm.tagsHint}
        placeholder={a.productForm.tagsPlaceholder}
        value={draft.tags}
        onChangeText={(tags) => edit({ tags })}
        disabled={refusesDigital}
      />

      <GroupedList header={a.productForm.optionsTitle}>
        <Switch
          label={a.productForm.trackStock}
          hint={a.productForm.trackStockBody}
          value={draft.trackInventory}
          onValueChange={(trackInventory) => edit({ trackInventory })}
          disabled={refusesDigital}
        />
        {/*
          Drawn only where it can mean something. Stock lives on the variants
          once a product has options — `saveProduct` nulls the product-level
          count in that case — so showing the field there would offer a number
          the server throws away.
        */}
        {draft.trackInventory && (product?.variants.length ?? 0) === 0 ? (
          <TextField
            label={a.variants.unitsInStock}
            hint={a.variants.unitsHint}
            value={draft.stockQuantity}
            onChangeText={(stockQuantity) => edit({ stockQuantity })}
            keyboard="number"
            disabled={refusesDigital}
          />
        ) : null}
        <Switch
          label={a.productForm.inStock}
          hint={a.productForm.inStockBody}
          value={draft.inStock}
          onValueChange={(inStock) => edit({ inStock })}
          disabled={refusesDigital}
        />
        <Switch
          label={a.productForm.featured}
          hint={a.productForm.featuredBody}
          value={draft.isFeatured}
          onValueChange={(isFeatured) => edit({ isFeatured })}
          disabled={refusesDigital}
        />
        {/*
          The columns only this kind uses.

          Every one of them already travelled on every save — `toSaveInput`
          copied them off the loaded product so a phone edit could not wipe an
          event's start time. Carrying them was never the same as being able to
          set them, so a seller who made an event on the web could change its
          price here and nothing else about it.
        */}
        {draft.kind === "event" ? (
          <>
            <ListRow
              title={a.productForm.eventStartsAt}
              subtitle={a.productForm.eventStartsAtHint}
              valueTone="strong"
              value={
                draft.eventStartsAt ? whenLabel(draft.eventStartsAt, locale) : a.columns.never
              }
              icon="calendar"
              onPress={() => setPicking(true)}
            />
            {picking ? (
              <DateTimePicker
                value={draft.eventStartsAt ?? new Date()}
                /* Both halves. Ticket sales close at this exact moment, so a
                   date without a time would close them at midnight. */
                mode="datetime"
                display={Platform.OS === "ios" ? "inline" : "default"}
                onChange={(event, date) => {
                  if (Platform.OS !== "ios") setPicking(false);
                  if (event.type === "set" && date) edit({ eventStartsAt: date });
                }}
              />
            ) : null}
            <TextField
              label={a.productForm.eventJoinUrl}
              hint={a.productForm.eventJoinUrlHint}
              value={draft.eventJoinUrl}
              onChangeText={(next) => edit({ eventJoinUrl: next })}
              keyboard="url"
            />
          </>
        ) : null}

        {draft.kind === "membership" ? (
          <>
            {/*
              A picker, or a sentence — never a picker that lies.

              This screen can say monthly and yearly. The web form can say
              "every 3 months", and a membership already on such a cycle would
              be shown "Monthly" here with no way to tell it apart from a
              genuinely monthly one. `toInput` round-trips the count so the
              cycle survives a save either way; this is so the seller is not
              misinformed about what they are looking at.
            */}
            {draft.billingIntervalCount > 1 ? (
              <Text variant="caption" tone="muted">
                {s.customCycleOnWeb}
              </Text>
            ) : (
              <>
                <Segmented
                  options={[
                    { value: "month", label: a.billing.monthly },
                    { value: "year", label: a.billing.yearly },
                  ]}
                  value={draft.billingInterval}
                  onChange={(next) => edit({ billingInterval: next })}
                  accessibilityLabel={a.productForm.billingInterval}
                />
                <Text variant="caption" tone="muted">
                  {a.productForm.billingIntervalHint}
                </Text>
              </>
            )}
            <TextField
              label={a.productForm.trialDays}
              hint={a.productForm.trialDaysHint}
              value={draft.trialDays}
              onChangeText={(next) => edit({ trialDays: next })}
              keyboard="number"
            />
          </>
        ) : null}

        {draft.kind === "service" ? (
          <>
            <TextField
              label={a.productForm.duration}
              value={draft.durationMinutes}
              onChangeText={(next) => edit({ durationMinutes: next })}
              keyboard="number"
            />
            <Segmented
              options={[
                { value: "in_person", label: a.productForm.inPerson },
                { value: "online", label: a.productForm.online },
              ]}
              value={draft.serviceMode}
              onChange={(next) => edit({ serviceMode: next as Draft["serviceMode"] })}
              accessibilityLabel={a.productForm.duration}
            />
            <TextField
              label={a.productForm.serviceLocation}
              hint={a.productForm.serviceLocationHint}
              placeholder={a.productForm.serviceLocationPlaceholder}
              value={draft.serviceLocation}
              onChangeText={(next) => edit({ serviceLocation: next })}
              multiline
            />
            <Switch
              label={a.productForm.bookingEnabled}
              hint={a.productForm.bookingEnabledBody}
              value={draft.bookingEnabled}
              onValueChange={(next) => edit({ bookingEnabled: next })}
            />
          </>
        ) : null}

        <Switch
          label={a.productForm.published}
          hint={a.productForm.publishedBody}
          value={draft.isPublished}
          onValueChange={(isPublished) => edit({ isPublished })}
          disabled={refusesDigital}
        />
      </GroupedList>

      {/*
        Prices and counts for combinations that already exist. Defining the
        options themselves — adding a Size, renaming a Colour — stays on the web
        admin: `saveProduct` drops every variant whose combination the new
        options no longer describe, so a half-built option set typed on a phone
        would delete rows that past orders point at.
      */}
      {product && product.variants.length > 0 ? (
        <GroupedList header={a.variants.variant} footer={a.variants.footnote}>
          {product.variants.map((variant) => {
            const edited = draft.variants[variant.id];
            if (!edited) return null;
            const label = variantLabel(variant.options, product.options);
            return (
              <View key={variant.id}>
                <TextField
                  label={`${label} · ${interpolate(a.variants.priceIn, { currency })}`}
                  hint={a.variants.intro}
                  value={edited.price}
                  onChangeText={(price) => setVariant(variant.id, { price })}
                  keyboard="decimal"
                  disabled={refusesDigital}
                />
                {draft.trackInventory ? (
                  <TextField
                    label={`${label} · ${a.variants.stock}`}
                    hint={a.variants.unitsHint}
                    value={edited.stock}
                    onChangeText={(stock) => setVariant(variant.id, { stock })}
                    keyboard="number"
                    disabled={refusesDigital}
                  />
                ) : null}
                <Switch
                  label={`${label} · ${a.variants.forSale}`}
                  value={edited.available}
                  onValueChange={(available) => setVariant(variant.id, { available })}
                  disabled={refusesDigital}
                />
              </View>
            );
          })}
        </GroupedList>
      ) : null}

      {/*
        The gallery, and the add control that used to be a footer explaining why
        there wasn't one.

        Order is the seller's — the first image is the cover — so a new photo
        appends rather than jumping the queue, and removing one leaves the rest
        where they were. Reorder is still absent: dragging needs a gesture the
        design system has no primitive for, and a column of arrows reads as a
        mistake on iOS.
      */}
      <GroupedList header={a.productForm.photos} footer={a.images.hint}>
        {draft.imageUrls.map((url, index) => (
          <ListRow
            key={url}
            title={index === 0 ? a.images.cover : String(index + 1)}
            subtitle={url.split("/").pop()}
            icon="photo"
            /* Destructive, because tapping removes it. There is no photo detail
               to push to, so a chevron would promise a screen that is not
               there. */
            destructive
            onPress={() =>
              edit({ imageUrls: draft.imageUrls.filter((held) => held !== url) })
            }
          />
        ))}
        <ListRow
          title={a.images.add}
          icon="camera"
          disabled={uploading}
          onPress={() => void addPhoto()}
        />
      </GroupedList>

      {uploadError ? <Banner tone="danger" message={uploadError} /> : null}

      <Button
        label={save.isPending ? s.saving : a.common.save}
        variant="primary"
        fullWidth
        loading={save.isPending}
        disabled={!canSave}
        onPress={() => save.mutate(toSaveInput(draft, product, currency, locale))}
      />
      <Button label={a.common.cancel} variant="ghost" fullWidth onPress={close} />
    </Sheet>
  );
}

/** No safe-area edges — the stack header owns the top, the tab bar the bottom.
 *  `orders/index.tsx` carries the longer note on why an empty list is the
 *  right answer here rather than an omission. */
