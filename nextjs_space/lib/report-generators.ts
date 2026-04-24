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


