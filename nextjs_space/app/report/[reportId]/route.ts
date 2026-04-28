import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { buildHuntingReportHtml } from '@/lib/report/build-html';
import type { HuntingReportPayload } from '@/lib/report/build-html';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { reportId: string } }
) {
  try {
    const { reportId } = params;

    const report = await prisma.huntingReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      return new NextResponse(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report Not Found</title></head>` +
        `<body style="font-family:Georgia,serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8f6f0">` +
        `<div style="text-align:center"><h1 style="color:#1a3a2a;font-size:48px;margin-bottom:16px">404</h1>` +
        `<p style="color:#666;font-size:18px">Hunting report not found.</p>` +
        `<a href="/" style="color:#c9a84c;margin-top:24px;display:inline-block">← Back to Terra Firma Partners</a></div></body></html>`,
        { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }

    // Fire-and-forget view count increment — don't block render
    prisma.huntingReport.update({
      where: { id: reportId },
      data: { viewCount: { increment: 1 } },
    }).catch((e) => console.error('[report/view] viewCount increment failed:', e));

    // Build render-time fields
    const storedPayload = report.payload as Record<string, any>;
    const reportPayload: HuntingReportPayload = {
      ...storedPayload as any,
      reportId: `TFP-${report.createdAt.toISOString().slice(0, 10).replace(/-/g, '')}-${report.id.slice(-6).toUpperCase()}`,
      generated: report.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      isFreeTier: false, // Shared reports are always full (no watermark)
    };

    const html = buildHuntingReportHtml(reportPayload);

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err: any) {
    console.error('[report/view] Error:', err);
    return NextResponse.json(
      { error: 'Failed to render report', detail: err.message },
      { status: 500 }
    );
  }
}
