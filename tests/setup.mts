/**
 * Loads `.env.local` the way Next does, so integration tests reach the same
 * database and Stripe sandbox as the app. Unit tests don't need it, but a
 * single setup file is cheaper than two configs.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
