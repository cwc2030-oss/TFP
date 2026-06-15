/**
 * /api/listings/[id]/photos
 *
 * POST   — Upload a photo for a listing. Auth-required, owner-only.
 *          Accepts multipart/form-data with a single "file" field.
 *          Validates type (jpg/png/webp), size (≤10 MB), and 6-photo cap.
 *          Stores under {folderPrefix}public/listings/{listingId}/{uuid}.{ext}
 *          Returns the public S3 URL and the updated photos array.
 *
 * DELETE — Remove a photo URL from the listing's photos array.
 *          Accepts JSON { url: string }.
 *          Deletes the S3 object if it lives in our bucket.
 *
 * Both methods work on DRAFT and PUBLISHED listings (bypasses the
 * DRAFT-only guard on the general PATCH route). Only the photos field
 * is touched — no other listing fields can be modified here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { uploadToS3, deleteFile } from '@/lib/s3';
import { getBucketConfig } from '@/lib/aws-config';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_PHOTOS = 6;
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Load listing if the caller owns it. Works for any status. */
async function loadOwned(id: string, userId: string) {
  return prisma.listing.findFirst({
    where: { id, ownerUserId: userId },
    select: { id: true, photos: true, status: true },
  });
}

// ---- POST: upload a photo ----
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const listing = await loadOwned(params.id, session.user.id);
  if (!listing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Only allow photo edits on DRAFT or PUBLISHED
  if (listing.status !== 'DRAFT' && listing.status !== 'PUBLISHED') {
    return NextResponse.json(
      { error: `Cannot edit photos in status ${listing.status}` },
      { status: 409 },
    );
  }

  if ((listing.photos?.length ?? 0) >= MAX_PHOTOS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_PHOTOS} photos allowed` },
      { status: 400 },
    );
  }

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data with a "file" field' },
      { status: 400 },
    );
  }

  const file = formData.get('file');
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  // Validate type
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: `Invalid file type: ${file.type}. Allowed: JPG, PNG, WebP` },
      { status: 400 },
    );
  }

  // Validate size
  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.` },
      { status: 400 },
    );
  }

  // Upload to S3
  const uuid = randomUUID();
  const key = `listings/${listing.id}/${uuid}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { url } = await uploadToS3(key, buffer, file.type, true);

  // Append to listing photos array
  const updatedPhotos = [...(listing.photos ?? []), url];
  await prisma.listing.update({
    where: { id: listing.id },
    data: { photos: updatedPhotos },
  });

  return NextResponse.json({ url, photos: updatedPhotos });
}

// ---- DELETE: remove a photo ----
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const listing = await loadOwned(params.id, session.user.id);
  if (!listing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (listing.status !== 'DRAFT' && listing.status !== 'PUBLISHED') {
    return NextResponse.json(
      { error: `Cannot edit photos in status ${listing.status}` },
      { status: 409 },
    );
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with { url }' }, { status: 400 });
  }

  const urlToRemove = body?.url;
  if (!urlToRemove || typeof urlToRemove !== 'string') {
    return NextResponse.json({ error: 'Missing url field' }, { status: 400 });
  }

  const updatedPhotos = (listing.photos ?? []).filter((p) => p !== urlToRemove);

  // Try to delete from S3 if it's our bucket
  const { bucketName, region } = getBucketConfig();
  const bucketPrefix = `https://${bucketName}.s3.${region}.amazonaws.com/`;
  if (urlToRemove.startsWith(bucketPrefix)) {
    const s3Key = urlToRemove.slice(bucketPrefix.length);
    try {
      await deleteFile(s3Key);
    } catch (e) {
      console.warn('[photos] Failed to delete S3 object:', s3Key, e);
    }
  }

  await prisma.listing.update({
    where: { id: listing.id },
    data: { photos: updatedPhotos },
  });

  return NextResponse.json({ photos: updatedPhotos });
}

// ---- PATCH: reorder photos ----
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const listing = await loadOwned(params.id, session.user.id);
  if (!listing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (listing.status !== 'DRAFT' && listing.status !== 'PUBLISHED') {
    return NextResponse.json(
      { error: `Cannot edit photos in status ${listing.status}` },
      { status: 409 },
    );
  }

  let body: { photos?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with { photos }' }, { status: 400 });
  }

  const newOrder = body?.photos;
  if (!Array.isArray(newOrder)) {
    return NextResponse.json({ error: 'photos must be an array' }, { status: 400 });
  }

  // Validate: reorder must contain exactly the same URLs
  const existing = new Set(listing.photos ?? []);
  const incoming = new Set(newOrder);
  if (
    newOrder.length !== existing.size ||
    newOrder.some((u) => !existing.has(u)) ||
    [...existing].some((u) => !incoming.has(u))
  ) {
    return NextResponse.json(
      { error: 'Reorder must contain exactly the same photo URLs' },
      { status: 400 },
    );
  }

  await prisma.listing.update({
    where: { id: listing.id },
    data: { photos: newOrder },
  });

  return NextResponse.json({ photos: newOrder });
}
