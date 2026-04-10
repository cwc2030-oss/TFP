import { NextRequest } from 'next/server';

/**
 * Direct function wrappers that call route POST handlers without HTTP round-trips.
 * Solves production container networking issues (ECONNREFUSED / SSL errors)
 * when one API route tries to call another via fetch().
 */

export async function generateLandPdfDirect(orderId: string): Promise<{ pdf: string; filename: string }> {
  // Dynamically import to avoid circular deps and Next.js route export restrictions
  const { POST } = await import('@/app/api/broker-quick-look/route');
  const req = new NextRequest('http://internal/api/broker-quick-look', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  });
  const res = await POST(req);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return { pdf: data.pdf, filename: data.filename };
}

/**
 * Generates the Hunt Intelligence Report as a PDF (via HTML2PDF).
 * Returns { pdf: base64string, contentType: string }
 * Falls back to HTML if PDF conversion fails.
 */
export async function generateHuntPdfDirect(payload: any): Promise<{ pdf: string; contentType: string }> {
  const { POST } = await import('@/app/api/parcel-hunt-file/route');
  const req = new NextRequest('http://internal/api/parcel-hunt-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const res = await POST(req);

  if (res.status !== 200) {
    // Try to parse JSON error
    const text = await res.text();
    try {
      const errData = JSON.parse(text);
      throw new Error(errData.error || 'Hunt report generation failed');
    } catch (e: any) {
      if (e.message.includes('generation failed')) throw e;
      throw new Error('Hunt report generation failed');
    }
  }

  const ct = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  const base64 = buf.toString('base64');

  return {
    pdf: base64,
    contentType: ct.includes('application/pdf') ? 'application/pdf' : 'text/html',
  };
}
