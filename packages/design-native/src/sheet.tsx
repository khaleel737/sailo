import { Modal, Text as RNText, View } from "react-native";

/**
 * The panel that comes up from the bottom.
 *
 * Controlled, not imperative: `visible` is the screen's state. A sheet that
 * opened itself would be a second source of truth about what is on screen, and
 * the back gesture, the scrim tap and the close button would each have to find
 * their way to it.
 *
 * `onClose` is called by all three of those. A sheet a seller cannot dismiss by
 * tapping outside it is a sheet they will force-quit the app to escape.
 */
export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Drawn in the sheet's own header, with the close button. */
  title?: string;
  /**
   * `auto` hugs its content — pickers, confirmations. `large` is near
   * full-height for something that scrolls.
   * @default "auto"
   */
  size?: "auto" | "medium" | "large";
  /**
   * Refuse the scrim tap and the swipe-down, leaving only an explicit control.
   * For a sheet with unsaved input — and for nothing else, because it takes
   * away the way out a seller expects.
   */
  dismissible?: boolean;
  testID?: string;
};

export function Sheet({ visible, onClose, children, title, testID }: SheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID={testID}
    >
      <View>
        {title ? <RNText accessibilityRole="header">{title}</RNText> : null}
        {children}
      </View>
    </Modal>
  );
}
