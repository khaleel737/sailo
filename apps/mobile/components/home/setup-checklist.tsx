/**
 * What a new shop still has to do before it can sell.
 *
 * On the home screen because it is the first thing a seller sees, and its own module because
 * every item in it is a question about a different part of the product — a rail, a product, a
 * handle — and the list will grow.
 */

import { interpolate } from "@sailo/i18n/native";
import { GroupedList, ListRow, Progress, Section } from "@sailo/design-system/native";
import type { SetupStep, SetupStepId, SetupProgress } from "@sailo/core/onboarding";
import { count } from "./window";

/**
 * "Store setup — 2 of 4", until there is nothing left to do.
 *
 * All four rows are on screen at once, deliberately. The obvious alternative —
 * one step at a time behind a pager — is what Stan's app does, and it reduces
 * progress to a line of text you have to read rather than a shape you can see.
 * Four rows and a bar answer "how much is left" without being read.
 *
 * A finished step stays on the list rather than disappearing, because "2 of 4"
 * has to be countable on the screen that claims it — but it stops being a link.
 * There is nothing left to go and do, and a chevron next to a tick invites a
 * trip to a page that will not change anything.
 */
export function SetupChecklist({
  steps,
  progress,
  labels,
  locale,
  onOpen,
}: {
  steps: SetupStep[];
  progress: SetupProgress;
  labels: Record<SetupStepId, string> & Record<string, string>;
  locale: string;
  onOpen: (id: SetupStepId) => void;
}) {
  return (
    /*
     * A `Section`, not a `Card` around a `GroupedList`.
     *
     * That is what it was, and it is the reason Home had **four different left
     * edges** down one screen: the shop-link card at the page margin, the
     * section heading at the margin plus the card's padding, the checklist's
     * rows at the margin plus the card's padding plus the list's own inset, and
     * the stats card back at the margin. Nothing lined up with anything, which
     * is the single largest contributor to a screen reading as cluttered — the
     * eye looks for a vertical rule and finds four.
     *
     * A grouped list already draws its own inset surface; that *is* the iOS
     * idiom. Wrapping it in a card was a surface inside a surface.
     */
    <Section title={labels.title} description={labels.body}>
      <Progress
        value={progress.ratio}
        valueLabel={interpolate(labels.count, {
          done: count(progress.done, locale),
          total: count(progress.total, locale),
        })}
        accessibilityLabel={labels.title}
      />

      <GroupedList>
        {steps.map((step) => (
          <ListRow
            key={step.id}
            title={labels[step.id] ?? step.id}
            subtitle={step.done ? undefined : labels[`${step.id}Hint`]}
            icon={step.done ? "check" : undefined}
            /*
             * Done rows are inert, not hidden. `onPress` is what makes a row
             * look tappable, so withholding it is the whole signal — no
             * chevron, no press state, nothing to go and undo.
             */
            trailing={step.done ? "none" : "chevron"}
            onPress={step.done ? undefined : () => onOpen(step.id)}
            accessibilityLabel={
              step.done ? `${labels[step.id]} — done` : labels[step.id]
            }
          />
        ))}
      </GroupedList>
    </Section>
  );
}

/*
 * Layout only — flex and spacing, nothing with a colour, a radius or a font
 * size in it. Every visual decision on this screen belongs to
 * `@sailo/design-system`; what is left is where the boxes sit relative to each
 * other, which is the one thing no component can decide on a screen's behalf.
 */
