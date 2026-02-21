// Health check endpoint for production routing verification
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    routes: {
      core: '/core',
      intel: '/intel',
      terrainAnalysis: '/api/terrain-analysis'
    }
  });
}
