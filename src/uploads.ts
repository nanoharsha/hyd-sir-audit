// Death certificate photo uploads, stored in R2 instead of a local disk.
// Ported from records.py's save_photo/resolve_photo. The client compresses
// before sending, so a photo stays small enough to travel inside a queued
// offline operation as a base64 data URL.
const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Accepts a data: URL and returns the R2 object key to store on the record.
// `prefix` namespaces keys by dataset — "" for electors (legacy path shape),
// "asddo/" for the ASDD List, "draftsir/" for the Draft SIR 2026
// reverification rounds and "ph/" for a Public Hearing follow-up photo — so
// the datasets can't collide and fetchPhoto can tell them apart. `slot`
// (reverification only) namespaces further by which form field the photo
// belongs to: "<prefix><id>/<slot>/<uuid>.<ext>".
export async function savePhoto(
  bucket: R2Bucket,
  recordId: number,
  dataUrl: string,
  prefix = "",
  slot = ""
): Promise<string> {
  const match = dataUrl.match(/^data:([\w/+.-]+);base64,([\s\S]*)$/);
  if (!match) throw new Error("Photo must be a base64 data URL");
  const mime = match[1].toLowerCase();
  const ext = IMAGE_EXT[mime];
  if (!ext) throw new Error("Photo must be a JPEG, PNG or WebP image");

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(match[2]);
  } catch {
    throw new Error("Photo data is not valid base64");
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("Photo is too large");

  const slotSeg = slot && /^[a-z]+$/.test(slot) ? `${slot}/` : "";
  const key = `${prefix}${recordId}/${slotSeg}${crypto.randomUUID()}.${ext}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
  return key;
}

export async function fetchPhoto(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  // A stored key is "<id>/<uuid>.<ext>" (electors) or, for the reverification
  // rounds, "asddo/<id>/<uuid>.<ext>" / "draftsir/<id>/<slot>/<uuid>.<ext>"
  // (slot = outcome|sir|voted|moved|jan), or "ph/<id>/<uuid>.<ext>" for a
  // Public Hearing follow-up photo. Refuse anything else so this can't read
  // arbitrary keys.
  if (!/^(asddo\/|draftsir\/|ph\/)?\d+\/([a-z]+\/)?[a-f0-9-]+\.(jpg|png|webp)$/.test(key)) return null;
  return bucket.get(key);
}
