import { render, screen, within } from "@testing-library/react-native";
import { Empty, ErrorState, Loading, errorMessage } from "./states";

/**
 * The accessibility contract of the three states every list screen shows.
 *
 * These assertions look small and are not. Each one stands in for a way the
 * app used to say nothing at all to a seller who cannot see it: a spinner is
 * silent unless it is labelled, an error that replaces a screen is silent
 * unless it announces, and a title and its explanation are two disconnected
 * fragments unless something groups them.
 *
 * They are queried the way a screen reader reaches them — by role and by
 * accessible name — rather than by test id, because the test id would keep
 * passing after somebody removed the role.
 */

describe("Loading", () => {
  /*
   * `ActivityIndicator` renders no text. Without a role and a name VoiceOver
   * lands on an empty screen and says nothing, which is indistinguishable from
   * the app having hung.
   */
  it("announces itself as a progress indicator with a name", () => {
    render(<Loading />);
    expect(screen.getByRole("progressbar")).toBeOnTheScreen();
    expect(screen.getByLabelText("Loading")).toBeOnTheScreen();
  });

  it("prefers the caller's caption when there is one", () => {
    render(<Loading label="Checking your shop" />);
    expect(screen.getByLabelText("Checking your shop")).toBeOnTheScreen();
  });
});

describe("ErrorState", () => {
  /*
   * The failure replaces the screen without moving focus, so a seller whose
   * cursor was in the list is left on something that silently changed. `alert`
   * is what makes it speak.
   */
  it("announces the message rather than waiting to be found", () => {
    render(<ErrorState message="Couldn't reach your shop." onRetry={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach your shop.");
  });

  it("offers the retry as a button", () => {
    render(<ErrorState message="Nope." onRetry={() => {}} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeOnTheScreen();
  });

  /*
   * Busy and disabled are different facts. A button that only says disabled
   * reads as "not for you" when it means "working on it" — and this one means
   * the second, every time.
   */
  it("says busy, not merely disabled, while a retry is in flight", () => {
    render(<ErrorState message="Nope." onRetry={() => {}} retrying />);
    expect(screen.getByRole("button", { busy: true, disabled: true })).toBeOnTheScreen();
  });

  it("is neither busy nor disabled at rest", () => {
    render(<ErrorState message="Nope." onRetry={() => {}} />);
    expect(screen.queryByRole("button", { busy: true })).not.toBeOnTheScreen();
  });
});

describe("Empty", () => {
  /*
   * One stop, not two. The hint on its own — "Orders from your shop will
   * appear here" — means nothing without the title it explains, and a seller
   * who lifts their finger between the two has read half a sentence.
   */
  it("groups the title and its hint into a single element", () => {
    render(<Empty title="No orders yet" hint="Orders from your shop will appear here." />);
    /*
     * Every `Text` carries the `text` role implicitly, so the role alone
     * cannot tell the container from what it contains. `accessible` is the
     * prop that actually does the grouping — it is what collapses the two
     * lines into one stop — so it is the prop worth asserting on.
     */
    const group = grouped();
    expect(within(group).getByText("No orders yet")).toBeOnTheScreen();
    expect(
      within(group).getByText("Orders from your shop will appear here."),
    ).toBeOnTheScreen();
  });

  it("still groups when there is no hint to add", () => {
    render(<Empty title="No orders yet" />);
    expect(within(grouped()).getByText("No orders yet")).toBeOnTheScreen();
  });
});

/** The one rendered element that has been marked as an accessibility group. */
function grouped() {
  const groups = screen
    .getAllByRole("text")
    .filter((node) => node.props.accessible === true);
  expect(groups).toHaveLength(1);
  return groups[0];
}

describe("errorMessage", () => {
  /*
   * The server's own sentence is better than anything this app could invent
   * for it: `NOT_FOUND` from a procedure says "No such order", which is the
   * useful answer.
   */
  it("prefers the server's own words", () => {
    expect(errorMessage(new Error("No such order."), "Something went wrong.")).toBe(
      "No such order.",
    );
  });

  it("falls back when the error carried no words", () => {
    expect(errorMessage(new Error("   "), "Something went wrong.")).toBe(
      "Something went wrong.",
    );
  });

  /*
   * A rejected promise is not always an `Error`. The overwhelmingly common
   * cause here is the phone being on a train, and the fallback is the sentence
   * written for exactly that.
   */
  it("falls back on anything that is not an Error at all", () => {
    expect(errorMessage("kaboom", "Check your connection.")).toBe("Check your connection.");
    expect(errorMessage(undefined, "Check your connection.")).toBe("Check your connection.");
  });
});
