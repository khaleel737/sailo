import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, EmptyState, Text } from "@sailo/design-native";

/**
 * Insights — a placeholder, and the first screen written against the design
 * system's API.
 *
 * There is nothing to show yet: the shop and analytics procedures this tab
 * reads from are a reserved seam in `@sailo/api` that A02 fills, and the charts
 * are A09's. What this file is for is proving the seam works — it imports from
 * `@sailo/design-native` and typechecks, which is the contract every Wave 2
 * agent is about to build against.
 *
 * The components below render unstyled primitives today. They will be themed
 * without this file changing, which is the whole point of shipping the API a
 * wave ahead of its styling.
 */
export default function Insights() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={["left", "right"]}>
      <ScrollView>
        <Card>
          {/* i18n: A05 */}
          <Text variant="body" tone="muted">
            Your shop&apos;s numbers will appear here.
          </Text>
        </Card>
        {/* i18n: A05 */}
        <EmptyState
          title="Nothing to measure yet"
          message="Once your shop has visitors and orders, this tab shows how it is doing."
        />
      </ScrollView>
    </SafeAreaView>
  );
}
