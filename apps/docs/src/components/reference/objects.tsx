import {
  ADDRESS_FIELDS,
  CONTACT_FIELDS,
  DISPUTE_FIELDS,
  MONEY_FIELDS,
  ORDER_BOOKING_FIELDS,
  ORDER_CUSTOMER_FIELDS,
  ORDER_DELIVERY_FIELDS,
  ORDER_FIELDS,
  ORDER_ITEM_FIELDS,
  PRODUCT_BOOKING_FIELDS,
  PRODUCT_EVENT_FIELDS,
  PRODUCT_FIELDS,
  PRODUCT_MEMBERSHIP_FIELDS,
  PRODUCT_VARIANT_FIELDS,
  SHOP_FIELDS,
  SUBSCRIPTION_FIELDS,
  type Field,
} from "./fields";
import { DefTable, Prose } from "./kit";

/**
 * The object reference, rendered from `./fields`.
 *
 * One component per table rather than a generic `<Fields name="order" />`,
 * because a string argument is a name MDX can misspell and get an empty table
 * for. These are imports: a typo is a build error.
 */

function FieldTable({ caption, fields }: { caption: string; fields: readonly Field[] }) {
  return (
    <DefTable
      caption={caption}
      headers={["Field", "What it is"]}
      rows={fields.map((field) => ({
        term: field.name,
        note: field.type,
        body: <Prose>{field.body}</Prose>,
      }))}
    />
  );
}

export const MoneyFields = () => <FieldTable caption="Fields on a money object" fields={MONEY_FIELDS} />;

export const ShopFields = () => <FieldTable caption="Fields on a shop" fields={SHOP_FIELDS} />;

export const OrderFields = () => <FieldTable caption="Fields on an order" fields={ORDER_FIELDS} />;
export const OrderCustomerFields = () => (
  <FieldTable caption="Fields on an order's customer object" fields={ORDER_CUSTOMER_FIELDS} />
);
export const AddressFields = () => <FieldTable caption="Fields on an address object" fields={ADDRESS_FIELDS} />;
export const OrderDeliveryFields = () => (
  <FieldTable caption="Fields on an order's delivery object" fields={ORDER_DELIVERY_FIELDS} />
);
export const OrderBookingFields = () => (
  <FieldTable caption="Fields on an order's booking object" fields={ORDER_BOOKING_FIELDS} />
);
export const OrderItemFields = () => (
  <FieldTable caption="Fields on an order line item" fields={ORDER_ITEM_FIELDS} />
);

export const ProductFields = () => <FieldTable caption="Fields on a product" fields={PRODUCT_FIELDS} />;
export const ProductBookingFields = () => (
  <FieldTable caption="Fields on a product's booking object" fields={PRODUCT_BOOKING_FIELDS} />
);
export const ProductEventFields = () => (
  <FieldTable caption="Fields on a product's event object" fields={PRODUCT_EVENT_FIELDS} />
);
export const ProductMembershipFields = () => (
  <FieldTable caption="Fields on a product's membership object" fields={PRODUCT_MEMBERSHIP_FIELDS} />
);
export const ProductVariantFields = () => (
  <FieldTable caption="Fields on a product variant" fields={PRODUCT_VARIANT_FIELDS} />
);

export const ContactFields = () => <FieldTable caption="Fields on a contact" fields={CONTACT_FIELDS} />;

export const SubscriptionFields = () => (
  <FieldTable caption="Fields on a subscription" fields={SUBSCRIPTION_FIELDS} />
);

export const DisputeFields = () => <FieldTable caption="Fields on a dispute" fields={DISPUTE_FIELDS} />;
