/**
 * Spatial Database Health Check
 * GET /api/spatial/health
 * Returns: { connected, serverTime, postgisVersion } or { connected: false, error }
 */
import { NextResponse } from 'next/server';
import { checkHealth } from '@/lib/spatial-db';

export async function GET() {
  try {
    const health = await checkHealth();
    
    return NextResponse.json(health, {
      status: health.connected ? 200 : 503
    });
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        error: error instanceof Error ? error.message : 'Health check failed'
      },
      { status: 500 }
    );
  }
}
