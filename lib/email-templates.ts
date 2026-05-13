export function inviteEmailTemplate(opts: {
  appUrl: string;
  inviteLink: string;
  role: string;
}) {
  const { inviteLink, role } = opts;

  return `
  <div style="font-family:ui-sans-serif,system-ui; line-height:1.5;">
    <h2 style="margin:0 0 8px;">Welcome to WREDD</h2>
    <p style="margin:0 0 16px;">You’ve been invited to join the WREDD dashboard as <b>${role}</b>.</p>
    <p style="margin:0 0 16px;">
      <a href="${inviteLink}" style="display:inline-block;padding:10px 14px;border-radius:10px;text-decoration:none;background:#8F4043;color:#fff;">
        Complete Registration
      </a>
    </p>
    <p style="margin:0 0 6px;color:#666;font-size:12px;">If the button doesn’t work, copy/paste:</p>
    <p style="margin:0;color:#666;font-size:12px;">${inviteLink}</p>
  </div>
  `;
}
