import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function sendEmail(opts: { to: string; subject: string; html: string }) {
  const from = mustEnv("EMAIL_FROM");

  // In dev, you can still send real emails (to yourself) if Resend key is set.
  // If you want "no-email dev mode", you can add a guard here later.
  await resend.emails.send({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}
