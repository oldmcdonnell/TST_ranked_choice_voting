// Sends email via Resend (https://resend.com). Falls back to logging to
// the console when RESEND_API_KEY isn't set, so local dev without a key
// still works exactly like before.
export async function sendMail(to, subject, body) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.log("\n--- MOCK EMAIL (no RESEND_API_KEY set) ---");
    console.log("To:", to);
    console.log("Subject:", subject);
    console.log(body);
    console.log("--- END MOCK EMAIL ---\n");
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to,
      subject,
      text: body,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Resend send failed (${res.status}): ${errorText}`);
  }
}