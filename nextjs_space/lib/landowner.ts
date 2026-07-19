/**
 * Brick 1 helper: is the given user a "landowner" for the purpose of the
 * hunter browse-and-choose view?
 *
 * Per requirement #2, owner-browse is restricted to landowners. We define a
 * landowner as a user who owns at least one Listing (any status — owning a
 * DRAFT still means they have land to lease). Admins always pass.
 */
import { prisma } from '@/lib/db';

export async function isLandowner(
  userId: string | null | undefined,
  role?: string | null,
): Promise<boolean> {
  if (!userId) return false;
  if (role === 'admin') return true;
  const count = await prisma.listing.count({ where: { ownerUserId: userId } });
  return count > 0;
}
