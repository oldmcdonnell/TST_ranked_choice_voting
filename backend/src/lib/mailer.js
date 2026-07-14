// Dev stub: logs "emails" to the console instead of sending them.
// Swap this out for a real provider (Resend, Postmark, SES, etc.)
// before go-live — keep the same sendMail(to, subject, body) signature
// so nothing else in the app has to change.
export async function sendMail(to, subject, body) {
  console.log("\n--- MOCK EMAIL ---");
  console.log("To:", to);
  console.log("Subject:", subject);
  console.log(body);
  console.log("--- END MOCK EMAIL ---\n");
}
