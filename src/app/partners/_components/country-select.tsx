import { Field, Select } from "@/components/ui";

/**
 * Where the partner banks.
 *
 * Only the countries where Stripe supports the `recipient` service agreement
 * *and* can transfer to us — the US, Canada, the UK, the EEA and Switzerland
 * interoperate, and everywhere else the platform and the account must share a
 * country. Offering a country we cannot pay would mean a partner completing a
 * long onboarding flow only to be told at their first payout that it was never
 * going to work.
 *
 * Left blank by default rather than guessed. Stripe asks again during
 * onboarding anyway; what this avoids is creating the account in the wrong
 * country, which cannot be changed afterwards.
 */
const COUNTRIES = [
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["CA", "Canada"],
  ["AU", "Australia"],
  ["NZ", "New Zealand"],
  ["SG", "Singapore"],
  ["CH", "Switzerland"],
  ["AT", "Austria"],
  ["BE", "Belgium"],
  ["BG", "Bulgaria"],
  ["HR", "Croatia"],
  ["CY", "Cyprus"],
  ["CZ", "Czechia"],
  ["DK", "Denmark"],
  ["EE", "Estonia"],
  ["FI", "Finland"],
  ["FR", "France"],
  ["DE", "Germany"],
  ["GR", "Greece"],
  ["HU", "Hungary"],
  ["IE", "Ireland"],
  ["IT", "Italy"],
  ["LV", "Latvia"],
  ["LT", "Lithuania"],
  ["LU", "Luxembourg"],
  ["MT", "Malta"],
  ["NL", "Netherlands"],
  ["NO", "Norway"],
  ["PL", "Poland"],
  ["PT", "Portugal"],
  ["RO", "Romania"],
  ["SK", "Slovakia"],
  ["SI", "Slovenia"],
  ["ES", "Spain"],
  ["SE", "Sweden"],
] as const;

export function CountrySelect() {
  return (
    <Field label="Your country" htmlFor="partner-country" className="min-w-56">
      <Select id="partner-country" name="country" defaultValue="">
        <option value="" disabled>
          Choose a country
        </option>
        {COUNTRIES.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
