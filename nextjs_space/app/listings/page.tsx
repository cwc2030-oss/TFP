/**
 * /listings — Founding-property landowner landing page.
 *
 * Thin server-component gate wrapper. While the marketplace is closed, only
 * admins may preview this page; everyone else is sent to the coming-soon wall.
 * When the marketplace opens (TFP_MARKETPLACE_OPEN=true, read at request time),
 * it's public to all. The actual page UI is the client component in
 * ./_components/founding-landing.
 *
 * Gating lives here in the Node page layer (not edge middleware) so the launch
 * flip works at runtime without a code change or rebuild.
 */
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isMarketplaceOpen, COMING_SOON_PATH } from '@/lib/marketplace-gate';
import FoundingLanding from './_components/founding-landing';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ListingsPage() {
  if (!isMarketplaceOpen()) {
    const session = await getServerSession(authOptions);
    if ((session?.user as any)?.role !== 'admin') {
      redirect(COMING_SOON_PATH);
    }
  }
  return <FoundingLanding />;
}
