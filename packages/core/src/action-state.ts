/**
 * What a Server Action answers with.
 *
 * One shape, shared by every form in every Sailo app: `ok` decides whether the
 * UI shows a success or a failure, and the two optional strings are what it
 * shows. `useActionState` needs a stable type on both sides of the boundary, so
 * this is the type the initial state, the action and the component all name.
 *
 * It lived in `apps/web/src/lib/actions/shop.ts` — a 547-line module about
 * shops — until the staff panel became its own app and needed it too. Nothing
 * about it was ever specific to shops, or to web; it is here now because a type
 * two apps both name has to live somewhere neither of them owns.
 *
 * Deliberately not a discriminated union on `ok`. That would be a better type,
 * and it would also mean touching every one of the ~90 actions that returns
 * this — a refactor worth doing on its own, not smuggled into a migration.
 */
export type ActionState = { ok: boolean; error?: string; message?: string };
