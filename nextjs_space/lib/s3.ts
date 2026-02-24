/**
 * S3 File Operations
 * Handles uploads, downloads, and presigned URLs for cloud storage
 */
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client, getBucketConfig } from "./aws-config";

const s3 = createS3Client();
const { bucketName, folderPrefix, region } = getBucketConfig();

/**
 * Upload a buffer/blob directly to S3
 */
export async function uploadToS3(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
  isPublic: boolean = false
): Promise<{ cloud_storage_path: string; url: string }> {
  const cloud_storage_path = isPublic
    ? `${folderPrefix}public/${key}`
    : `${folderPrefix}${key}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: cloud_storage_path,
      Body: body,
      ContentType: contentType,
      ContentDisposition: isPublic ? "inline" : undefined,
    })
  );

  const url = isPublic
    ? `https://${bucketName}.s3.${region}.amazonaws.com/${cloud_storage_path}`
    : await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucketName, Key: cloud_storage_path }),
        { expiresIn: 3600 }
      );

  return { cloud_storage_path, url };
}

/**
 * Get a signed URL for downloading a file
 */
export async function getFileUrl(
  cloud_storage_path: string,
  isPublic: boolean = false
): Promise<string> {
  if (isPublic) {
    return `https://${bucketName}.s3.${region}.amazonaws.com/${cloud_storage_path}`;
  }
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucketName,
      Key: cloud_storage_path,
      ResponseContentDisposition: "attachment",
    }),
    { expiresIn: 3600 }
  );
}

/**
 * Check if a file exists in S3
 */
export async function fileExists(cloud_storage_path: string): Promise<boolean> {
  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: cloud_storage_path,
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a file from S3
 */
export async function deleteFile(cloud_storage_path: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: cloud_storage_path,
    })
  );
}

/**
 * Get the cloud storage path for DEM files
 */
export function getDEMPath(state: string, county: string): string {
  return `${folderPrefix}dem/${state.toLowerCase()}/${county.toLowerCase()}/dem_cog.tif`;
}

/**
 * Get the cloud storage path for corridor output
 */
export function getCorridorPath(
  state: string,
  county: string,
  parcelId: string
): string {
  return `${folderPrefix}derived/corridors/${state.toLowerCase()}/${county.toLowerCase()}/${parcelId}/corridor_v1_cog.tif`;
}
