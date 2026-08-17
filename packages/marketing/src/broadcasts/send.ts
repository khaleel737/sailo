/**
 * Sending a broadcast.
 *
 * WHY THIS IS AN ENTRY AND NOT AN IMPLEMENTATION
 *
 * It was 710 lines holding six jobs that answer to different callers: a seller pressing
 * Send, a cron draining a queue, a renderer asking what the offer currently is, and a
 * screen asking how it is going. Splitting them by *who asks* is what makes each one
 * readable on its own.
 *
 *   ./queue-broadcast  a seller pressed Send: plan, audience, delivery rows, budget
 *   ./queue-run        one tick of the queue, and one batch per broadcast in flight
 *   ./content          the offer as it stands at the moment of sending, not of composing
 *   ./labels           the chrome that is ours, in the shop's language
 *   ./recipients       the one query a batch needs for its recipients' names
 *   ./progress         how a broadcast is doing
 */

export * from "./queue-broadcast";
export * from "./queue-run";
export * from "./content";
export * from "./labels";
export * from "./progress";
