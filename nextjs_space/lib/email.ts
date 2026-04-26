/**
 * Email helper — Abacus AI sendNotificationEmail wrapper.
 *
 * Chunk 4: factored out from app/api/email-parcel/route.ts so the inquiry
 * flow (and any future email) can share a single transport with mockable
 * testing seams.
 *
 * The Abacus API takes ONE recipient per call. To support BCC we simply
 * make a second call. This is the documented two-call BCC pattern decided
 * for chunk 4 (vs. moving to Resend, which would require DNS verification).
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  bcc?: string | null;
  /**
   * Optional Reply-To. The Abacus API does not natively support a
   * Reply-To header, so when set we surface it inside the HTML body so the
   * landowner sees the hunter's email and can reply directly. The actual
   * header isn't set on the wire — keeping fidelity here for future
   * provider swaps.
   */
  replyTo?: string | null;
  /** Optional sender alias. Defaults to "Terra Firma Partners". */
  senderAlias?: string;
}

export interface EmailResult {
  ok: boolean;
  status: number;
  recipient: string;
  error?: string;
}

export type EmailTransport = (input: SendEmailInput) => Promise<EmailResult>;

/**
 * Default transport — POST to the Abacus sendNotificationEmail API.
 * Uses ABACUSAI_API_KEY for auth. Sender domain derives from NEXTAUTH_URL
 * so emails come from `noreply@<host>` (e.g. noreply@terrafirma.partners).
 */
export const abacusTransport: EmailTransport = async ({
  to,
  subject,
  html,
  senderAlias = 'Terra Firma Partners',
}: SendEmailInput): Promise<EmailResult> => {
  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      recipient: to,
      error: 'ABACUSAI_API_KEY is not configured',
    };
  }

  const appUrl =
    process.env.NEXTAUTH_URL || 'https://terrafirmapartners.abacusai.app';
  let hostname = 'terrafirma.partners';
  try {
    hostname = new URL(appUrl).hostname;
  } catch {
    /* fall through */
  }

  let response: Response;
  try {
    response = await fetch('https://apps.abacus.ai/api/sendNotificationEmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deployment_token: apiKey,
        subject,
        body: html,
        is_html: true,
        recipient_email: to,
        sender_email: `noreply@${hostname}`,
        sender_alias: senderAlias,
      }),
    });
  } catch (err: any) {
    return {
      ok: false,
      status: 502,
      recipient: to,
      error: err?.message ?? 'fetch failed',
    };
  }

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    /* ignore — non-JSON response */
  }

  if (!response.ok || (body && body.success === false)) {
    return {
      ok: false,
      status: response.status,
      recipient: to,
      error: body?.error || body?.message || `HTTP ${response.status}`,
    };
  }

  return { ok: true, status: response.status, recipient: to };
};

/**
 * Module-scoped transport pointer. Tests can swap this via
 * setEmailTransport(stub). Defaults to the real Abacus transport.
 */
let activeTransport: EmailTransport = abacusTransport;

export function setEmailTransport(t: EmailTransport): void {
  activeTransport = t;
}

export function resetEmailTransport(): void {
  activeTransport = abacusTransport;
}

/**
 * Send an email with optional BCC.
 *
 * Returns one EmailResult per recipient (1 for the primary, +1 if BCC is
 * set). The caller is responsible for deciding what to do if any of them
 * fail; for the inquiry flow we always return 200 to the hunter even if a
 * delivery hiccups, and log the failure server-side.
 */
export async function sendEmail(input: SendEmailInput): Promise<EmailResult[]> {
  const results: EmailResult[] = [];
  results.push(await activeTransport(input));
  if (input.bcc && input.bcc.toLowerCase() !== input.to.toLowerCase()) {
    results.push(
      await activeTransport({
        ...input,
        to: input.bcc,
        // Keep subject + body identical so the BCC matches the original.
        // If we wanted to flag it as a copy we could prepend [BCC] to the
        // subject, but that complicates inbox filtering for clark@.
      }),
    );
  }
  return results;
}
