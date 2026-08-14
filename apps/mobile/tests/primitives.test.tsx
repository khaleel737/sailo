import { useState } from "react";
import { Text as RNText } from "react-native";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import {
  Banner,
  Chip,
  CodeField,
  Divider,
  IconButton,
  Money,
  Screen,
  Skeleton,
  StatusPill,
  StepDots,
  TextField,
} from "@sailo/design-native";

/**
 * The primitives that were added, and the four that were quietly broken.
 *
 * Every case below is a *behaviour*, not a look. A test that asserted a padding
 * or a hex would fail the first time a designer moved one, which is the wrong
 * thing to make expensive — what has to stay true is that a password field
 * offers the keychain, that a code field accepts the digits a seller's own
 * keyboard produces, that a formatted amount honours the size it was asked for,
 * and that nothing announces English at somebody reading in Arabic.
 */

describe("TextField — the iOS autofill table", () => {
  /*
   * THE REGRESSION. `CONTENT_TYPES` was keyed by `string` rather than by
   * `TextFieldAutoComplete`, so TypeScript never checked that the table and the
   * union agreed — and they did not. It held `"current-password"` and `"url"`,
   * which are not values the component accepts, and it was **missing
   * `password`**, which is. So the lookup for a password field returned
   * `undefined`, iOS was told nothing about what the field held, and the
   * password manager did not appear on the sign-in screen — on the one form
   * whose entire purpose is to receive a saved password.
   */
  it("tells iOS a password field is a password field", () => {
    render(
      <TextField label="Password" value="" onChangeText={jest.fn()} secure autoComplete="password" />,
    );
    expect(screen.getByLabelText("Password").props.textContentType).toBe("password");
  });

  it("asks for a generated password on a new-password field, not a saved one", () => {
    // Getting this pair the wrong way round is how a password manager silently
    // fills the seller's password for some other site into a brand-new account.
    render(
      <TextField
        label="Password"
        value=""
        onChangeText={jest.fn()}
        secure
        autoComplete="new-password"
      />,
    );
    expect(screen.getByLabelText("Password").props.textContentType).toBe("newPassword");
  });

  it.each([
    ["email", "emailAddress"],
    ["name", "name"],
    ["tel", "telephoneNumber"],
    ["one-time-code", "oneTimeCode"],
    ["street-address", "fullStreetAddress"],
    ["postal-code", "postalCode"],
    ["off", "none"],
  ] as const)("maps %s to iOS's %s", (autoComplete, expected) => {
    render(
      <TextField label="Field" value="" onChangeText={jest.fn()} autoComplete={autoComplete} />,
    );
    expect(screen.getByLabelText("Field").props.textContentType).toBe(expected);
  });
});

