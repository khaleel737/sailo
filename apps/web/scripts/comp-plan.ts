/**
 * Grants — or removes — a comped plan from the command line.
 *
 *   npm run comp -- khaleelmusleh@gmail.com business "Founder account"
 *   npm run comp -- someone@example.com none
 *
 * The same thing the Comped plan card in /hq does, for the cases where a
 * browser is the wrong tool: bootstrapping the founders' own accounts, or
 * comping a list of beta users in one go.
 *
 * Writes to `comp_plan`, never to `plan` or `subscription_status`. Those two
 * belong to Stripe and are overwritten from it every time the seller opens
 * their billing page — a plan granted there would quietly disappear. See the
 * column's note in `db/schema/shop.ts`.
 *
 * Every grant is recorded in `staff_actions` exactly as the panel records it,
 * so an account comped from a terminal doesn't look like it happened by magic.
 */
import { neon } from "@neondatabase/serverless";
import { PLANS, isPlanId } from "@sailo/core/plans";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const sql = neon(databaseUrl);

async function main() {
  const [email, requested = "business", ...noteParts] = process.argv.slice(2);
  const note = noteParts.join(" ");

  if (!email) {
    console.error(
      "usage: npm run comp -- <email> [pro|business|none] [reason…]",
    );
    process.exit(1);
  }

  const actor = process.env.SAILO_ACTOR ?? "cli";

  const rows = await sql`
    select s.id, s.handle, s.comp_plan, u.email
    from shops s join "user" u on u.id = s.user_id
    where lower(u.email) = ${email.toLowerCase()}`;

  const shop = rows[0];
  if (!shop) {
    console.error(
      `No shop owned by ${email}. They need to finish onboarding first.`,
    );
    process.exit(1);
  }

  if (requested === "none") {
    if (!shop.comp_plan) {
      console.log(`${email} isn't comped — nothing to remove.`);
      return;
    }
    await sql`
      update shops set comp_plan = null, comp_note = null, updated_at = now()
      where id = ${shop.id}`;
    await sql`
      insert into staff_actions (actor_email, action, shop_id, summary)
      values (${actor}, 'clear_comp', ${shop.id},
              ${`Removed the comped ${shop.comp_plan} plan — back to whatever Stripe says.`})`;
    console.log(`✓ ${email} (/${shop.handle}) is back on their billed plan.`);
    return;
  }

  if (!isPlanId(requested) || requested === "free") {
    console.error(
      `"${requested}" isn't a paid plan. Use one of: ${Object.values(PLANS)
        .filter((p) => p.id !== "free")
        .map((p) => p.id)
        .join(", ")} — or "none" to remove a comp.`,
    );
    process.exit(1);
  }

  const reason = note || "Granted from the command line";

  await sql`
    update shops
    set comp_plan = ${requested}, comp_note = ${reason}, updated_at = now()
    where id = ${shop.id}`;

  await sql`
    insert into staff_actions (actor_email, action, shop_id, summary)
    values (${actor}, 'comp_plan', ${shop.id},
            ${`Comped ${PLANS[requested].name} — ${reason}.`})`;

  const plan = PLANS[requested];
  const unlocked = Object.entries(plan.features)
    .filter(([, on]) => on)
    .map(([name]) => name)
    .join(", ");

  console.log(`✓ ${email} (/${shop.handle}) is on ${plan.name}.`);
  console.log(`  Unlocked: ${unlocked}`);
  console.log(
    `  Products: ${plan.limits.products ?? "unlimited"} · analytics ${plan.limits.analyticsDays} days`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
