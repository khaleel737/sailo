import { render, screen } from "@testing-library/react-native";
import { ORDER_STATUSES } from "@sailo/core/order-status";
import { OrderStatusBadge, PaymentStatusBadge } from "./order-status";

/**
 * The two badges, and the rule they exist to keep: colour is never the only
 * thing carrying the meaning.
 *
 * The order detail screen draws these side by side, so there is a second rule
 * on top of the first — each badge has to say *which question* its word
 * answers. Read without that, VoiceOver announces "Confirmed, Paid" and leaves
 * the seller to guess which adjective belongs to the order and which to the
 * money.
 */

describe("OrderStatusBadge", () => {
  /*
   * Every status in the lifecycle, not a sampled one. The failure this guards
   * against is a status added to `ORDER_STATUSES` without a word in the
   * dictionary — which renders as a bare coloured pill, and is precisely the
   * "colour is the only carrier" bug.
   */
  it.each([...ORDER_STATUSES])("draws a word for %s, not just a tone", (status) => {
    render(<OrderStatusBadge status={status} />);
    expect(screen.root).toHaveTextContent(/\S/);
  });

  it("names the question its word answers", () => {
    render(<OrderStatusBadge status="confirmed" />);
    expect(screen.getByLabelText("Order status: Confirmed")).toBeOnTheScreen();
  });

  /*
   * The label and the drawn word come from one call to `orderStatusLabel`, so
   * they cannot disagree — a screen reader and a sighted seller are told the
   * same thing about the same order.
   */
  it("says the same word to a screen reader as it draws", () => {
    render(<OrderStatusBadge status="refunded" />);
    const badge = screen.getByLabelText("Order status: Refunded");
    expect(badge).toHaveTextContent("Refunded");
  });

  /*
   * A status the database has and this build's dictionary does not still has
   * to render something. `orderStatusLabel` falls back to the stored value,
   * and a badge that rendered nothing would be an invisible order state.
   */
  it("falls back to the stored value for a status it has no word for", () => {
    render(<OrderStatusBadge status="awaiting_pickup" />);
    expect(screen.getByLabelText("Order status: awaiting_pickup")).toBeOnTheScreen();
  });
});

describe("PaymentStatusBadge", () => {
  it("names the question its word answers", () => {
    render(<PaymentStatusBadge status="paid" />);
    expect(screen.getByLabelText("Payment status: Paid")).toBeOnTheScreen();
  });

  /*
   * The two badges are adjacent on the detail screen, and a refund is a
   * neutral fact about an order and a red one about a payment. The labels are
   * what keep the two readings apart.
   */
  it("is distinguishable from the order badge for the same word", () => {
    render(<PaymentStatusBadge status="refunded" />);
    expect(screen.getByLabelText("Payment status: Refunded")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Order status: Refunded")).not.toBeOnTheScreen();
  });

  /*
   * `pending` reads "Payment sent" and `disputed` reads "Chargeback" — neither
   * is the stored value prettified, and both are the seller's own vocabulary.
   */
  it("uses the seller's word rather than the stored one", () => {
    render(<PaymentStatusBadge status="pending" />);
    expect(screen.getByLabelText("Payment status: Payment sent")).toBeOnTheScreen();
  });

  it("falls back to the stored value for a payment state it has no word for", () => {
    render(<PaymentStatusBadge status="escrowed" />);
    expect(screen.getByLabelText("Payment status: escrowed")).toBeOnTheScreen();
  });
});