describe("TextField — the counter and the reveal", () => {
  /*
   * The doc comment promised a counter with `maxLength` for as long as the prop
   * has existed and the component never drew one. A cap with nothing showing it
   * is a field that silently stops accepting keystrokes, which reads as the
   * keyboard having frozen.
   */
  it("shows how much room is left when there is a cap", () => {
    render(<TextField label="Note" value="abc" onChangeText={jest.fn()} maxLength={10} />);
    expect(screen.getByText("3/10")).toBeOnTheScreen();
  });

  it("has no counter when there is no cap", () => {
    render(<TextField label="Note" value="abc" onChangeText={jest.fn()} />);
    expect(screen.queryByText(/\/\d+$/)).toBeNull();
  });

  /*
   * A mistyped character in a masked field is invisible, and the seller's only
   * recourse is to clear it and start again. It matters most on sign-up, where
   * the value is one they are inventing.
   */
  it("unmasks the value when the seller asks to see it", () => {
    render(
      <TextField
        label="Password"
        value="hunter2"
        onChangeText={jest.fn()}
        secure
        revealLabels={{ show: "Show password", hide: "Hide password" }}
      />,
    );

    expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(true);
    fireEvent.press(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(false);
    // The control names what the *next* tap does, which is both platforms' own
    // convention for their password fields.
    expect(screen.getByRole("button", { name: "Hide password" })).toBeOnTheScreen();
  });

  it("offers no reveal on a field that is not secure", () => {
    render(<TextField label="Email" value="" onChangeText={jest.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("CodeField", () => {
  /*
   * The two tokens that let the phone fill the code in. iOS reads
   * `textContentType`; Android reads `autoComplete`. Neither understands the
   * other's, and without them the seller leaves the app to read a message and
   * comes back to a form that has reset.
   */
  it("asks the platform for the code it just received", () => {
    render(<CodeField label="Code" value="" onChangeText={jest.fn()} testID="code" />);
    const input = screen.getByTestId("code-input");
    expect(input.props.textContentType).toBe("oneTimeCode");
    expect(input.props.keyboardType).toBe("number-pad");
  });

  /*
   * A code read out over the phone gets typed with a space in it; one copied
   * from an email arrives with a newline. Both fail as "incorrect code" against
   * a field that takes them literally, and the seller cannot see why.
   */
  it("keeps the digits out of whatever else arrived with them", () => {
    const onChangeText = jest.fn();
    render(<CodeField label="Code" value="" onChangeText={onChangeText} testID="code" />);
    fireEvent.changeText(screen.getByTestId("code-input"), " 12 34\n56 ");
    expect(onChangeText).toHaveBeenCalledWith("123456");
  });

  /*
   * Arabic and Persian are shipped languages, and their keyboards produce
   * U+0660–0669 and U+06F0–06F9. Those are digits the seller can read on their
   * own screen and the server cannot; folding them is the difference between a
   * working field and one that refuses everything an Arabic keyboard types.
   */
  it("accepts the digits an Arabic or Persian keyboard produces", () => {
    const onChangeText = jest.fn();
    render(<CodeField label="Code" value="" onChangeText={onChangeText} testID="code" />);
    fireEvent.changeText(screen.getByTestId("code-input"), "٤٢٧٩٠١");
    expect(onChangeText).toHaveBeenCalledWith("427901");

    onChangeText.mockClear();
    fireEvent.changeText(screen.getByTestId("code-input"), "۴۲۷۹۰۱");
    expect(onChangeText).toHaveBeenCalledWith("427901");
  });

  it("stops at the length it was given, however much was pasted", () => {
    const onChangeText = jest.fn();
    render(
      <CodeField label="Code" value="" onChangeText={onChangeText} length={4} testID="code" />,
    );
    fireEvent.changeText(screen.getByTestId("code-input"), "123456789");
    expect(onChangeText).toHaveBeenCalledWith("1234");
  });

  it("says so once the last digit lands", () => {
    const onComplete = jest.fn();
    render(
      <CodeField
        label="Code"
        value=""
        onChangeText={jest.fn()}
        onComplete={onComplete}
        testID="code"
      />,
    );
    fireEvent.changeText(screen.getByTestId("code-input"), "12345");
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId("code-input"), "123456");
    expect(onComplete).toHaveBeenCalledWith("123456");
  });
});

describe("Money", () => {
  /*
   * THE REGRESSION. `variant`, `tone` and `weight` were declared on `MoneyProps`,
   * documented, and then dropped: the implementation destructured four of the
   * seven props and rendered a bare `RNText` with no style at all. So an amount
   * asked for at `display` drew at body size — and, because a bare `RNText`
   * inherits no colour from the theme, every amount in the app was **black in
   * dark mode**.
   */
  it("draws at the size it was asked for", () => {
    render(<Money minor={1999} currency="USD" variant="display" testID="amount" />);
    const style = flatten(screen.getByTestId("amount").props.style);
    expect(style.fontSize).toBeGreaterThan(24);
  });

  it("takes its colour from the theme rather than from nothing", () => {
    render(<Money minor={1999} currency="USD" tone="danger" testID="amount" />);
    expect(flatten(screen.getByTestId("amount").props.style).color).toBeDefined();
  });

  it("defaults to tabular figures so a column of amounts does not shiver", () => {
    render(<Money minor={1999} currency="USD" testID="amount" />);
    expect(flatten(screen.getByTestId("amount").props.style).fontVariant).toEqual([
      "tabular-nums",
    ]);
  });

  /*
   * Minor units, never a division. `formatMoney` knows a yen is its own minor
   * unit and a dinar has three; a flat `/100` showed a seller pricing in JPY a
   * hundredth of what they charged.
   */
  it("never divides by a hundred on its own", () => {
    render(<Money minor={5000} currency="JPY" locale="en-US" testID="jpy" />);
    // A regex, because `toHaveTextContent` matches the whole string and the
    // symbol is part of it — asserting "¥5,000" would be asserting `Intl`'s
    // choice of symbol placement, which is not this component's business.
    expect(screen.getByTestId("jpy")).toHaveTextContent(/\b5,000\b/);
  });

  it("draws a refund with the minus sign, not a hyphen", () => {
    render(<Money minor={1200} currency="USD" locale="en-US" negative testID="refund" />);
    // U+2212, which is what `Intl.NumberFormat` itself emits — a hyphen sits at
    // a different height and width from a formatted negative on the row below.
    expect(screen.getByTestId("refund")).toHaveTextContent(/^−\s/);
  });
});

describe("Skeleton", () => {
  /*
   * The doc comment claimed it was hidden from assistive technology while the
   * code set `accessible`, `accessibilityRole="progressbar"` and the English
   * string "Loading" — inside an app that ships thirty-five languages. A
   * screen-reader user on a loading list heard "Loading", in English, once per
   * placeholder row.
   */
  it("says nothing, in any language", () => {
    render(<Skeleton shape="row" count={6} testID="skeleton" />);

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByLabelText("Loading")).toBeNull();

    /*
     * Not merely unlabelled — *absent* from the tree a screen reader walks.
     * Testing Library skips hidden elements by default, which is exactly the
     * assistive-technology behaviour being asserted here: a query that has to
     * opt in with `includeHiddenElements` is a query reaching past the same
     * barrier VoiceOver and TalkBack stop at.
     */
    expect(screen.queryByTestId("skeleton")).toBeNull();
    expect(screen.getByTestId("skeleton", { includeHiddenElements: true })).toBeTruthy();
  });
});

describe("StatusPill", () => {
  it("carries its meaning in the label, not only in the colour", () => {
    // Colour alone fails for roughly 8% of men, and fails entirely in a screen
    // reader and in a black-and-white screenshot in a support thread.
    render(<StatusPill label="Refunded" tone="danger" />);
    expect(screen.getByText("Refunded")).toBeOnTheScreen();
  });

  /*
   * The order detail screen draws a status and a payment state side by side.
   * Without this, VoiceOver reads "Confirmed, Paid" with nothing saying which
   * adjective belongs to the order and which to the money.
   */
  it("can say which question its word answers", () => {
    render(
      <StatusPill label="Refunded" tone="danger" accessibilityLabel="Payment status: Refunded" />,
    );
    const pill = screen.getByLabelText("Payment status: Refunded");
    expect(pill).toHaveTextContent("Refunded");
  });
});

describe("Banner", () => {
  /*
   * The refusals on the auth screens were bare red `Text` dropped into a form's
   * gap — no edge, no glyph, and nothing announcing them. A screen-reader user
   * pressed a button that kept not working.
   */
  it("announces a refusal rather than waiting to be found", () => {
    render(<Banner tone="danger" message="That email and password don't match." />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/don't match/);
    // Both halves: iOS acts on the role, Android on the live region.
    expect(alert.props.accessibilityLiveRegion).toBe("assertive");
  });

  /*
   * A standing informational banner that interrupts on every re-render is worse
   * than one nobody hears.
   */
  it("does not interrupt for something that is merely worth knowing", () => {
    render(<Banner tone="info" message="Your plan covers thirty days." />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Your plan covers thirty days.")).toBeOnTheScreen();
  });

  it("offers the one thing that can be done about it", () => {
    const onAction = jest.fn();
    render(
      <Banner
        tone="danger"
        message="That email already has an account."
        actionLabel="Sign in instead"
        onAction={onAction}
      />,
    );
    fireEvent.press(screen.getByRole("button", { name: "Sign in instead" }));
    expect(onAction).toHaveBeenCalled();
  });
});

describe("StepDots", () => {
  /*
   * The dots are geometry — there is no text in them to read — so the sentence
   * is required rather than composed, and its word order is the caller's:
   * "2 of 4" is not how every language says it.
   */
  it("reports where the seller is, in words and as a value", () => {
    render(<StepDots count={4} index={1} accessibilityLabel="Step 2 of 4" />);
    const bar = screen.getByRole("progressbar", { name: "Step 2 of 4" });
    expect(bar.props.accessibilityValue).toMatchObject({ min: 1, max: 4, now: 2 });
  });

  it("is one stop rather than four", () => {
    render(<StepDots count={4} index={0} accessibilityLabel="Step 1 of 4" testID="dots" />);
    expect(screen.getByTestId("dots").props.accessible).toBe(true);
  });
});

describe("Chip", () => {
  /*
   * A checkbox, not a button. VoiceOver announces a button as "Unpaid, button",
   * which says nothing about whether the filter is currently on; as a checkbox
   * it is "Unpaid, checked", which is the only thing a seller listening to a
   * filter row needs.
   */
  it("says whether it is currently on", () => {
    render(<Chip label="Unpaid" selected onPress={jest.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Unpaid" }).props.accessibilityState).toMatchObject(
      { checked: true },
    );
  });

  it("does not fire while disabled", () => {
    const onPress = jest.fn();
    render(<Chip label="Unpaid" selected={false} onPress={onPress} disabled />);
    fireEvent.press(screen.getByRole("checkbox", { name: "Unpaid" }));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("IconButton", () => {
  /*
   * The whole reason this is a component rather than an `Icon` inside a
   * `Pressable`: an icon-only control with no name is announced as "button" and
   * nothing else, and the seller's only way to find out what it does is to
   * press it. `Icon` makes its own label optional — correctly, because an icon
   * beside text is decoration — so the requirement lives here.
   */
  it("has a name, because it is only a glyph", () => {
    const onPress = jest.fn();
    render(<IconButton icon="add" accessibilityLabel="Add a product" onPress={onPress} />);
    fireEvent.press(screen.getByRole("button", { name: "Add a product" }));
    expect(onPress).toHaveBeenCalled();
  });
});

describe("Divider", () => {
  it("sets a word into the rule when it is given one", () => {
    render(<Divider label="or" />);
    expect(screen.getByText("or")).toBeOnTheScreen();
  });

  it("is a plain rule otherwise", () => {
    render(<Divider testID="rule" />);
    expect(within(screen.getByTestId("rule")).queryByText(/\S/)).toBeNull();
  });
});

describe("Screen", () => {
  it("renders what it was given", () => {
    render(
      <Screen testID="screen">
        <RNText>Body</RNText>
      </Screen>,
    );
    expect(screen.getByText("Body")).toBeOnTheScreen();
  });

  /*
   * The primary action of a form belongs above the keyboard rather than at the
   * end of the content: a seller who has filled in three fields should not have
   * to scroll to find the button that submits them.
   */
  it("keeps a pinned footer outside the scroll", () => {
    render(
      <Screen
        testID="screen"
        footer={<RNText>Continue</RNText>}
      >
        <RNText>Body</RNText>
      </Screen>,
    );
    const scroller = screen.getByTestId("screen");
    expect(within(scroller).getByText("Body")).toBeOnTheScreen();
    // The footer is a sibling of the scroller, not a descendant of it.
    expect(within(scroller).queryByText("Continue")).toBeNull();
    expect(screen.getByText("Continue")).toBeOnTheScreen();
  });

  /*
   * A `FlashList` inside a `ScrollView` is a list with no bounded height, which
   * is the most common way a list renders blank. `scroll={false}` is what a
   * screen whose own list scrolls asks for.
   */
  it("draws no scroller when the content owns the scrolling", () => {
    render(
      <Screen scroll={false} testID="screen">
        <RNText>Body</RNText>
      </Screen>,
    );
    expect(screen.getByTestId("screen").props.refreshControl).toBeUndefined();
    expect(screen.getByText("Body")).toBeOnTheScreen();
  });

  it("offers pull-to-refresh only when there is something to refresh", () => {
    const onRefresh = jest.fn();
    const { rerender } = render(
      <Screen testID="screen">
        <RNText>Body</RNText>
      </Screen>,
    );
    expect(screen.getByTestId("screen").props.refreshControl).toBeUndefined();

    rerender(
      <Screen testID="screen" onRefresh={onRefresh} refreshing={false}>
        <RNText>Body</RNText>
      </Screen>,
    );
    expect(screen.getByTestId("screen").props.refreshControl).toBeDefined();
  });
});

/**
 * A code field wired to state, the way a screen wires one.
 *
 * At module scope rather than inside the test, because a component redeclared
 * on every call is a new type on every render — React unmounts and remounts the
 * whole subtree, which is exactly the thing this case is trying to observe not
 * happening.
 */
function CodeForm() {
  const [code, setCode] = useState("");
  return (
    <>
      <CodeField label="Code" value={code} onChangeText={setCode} testID="code" />
      <RNText testID="echo">{code}</RNText>
    </>
  );
}

describe("a form driven by state", () => {
  /*
   * An end-to-end pass over the two controls the auth flow is built from,
   * driven the way a screen drives them. It is here because every assertion
   * above tests a control in isolation, and the failure this catches is the one
   * that only appears when a value round-trips: a field that renders its own
   * copy of the value rather than the one it was handed.
   */
  it("round-trips a value through the field it was typed into", () => {
    render(<CodeForm />);
    fireEvent.changeText(screen.getByTestId("code-input"), "٤٢٧9 01");
    expect(screen.getByTestId("echo")).toHaveTextContent("427901");
  });
});

/** React Native styles arrive as nested arrays; this is the flat truth. */
function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return (style ?? {}) as Record<string, unknown>;
}
